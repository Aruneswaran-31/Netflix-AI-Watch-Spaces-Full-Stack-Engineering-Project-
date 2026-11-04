'use strict';

const express = require('express');
const { z } = require('zod');
const WatchSpace = require('../models/WatchSpace');
const Title = require('../models/Title');
const ChatMessage = require('../models/ChatMessage');
const Vote = require('../models/Vote');
const { requireAuth, assertRoomHost, isAdmin } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/errors');
const { cleanText } = require('../lib/sanitize');
const roomService = require('../services/roomService');
const roomRuntime = require('../services/roomRuntime');
const voteService = require('../services/voteService');
const coPilot = require('../services/coPilotRoomService');
const analytics = require('../services/analyticsService');
const { variationPoints, findVariation } = require('../services/timelineService');
const { snapshot, positionAt } = require('../services/playbackStateMachine');

const router = express.Router();
router.use(requireAuth);

function assertMember(space, user) {
  if (isAdmin(user)) return;
  const member = space.participantIds.some((id) => String(id) === String(user._id));
  if (!member) throw ApiError.forbidden('Join this Watch Space to access its room data');
}

async function loadSpaceWithTitle(id) {
  const space = await roomService.getSpaceOr404(id);
  const title = await Title.findById(space.titleId);
  if (!title) throw ApiError.notFound('Title not found');
  return { space, title };
}

const createSchema = z.object({
  titleId: z.string().min(1),
  name: z.string().min(2).max(120).optional(),
  maxParticipants: z.coerce.number().int().min(2).max(50).optional(),
  aiVerbosity: z.enum(['minimal', 'normal', 'chatty']).optional(),
  votingEnabled: z.boolean().optional(),
  subtitlesEnabled: z.boolean().optional(),
  visibility: z.enum(['public', 'invite']).optional(),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!['host', 'admin'].includes(req.user.role)) {
      throw ApiError.forbidden('Creating a Watch Space requires the host role (or admin)');
    }
    const body = createSchema.parse(req.body);
    const { space, title } = await roomService.createWatchSpace({
      host: req.user,
      titleId: body.titleId,
      name: body.name,
      visibility: body.visibility,
      settings: body,
    });
    res.status(201).json({
      watchSpaceId: String(space._id),
      inviteCode: space.inviteCode,
      status: space.status,
      hostUserId: String(space.hostUserId),
      createdAt: space.createdAt,
      joinUrl: `/watch/${space._id}?code=${space.inviteCode}`,
      watchSpace: space.toPublic(),
      title: title.toPublic(),
    });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        scope: z.enum(['mine', 'live', 'upcoming', 'public']).optional().default('mine'),
      })
      .parse(req.query);

    let filter = {};
    if (query.scope === 'mine') {
      filter = {
        $or: [{ hostUserId: req.user._id }, { participantIds: req.user._id }],
      };
    } else if (query.scope === 'live') {
      filter = { status: 'live' };
    } else if (query.scope === 'upcoming') {
      filter = { status: 'scheduled', $or: [{ hostUserId: req.user._id }, { participantIds: req.user._id }] };
    } else {
      filter = { visibility: 'public', status: { $ne: 'ended' } };
    }

    const spaces = await WatchSpace.find(filter).sort({ createdAt: -1 }).limit(40);
    const titleIds = [...new Set(spaces.map((space) => String(space.titleId)))];
    const titles = await Title.find({ _id: { $in: titleIds } });
    const titleMap = new Map(titles.map((title) => [String(title._id), title.toPublic()]));

    res.json({
      watchSpaces: spaces.map((space) => ({
        ...space.toPublic(),
        title: titleMap.get(String(space.titleId)) || null,
        live: Boolean(roomRuntime.getRoom(space._id) && !roomRuntime.getRoom(space._id).ended),
      })),
    });
  })
);

