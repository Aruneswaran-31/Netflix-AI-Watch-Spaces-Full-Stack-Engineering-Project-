'use strict';

const express = require('express');
const { z } = require('zod');
const Interaction = require('../models/Interaction');
const Title = require('../models/Title');
const WatchSpace = require('../models/WatchSpace');
const User = require('../models/User');
const SessionEvent = require('../models/SessionEvent');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/errors');
const recommendationService = require('../services/recommendationService');
const roomRuntime = require('../services/roomRuntime');

const router = express.Router();
router.use(requireAuth);

/** GET /api/v1/recommendations — personal rail with per-item explanations. */
router.get(
  '/recommendations',
  asyncHandler(async (req, res) => {
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(20).optional().default(10) })
      .parse(req.query);
    const started = Date.now();
    const recommendations = await recommendationService.recommendationsFor(req.user, {
      limit: query.limit,
    });
    const model = await recommendationService.loadModel();
    res.json({
      recommendations,
      method: 'hybrid-content-cf',
      weights: recommendationService.WEIGHTS,
      model: {
        items: model.model.items.size,
        interactions: model.interactions.length,
        builtAt: model.builtAt,
        precisionAt5: model.evaluation.precisionAt5,
      },
      latencyMs: Date.now() - started,
    });
  })
);

/** POST /api/v1/interactions — record watch completion/rating; invalidates the rail. */
router.post(
  '/interactions',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        titleId: z.string().min(1),
        watchedSeconds: z.coerce.number().min(0).optional().default(0),
        completed: z.boolean().optional().default(false),
        rating: z.coerce.number().min(1).max(5).optional(),
        watchSpaceId: z.string().optional(),
        coWatchedWith: z.array(z.string()).max(50).optional().default([]),
      })
      .parse(req.body);

    const title = await Title.findById(body.titleId);
    if (!title) return res.status(404).json({ error: { code: 'not_found', message: 'Title not found' } });

    const completionRatio = Math.max(
      0,
      Math.min(1, body.watchedSeconds > 0 ? body.watchedSeconds / title.durationSeconds : body.completed ? 1 : 0)
    );

    const interaction = await Interaction.create({
      userId: req.user._id,
      titleId: title._id,
      watchSpaceId: body.watchSpaceId,
      watchedSeconds: body.watchedSeconds,
      completionRatio,
      completed: body.completed || completionRatio >= 0.95,
      rating: body.rating,
      coWatchedWith: body.coWatchedWith,
      source: body.watchSpaceId ? 'room' : 'manual',
    });

    recommendationService.invalidate();
    res.status(201).json({ interaction: interaction.toObject() });
  })
);

/** GET /api/v1/dashboard — history, active rooms, stats and the recommendation rail. */
router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const [interactions, spaces, aiQuestions, sessionsHosted] = await Promise.all([
      Interaction.find({ userId }).sort({ createdAt: -1 }).limit(50).populate('titleId').lean(),
      WatchSpace.find({
        $or: [{ hostUserId: userId }, { participantIds: userId }],
        status: { $ne: 'ended' },
      })
        .sort({ createdAt: -1 })
        .populate('titleId')
        .limit(10),
      SessionEvent.countDocuments({ userId, type: 'ai_question' }),
      WatchSpace.countDocuments({ hostUserId: userId }),
    ]);

    const titleIds = [...new Set(interactions.map((i) => String(i.titleId?._id || i.titleId)))];
    const watchedTitles = await Title.find({ _id: { $in: titleIds } });
    const titleMap = new Map(watchedTitles.map((title) => [String(title._id), title.toPublic()]));

    const recentMap = new Map();
    for (const interaction of interactions) {
      const id = String(interaction.titleId?._id || interaction.titleId);
      if (recentMap.has(id)) continue;
      recentMap.set(id, {
        title: titleMap.get(id) || (interaction.titleId?.name ? interaction.titleId : null),
        lastWatchedAt: interaction.createdAt,
        completionRatio: Number((interaction.completionRatio || 0).toFixed(2)),
        rating: interaction.rating || null,
        watchSpaceId: interaction.watchSpaceId ? String(interaction.watchSpaceId) : null,
      });
    }

    const recommendations = await recommendationService.recommendationsFor(req.user, { limit: 8 });

    const activeRooms = spaces.map((space) => {
      const runtime = roomRuntime.getRoom(space._id);
      return {
        ...space.toPublic(),
        title: space.titleId?.toPublic ? space.titleId.toPublic() : null,
        live: Boolean(runtime && !runtime.ended),
        participantCount: runtime ? runtime.connected.size : space.participantIds.length,
      };
    });

    const totalWatchedSeconds = interactions.reduce(
      (sum, interaction) => sum + (interaction.watchedSeconds || 0),
      0
    );

    res.json({
      user: req.user.toPublic(),
      stats: {
        titlesWatched: recentMap.size,
        hoursWatched: Number((totalWatchedSeconds / 3600).toFixed(1)),
        aiQuestionsAsked: aiQuestions,
        sessionsHosted,
      },
      recentlyWatched: [...recentMap.values()].slice(0, 8),
      activeRooms: activeRooms.filter((room) => room.live),
      upcomingRooms: activeRooms.filter((room) => !room.live),
      recommendations,
    });
  })
);

module.exports = router;
