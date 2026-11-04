'use strict';

const Vote = require('../models/Vote');
const ChatMessage = require('../models/ChatMessage');
const WatchSpace = require('../models/WatchSpace');
const { ApiError } = require('../lib/errors');
const { findVariation } = require('./timelineService');
const { positionAt } = require('./playbackStateMachine');
const roomRuntime = require('./roomRuntime');
const analytics = require('./analyticsService');

const timers = new Map();

function ballotCounts(vote) {
  const counts = Object.fromEntries(vote.options.map((option) => [option.id, 0]));
  for (const ballot of vote.ballots) {
    if (counts[ballot.optionId] !== undefined) counts[ballot.optionId] += 1;
  }
  return counts;
}

function publicVote(vote) {
  return {
    ...vote.toPublic(),
    counts: ballotCounts(vote),
    totalBallots: vote.ballots.length,
  };
}

async function openVote({ space, title, variationId, durationSeconds = 30, user }) {
  if (!space.settings.votingEnabled) {
    throw ApiError.forbidden('Group voting is disabled for this Watch Space');
  }
  const variation = findVariation(title.timeline, variationId);
  if (!variation) throw ApiError.notFound('Variation point not found on this title');

  const existing = await Vote.findOne({
    watchSpaceId: space._id,
    variationId: variation.id,
    status: 'open',
  });
  if (existing) throw ApiError.conflict('A vote for this variation is already open');

  const duration = Math.min(Math.max(Number(durationSeconds) || 30, 5), 300);
  const vote = await Vote.create({
    watchSpaceId: space._id,
    titleId: title._id,
    variationId: variation.id,
    question: variation.title || 'Choose the approved variation to apply',
    options: (variation.options || []).map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description || '',
    })),
    closesAt: new Date(Date.now() + duration * 1000),
    openedBy: user._id,
  });

  const room = roomRuntime.getRoom(space._id);
  if (room) {
    roomRuntime.emit(room, 'room.variation.voteOpen', {
      voteId: String(vote._id),
      variationId: variation.id,
      question: vote.question,
      options: vote.options,
      closesAt: vote.closesAt,
      durationSeconds: duration,
      tsSeconds: variation.ts,
    });
  }
  analytics.recordSoon({
    watchSpaceId: space._id,
    type: 'variation_opened',
    userId: user._id,
    payload: { variationId: variation.id, voteId: String(vote._id) },
  });

  const timer = setTimeout(() => {
    closeVote({ voteId: vote._id, automatic: true }).catch(() => {});
  }, duration * 1000);
  if (timer.unref) timer.unref();
  timers.set(String(vote._id), timer);

  return publicVote(vote);
}

async function castBallot({ voteId, spaceId, user, optionId }) {
  const vote = await Vote.findOne({ _id: voteId, watchSpaceId: spaceId });
  if (!vote) throw ApiError.notFound('Vote not found');
  if (vote.status !== 'open') throw ApiError.conflict('This vote has closed');
  if (vote.closesAt < new Date()) throw ApiError.conflict('This vote has expired');
  if (!vote.options.some((option) => option.id === optionId)) {
    throw ApiError.badRequest('Unknown option for this vote');
  }

  const existing = vote.ballots.find((ballot) => String(ballot.userId) === String(user._id));
  if (existing) existing.optionId = optionId;
  else vote.ballots.push({ userId: user._id, optionId });
  await vote.save();

  const room = roomRuntime.getRoom(spaceId);
  if (room) {
    roomRuntime.emit(room, 'room.variation.voteUpdate', {
      voteId: String(vote._id),
      variationId: vote.variationId,
      counts: ballotCounts(vote),
      totalBallots: vote.ballots.length,
    });
  }
  analytics.recordSoon({
    watchSpaceId: spaceId,
    type: 'variation_vote',
    userId: user._id,
    payload: { variationId: vote.variationId, optionId },
  });
  return publicVote(vote);
}