router.get(
  '/by-code/:inviteCode',
  asyncHandler(async (req, res) => {
    const space = await WatchSpace.findOne({ inviteCode: req.params.inviteCode.toUpperCase() });
    if (!space) throw ApiError.notFound('No Watch Space uses that invite code');
    const title = await Title.findById(space.titleId);
    res.json({
      watchSpace: space.toPublic(),
      title: title ? title.toPublic() : null,
      isMember: space.participantIds.some((id) => String(id) === String(req.user._id)),
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { space, title } = await loadSpaceWithTitle(req.params.id);
    const runtime = roomRuntime.getRoom(space._id);
    const member = space.participantIds.some((id) => String(id) === String(req.user._id));
    if (!member && !isAdmin(req.user) && space.visibility !== 'public') {
      throw ApiError.forbidden('This Watch Space is invite-only');
    }
    const host = await require('../models/User').findById(space.hostUserId).select(
      'displayName role'
    );
    res.json({
      watchSpace: { ...space.toPublic(), isMember: member },
      title: title.toPublic(),
      host: host
        ? { id: String(host._id), displayName: host.displayName, role: host.role }
        : null,
      participants: runtime ? roomRuntime.presencePayload(runtime).participants : [],
      playback: runtime ? snapshot(runtime.playback) : null,
      live: Boolean(runtime && !runtime.ended),
    });
  })
);

router.post(
  '/:id/join',
  asyncHandler(async (req, res) => {
    const { space, title } = await loadSpaceWithTitle(req.params.id);
    const updated = await roomService.joinWatchSpace({ space, user: req.user });
    const runtime = roomRuntime.getRoom(updated._id);
    res.json({
      watchSpace: updated.toPublic(),
      title: title.toPublic(),
      isHost: roomRuntime.isHost(
        runtime || { hostUserId: updated.hostUserId },
        req.user._id
      ),
      playback: runtime ? snapshot(runtime.playback) : null,
      participants: runtime ? roomRuntime.presencePayload(runtime).participants : [],
    });
  })
);

router.post(
  '/:id/leave',
  asyncHandler(async (req, res) => {
    const space = await roomService.getSpaceOr404(req.params.id);
    await roomService.leaveWatchSpace({ space, user: req.user });
    res.status(204).end();
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(2).max(120).optional(),
        settings: z
          .object({
            maxParticipants: z.coerce.number().int().min(2).max(50).optional(),
            aiVerbosity: z.enum(['minimal', 'normal', 'chatty']).optional(),
            votingEnabled: z.boolean().optional(),
            subtitlesEnabled: z.boolean().optional(),
          })
          .optional(),
      })
      .parse(req.body);

    const space = await roomService.getSpaceOr404(req.params.id);
    assertRoomHost(space, req.user);
    if (body.name) space.name = cleanText(body.name, { maxLength: 120 });
    if (body.settings) {
      const current =
        typeof space.settings.toObject === 'function' ? space.settings.toObject() : space.settings;
      space.settings = { ...current, ...body.settings };
    }
    await space.save();
    const runtime = roomRuntime.getRoom(space._id);
    if (runtime) roomRuntime.setSettings(runtime, { aiVerbosity: space.settings.aiVerbosity });
    if (runtime) roomRuntime.emit(runtime, 'room.settings.update', space.toPublic().settings);
    res.json({ watchSpace: space.toPublic() });
  })
);

router.post(
  '/:id/end',
  asyncHandler(async (req, res) => {
    const space = await roomService.getSpaceOr404(req.params.id);
    assertRoomHost(space, req.user);
    const updated = await roomService.endWatchSpace({ space, user: req.user });
    res.json({ watchSpace: updated.toPublic() });
  })
);

