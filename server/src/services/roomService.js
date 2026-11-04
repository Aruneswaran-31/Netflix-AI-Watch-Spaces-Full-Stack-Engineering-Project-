'use strict';

const { randomBytes } = require('crypto');
const WatchSpace = require('../models/WatchSpace');
const Title = require('../models/Title');
const User = require('../models/User');
const { ApiError } = require('../lib/errors');
const analytics = require('./analyticsService');
const roomRuntime = require('./roomRuntime');
const config = require('../config/env');

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateInviteCode() {
  const bytes = randomBytes(4);
  let code = '';
  for (let i = 0; i < 4; i += 1) code += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  return `NX-${code}`;
}

async function uniqueInviteCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateInviteCode();
    // eslint-disable-next-line no-await-in-loop
    const exists = await WatchSpace.exists({ inviteCode: code });
    if (!exists) return code;
  }
  return `NX-${randomBytes(5).toString('hex').toUpperCase().slice(0, 6)}`;
}

async function createWatchSpace({ host, titleId, name, settings = {}, visibility = 'invite' }) {
  const title = await Title.findById(titleId);
  if (!title) throw ApiError.notFound('Title not found');

  const maxParticipants = Math.min(
    Math.max(Number(settings.maxParticipants) || 25, 2),
    Math.min(config.room.maxParticipantsCeiling, 50)
  );

  const space = await WatchSpace.create({
    titleId: title._id,
    hostUserId: host._id,
    name: name?.trim() || `${host.displayName}'s ${title.name} room`,
    inviteCode: await uniqueInviteCode(),
    visibility,
    settings: {
      maxParticipants,
      aiVerbosity: settings.aiVerbosity || 'normal',
      votingEnabled: settings.votingEnabled !== false,
      subtitlesEnabled: settings.subtitlesEnabled !== false,
    },
    participantIds: [host._id],
    peakParticipants: 1,
    lastActivityAt: new Date(),
  });

  analytics.recordSoon({
    watchSpaceId: space._id,
    type: 'room_created',
    userId: host._id,
    payload: { titleId: String(title._id), maxParticipants },
  });

  return { space, title };
}

async function getSpaceOr404(id) {
  const space = await WatchSpace.findById(id);
  if (!space) throw ApiError.notFound('Watch Space not found');
  return space;
}

async function joinWatchSpace({ space, user }) {
  if (space.status === 'ended') throw ApiError.conflict('This Watch Space has ended');
  const runtime = roomRuntime.getRoom(space._id);
  if (space.locked || runtime?.locked) throw ApiError.forbidden('This Watch Space is locked');

  const userId = String(user._id);
  const alreadyIn = space.participantIds.some((id) => String(id) === userId);
  if (!alreadyIn) {
    if (space.participantIds.length >= space.settings.maxParticipants) {
      throw ApiError.conflict('This Watch Space is full');
    }
    space.participantIds.push(user._id);
    space.peakParticipants = Math.max(space.peakParticipants, space.participantIds.length);
    space.lastActivityAt = new Date();
    await space.save();
  }
  // Session presence events are recorded by the room runtime when a socket
  // actually attaches, so the report measures concurrency rather than
  // membership (a member can join a room and never open it).
  return space;
}

async function leaveWatchSpace({ space, user }) {
  space.participantIds = space.participantIds.filter((id) => String(id) !== String(user._id));
  space.lastActivityAt = new Date();
  if (String(space.hostUserId) === String(user._id) && space.status !== 'ended') {
    // Host leaving via REST hands the room to the longest-present participant.
    const runtime = roomRuntime.getRoom(space._id);
    const others = (runtime?.connected && [...runtime.connected.keys()]) || [];
    const nextId = others.find((id) => id !== String(user._id));
    if (nextId) {
      space.hostUserId = nextId;
      roomRuntime.setHost(roomRuntime.getRoom(space._id), nextId);
    }
  }
  await space.save();
  return space;
}

async function endWatchSpace({ space, user }) {
  space.status = 'ended';
  space.endedAt = new Date();
  await space.save();
  const runtime = roomRuntime.getRoom(space._id);
  if (runtime) await roomRuntime.endRoom(runtime, user._id);
  return space;
}

async function roomDetail(space) {
  const [title, host] = await Promise.all([
    Title.findById(space.titleId),
    User.findById(space.hostUserId).select('displayName email role'),
  ]);
  if (!title) throw ApiError.notFound('Title for this Watch Space no longer exists');
  const runtime = roomRuntime.getRoom(space._id);
  return {
    watchSpace: space.toPublic(),
    title: title.toPublic(),
    host: host
      ? { id: String(host._id), displayName: host.displayName, role: host.role }
      : null,
    live: Boolean(runtime && !runtime.ended),
    participantCount: runtime ? runtime.connected.size : space.participantIds.length,
    playback: runtime ? roomRuntime.syncPing(runtime, null, {}) : null,
  };
}

module.exports = {
  generateInviteCode,
  uniqueInviteCode,
  createWatchSpace,
  getSpaceOr404,
  joinWatchSpace,
  leaveWatchSpace,
  endWatchSpace,
  roomDetail,
};