async function closeVote({ voteId, spaceId, user, automatic = false }) {
  const query = { _id: voteId, status: 'open' };
  if (spaceId) query.watchSpaceId = spaceId;
  const vote = await Vote.findOne(query);
  if (!vote) {
    const any = await Vote.findById(voteId);
    if (!any) throw ApiError.notFound('Vote not found');
    return publicVote(any);
  }

  const counts = ballotCounts(vote);
  const ordered = vote.options.map((option) => option.id);
  let winner = ordered[0];
  let best = -1;
  for (const optionId of ordered) {
    if (counts[optionId] > best) {
      best = counts[optionId];
      winner = optionId;
    }
  }

  vote.status = 'closed';
  vote.closedAt = new Date();
  vote.winningOptionId = winner;
  await vote.save();

  const timer = timers.get(String(vote._id));
  if (timer) {
    clearTimeout(timer);
    timers.delete(String(vote._id));
  }

  const space = await WatchSpace.findById(vote.watchSpaceId);
  const title = space ? await require('../models/Title').findById(space.titleId) : null;
  const variation = title ? findVariation(title.timeline, vote.variationId) : null;
  const option = variation?.options?.find((o) => o.id === winner);

  const room = roomRuntime.getRoom(vote.watchSpaceId);
  if (room) {
    roomRuntime.emit(room, 'room.variation.applied', {
      voteId: String(vote._id),
      variationId: vote.variationId,
      winningOptionId: winner,
      winningOption: option
        ? { id: option.id, label: option.label, description: option.description, subtitle: option.subtitle, assetRef: option.assetRef }
        : { id: winner, label: winner },
      variationKind: variation?.variationKind || 'narrative',
      counts,
      tsSeconds: variation?.ts ?? positionAt(room.playback, Date.now()),
      appliedAt: new Date().toISOString(),
    });
    roomRuntime.emit(room, 'room.system.message', {
      body: `Group vote applied: ${option?.label || winner}${automatic ? ' (vote timer closed)' : ''}.`,
    });
  }

  await ChatMessage.create({
    watchSpaceId: vote.watchSpaceId,
    type: 'system',
    body: `Variation applied — ${option?.label || winner}`,
    tsSeconds: variation?.ts || 0,
  }).catch(() => {});

  analytics.recordSoon({
    watchSpaceId: vote.watchSpaceId,
    type: 'variation_applied',
    userId: user?._id,
    payload: { variationId: vote.variationId, winningOptionId: winner, counts, automatic },
  });

  return publicVote(vote);
}

/**
 * Direct, host-only swap of an authored subtitle/localization variant. Playback
 * is untouched — the new line is broadcast as an overlay for everyone.
 */
async function applyVariationDirect({ space, title, variationId, optionId, user }) {
  const variation = findVariation(title.timeline, variationId);
  if (!variation) throw ApiError.notFound('Variation point not found on this title');
  const option = variation.options?.find((candidate) => candidate.id === optionId);
  if (!option) throw ApiError.badRequest('Unknown option for this variation');

  const room = roomRuntime.getRoom(space._id);
  const payload = {
    variationId: variation.id,
    winningOptionId: option.id,
    winningOption: {
      id: option.id,
      label: option.label,
      description: option.description,
      subtitle: option.subtitle,
      assetRef: option.assetRef,
    },
    variationKind: variation.variationKind || 'subtitle',
    tsSeconds: variation.ts,
    direct: true,
    appliedAt: new Date().toISOString(),
  };
  if (room) roomRuntime.emit(room, 'room.variation.applied', payload);

  analytics.recordSoon({
    watchSpaceId: space._id,
    type: 'subtitle_swapped',
    userId: user._id,
    payload: { variationId: variation.id, optionId: option.id },
  });
  return payload;
}

function closeAllTimers() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

module.exports = {
  ballotCounts,
  publicVote,
  openVote,
  castBallot,
  closeVote,
  applyVariationDirect,
  closeAllTimers,
};