router.post(
  '/:id/moderate',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        action: z.enum(['mute', 'unmute', 'remove', 'lock', 'unlock', 'transfer-host']),
        targetUserId: z.string().optional(),
      })
      .parse(req.body);

    const space = await roomService.getSpaceOr404(req.params.id);
    assertRoomHost(space, req.user);
    const runtime = roomRuntime.getRoom(space._id);

    if (['mute', 'unmute', 'remove', 'transfer-host'].includes(body.action)) {
      if (!body.targetUserId) throw ApiError.badRequest('targetUserId is required for this action');
      const targetIsMember = space.participantIds.some(
        (id) => String(id) === String(body.targetUserId)
      );
      if (!targetIsMember) throw ApiError.badRequest('That user is not in this Watch Space');

      if (body.action === 'mute') runtime && roomRuntime.setMuted(runtime, body.targetUserId, true);
      if (body.action === 'unmute') runtime && roomRuntime.setMuted(runtime, body.targetUserId, false);
      if (body.action === 'remove') {
        space.participantIds = space.participantIds.filter(
          (id) => String(id) !== String(body.targetUserId)
        );
        await space.save();
        if (runtime) roomRuntime.removeParticipant(runtime, body.targetUserId);
        if (runtime) {
          roomRuntime.emit(runtime, 'room.system.message', {
            body: 'A participant was removed by the host.',
          });
        }
      }
      if (body.action === 'transfer-host') {
        const previous = space.hostUserId;
        space.hostUserId = body.targetUserId;
        await space.save();
        if (runtime) roomRuntime.transferHostTo(runtime, body.targetUserId, previous);
      }
    }

    if (body.action === 'lock') {
      space.locked = true;
      await space.save();
      if (runtime) roomRuntime.setLocked(runtime, true);
    }
    if (body.action === 'unlock') {
      space.locked = false;
      await space.save();
      if (runtime) roomRuntime.setLocked(runtime, false);
    }

    res.json({ watchSpace: space.toPublic() });
  })
);

router.get(
  '/:id/chat',
  asyncHandler(async (req, res) => {
    const space = await roomService.getSpaceOr404(req.params.id);
    assertMember(space, req.user);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).optional().default(80),
        before: z.string().datetime().optional(),
      })
      .parse(req.query);

    const filter = { watchSpaceId: space._id };
    if (query.before) filter.createdAt = { $lt: new Date(query.before) };
    const messages = await ChatMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(query.limit);
    res.json({ messages: messages.reverse().map((message) => message.toPublic()) });
  })
);

router.get(
  '/:id/variations',
  asyncHandler(async (req, res) => {
    const { space, title } = await loadSpaceWithTitle(req.params.id);
    assertMember(space, req.user);
    const votes = await Vote.find({ watchSpaceId: space._id }).sort({ createdAt: -1 });
    res.json({
      votingEnabled: space.settings.votingEnabled,
      variations: variationPoints(title.timeline).map((variation) => ({
        id: variation.id,
        ts: variation.ts,
        title: variation.title,
        text: variation.text,
        variationKind: variation.variationKind,
        options: (variation.options || []).map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description,
          subtitle: option.subtitle,
          assetRef: option.assetRef,
        })),
        votes: votes
          .filter((vote) => vote.variationId === variation.id)
          .map((vote) => voteService.publicVote(vote)),
      })),
    });
  })
);

router.post(
  '/:id/ai/ask',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        question: z.string().min(2).max(500),
        currentTs: z.coerce.number().min(0).optional(),
      })
      .parse(req.body);

    const { space, title } = await loadSpaceWithTitle(req.params.id);
    assertMember(space, req.user);
    if (roomRuntime.getRoom(space._id)?.muted.has(String(req.user._id))) {
      throw ApiError.forbidden('The host muted you in this room');
    }

    const result = await coPilot.askInRoom({
      space,
      title,
      user: req.user,
      question: body.question,
      currentTs: body.currentTs,
    });
    res.json({
      answer: result.answer,
      grounded: result.grounded,
      sourceEvents: result.sourceEvents,
      sources: result.sources,
      provider: result.provider,
      confidence: result.confidence,
      latencyMs: result.latencyMs,
      generatedAt: result.generatedAt,
      questionId: result.questionId,
    });
  })
);

router.post(
  '/:id/votes',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        variationId: z.string().min(1),
        durationSeconds: z.coerce.number().int().min(5).max(300).optional(),
      })
      .parse(req.body);
    const { space, title } = await loadSpaceWithTitle(req.params.id);
    assertRoomHost(space, req.user);
    const vote = await voteService.openVote({
      space,
      title,
      variationId: body.variationId,
      durationSeconds: body.durationSeconds,
      user: req.user,
    });
    res.status(201).json({ vote });
  })
);

router.post(
  '/:id/votes/:voteId/ballot',
  asyncHandler(async (req, res) => {
    const body = z.object({ optionId: z.string().min(1) }).parse(req.body);
    const space = await roomService.getSpaceOr404(req.params.id);
    assertMember(space, req.user);
    if (!space.settings.votingEnabled) {
      throw ApiError.forbidden('Group voting is disabled for this Watch Space');
    }
    const vote = await voteService.castBallot({
      voteId: req.params.voteId,
      spaceId: space._id,
      user: req.user,
      optionId: body.optionId,
    });
    res.json({ vote });
  })
);

router.post(
  '/:id/votes/:voteId/close',
  asyncHandler(async (req, res) => {
    const space = await roomService.getSpaceOr404(req.params.id);
    assertRoomHost(space, req.user);
    const vote = await voteService.closeVote({
      voteId: req.params.voteId,
      spaceId: space._id,
      user: req.user,
    });
    res.json({ vote });
  })
);

router.get(
  '/:id/votes/:voteId',
  asyncHandler(async (req, res) => {
    const space = await roomService.getSpaceOr404(req.params.id);
    assertMember(space, req.user);
    const vote = await Vote.findOne({ _id: req.params.voteId, watchSpaceId: space._id });
    if (!vote) throw ApiError.notFound('Vote not found');
    res.json({ vote: voteService.publicVote(vote) });
  })
);

router.post(
  '/:id/variations/:variationId/apply',
  asyncHandler(async (req, res) => {
    const body = z.object({ optionId: z.string().min(1) }).parse(req.body);
    const { space, title } = await loadSpaceWithTitle(req.params.id);
    assertRoomHost(space, req.user);
    const variation = findVariation(title.timeline, req.params.variationId);
    if (!variation) throw ApiError.notFound('Variation point not found');
    const applied = await voteService.applyVariationDirect({
      space,
      title,
      variationId: req.params.variationId,
      optionId: body.optionId,
      user: req.user,
    });
    res.json({ applied });
  })
);

router.get(
  '/:id/analytics',
  asyncHandler(async (req, res) => {
    const space = await roomService.getSpaceOr404(req.params.id);
    assertRoomHost(space, req.user);
    const summary = await analytics.sessionSummary(space._id);
    const runtime = roomRuntime.getRoom(space._id);

    // Recomputed from the event log; the counters are a fast-path cache.
    const reconciled = {
      chatMessages: summary.chatMessages === space.chatCount,
      aiQuestions: summary.aiQuestions === space.aiQuestionCount,
      triviaSurfaced: summary.triviaSurfaced === space.triviaCount,
      peakParticipants: summary.peakConcurrentParticipants === space.peakParticipants,
    };

    res.json({
      analytics: {
        ...summary,
        counters: {
          chatCount: space.chatCount,
          aiQuestionCount: space.aiQuestionCount,
          triviaCount: space.triviaCount,
          peakParticipants: space.peakParticipants,
        },
        reconciled,
        durationSeconds: space.endedAt
          ? Math.round((new Date(space.endedAt) - new Date(space.createdAt)) / 1000)
          : Math.round((Date.now() - new Date(space.createdAt)) / 1000),
        status: space.status,
        currentlyConnected: runtime ? runtime.connected.size : 0,
        playbackPositionSeconds: runtime ? Number(positionAt(runtime.playback, Date.now()).toFixed(2)) : 0,
      },
    });
  })
);

module.exports = router;
