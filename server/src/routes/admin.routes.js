'use strict';

const express = require('express');
const { z } = require('zod');
const Title = require('../models/Title');
const User = require('../models/User');
const Interaction = require('../models/Interaction');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/errors');
const { cleanText } = require('../lib/sanitize');
const { validateTimeline } = require('../services/timelineService');
const recommendationService = require('../services/recommendationService');
const roomRuntime = require('../services/roomRuntime');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

router.get(
  '/titles',
  asyncHandler(async (_req, res) => {
    const titles = await Title.find().sort({ name: 1 });
    res.json({
      titles: titles.map((title) => ({
        ...title.toPublic(),
        timeline: title.timeline,
      })),
    });
  })
);

router.post(
  '/titles',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(1).max(160),
        year: z.coerce.number().int().min(1900).max(2100).optional(),
        synopsis: z.string().max(2000).optional().default(''),
        durationSeconds: z.coerce.number().int().min(1),
        genres: z.array(z.string().min(1).max(40)).max(10).optional().default([]),
        videoAssetUrl: z.string().min(4).max(1000),
        posterUrl: z.string().max(1000).optional().default(''),
        accentColor: z.string().max(20).optional().default('#e50914'),
        license: z.string().max(300).optional().default(''),
        timeline: z.array(z.any()).optional().default([]),
      })
      .parse(req.body);

    const baseSlug = slugify(body.name) || `title-${Date.now()}`;
    let slug = baseSlug;
    for (let attempt = 1; await Title.exists({ slug }); attempt += 1) {
      slug = `${baseSlug}-${attempt}`;
    }

    let timeline = [];
    if (body.timeline.length) {
      const validation = validateTimeline(body.timeline, { durationSeconds: body.durationSeconds });
      if (!validation.valid) {
        throw ApiError.badRequest('Timeline failed validation', validation.errors);
      }
      timeline = validation.events;
    }

    const title = await Title.create({
      ...body,
      slug,
      timeline,
      createdBy: req.user._id,
    });
    res.status(201).json({ title: { ...title.toPublic(), timeline: title.timeline } });
  })
);

router.patch(
  '/titles/:id',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(1).max(160).optional(),
        year: z.coerce.number().int().min(1900).max(2100).optional(),
        synopsis: z.string().max(2000).optional(),
        durationSeconds: z.coerce.number().int().min(1).optional(),
        genres: z.array(z.string().min(1).max(40)).max(10).optional(),
        videoAssetUrl: z.string().min(4).max(1000).optional(),
        posterUrl: z.string().max(1000).optional(),
        accentColor: z.string().max(20).optional(),
        license: z.string().max(300).optional(),
      })
      .parse(req.body);

    const title = await Title.findById(req.params.id);
    if (!title) throw ApiError.notFound('Title not found');
    Object.assign(title, body);
    if (body.name) title.slug = slugify(body.name);
    await title.save();
    res.json({ title: { ...title.toPublic(), timeline: title.timeline } });
  })
);

/**
 * POST /api/v1/admin/titles/:id/timeline/validate — dry run with clear,
 * path-based errors, used by the admin metadata form.
 */
router.post(
  '/titles/:id/timeline/validate',
  asyncHandler(async (req, res) => {
    const body = z.object({ timeline: z.array(z.any()) }).parse(req.body);
    const title = await Title.findById(req.params.id);
    if (!title) throw ApiError.notFound('Title not found');
    const validation = validateTimeline(body.timeline, {
      durationSeconds: title.durationSeconds,
    });
    res.status(validation.valid ? 200 : 422).json({
      valid: validation.valid,
      errors: validation.errors,
      counts: {
        events: validation.events.length,
        trivia: validation.events.filter((event) => event.type === 'trivia').length,
        characters: validation.events.filter((event) => event.type === 'character').length,
        glossary: validation.events.filter((event) => event.type === 'glossary').length,
        variationPoints: validation.events.filter((event) => event.type === 'variation_point')
          .length,
      },
    });
  })
);

/** PUT /api/v1/admin/titles/:id/timeline — validated, versioned timeline upload. */
router.put(
  '/titles/:id/timeline',
  asyncHandler(async (req, res) => {
    const body = z.object({ timeline: z.array(z.any()) }).parse(req.body);
    const title = await Title.findById(req.params.id);
    if (!title) throw ApiError.notFound('Title not found');

    const validation = validateTimeline(body.timeline, {
      durationSeconds: title.durationSeconds,
    });
    if (!validation.valid) {
      return res.status(422).json({
        error: {
          code: 'validation_failed',
          message: 'Timeline failed validation',
          details: validation.errors,
        },
      });
    }

    title.timeline = validation.events;
    await title.save();

    // Live rooms pick up the new metadata without a restart.
    for (const room of roomRuntime._rooms.values()) {
      if (String(room.titleId) === String(title._id)) {
        room.title = title;
        roomRuntime.emit(room, 'room.timeline.updated', {
          titleId: String(title._id),
          eventCount: title.timeline.length,
        });
      }
    }

    res.json({
      title: title.toPublic(),
      timeline: title.timeline,
      counts: {
        events: title.timeline.length,
        trivia: title.timeline.filter((event) => event.type === 'trivia').length,
        variationPoints: title.timeline.filter((event) => event.type === 'variation_point').length,
      },
    });
  })
);

router.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const [users, interactionCounts] = await Promise.all([
      User.find().sort({ createdAt: 1 }).limit(200),
      Interaction.aggregate([{ $group: { _id: '$userId', count: { $sum: 1 } } }]),
    ]);
    const counts = new Map(interactionCounts.map((row) => [String(row._id), row.count]));
    res.json({
      users: users.map((user) => ({
        ...user.toPublic(),
        interactions: counts.get(String(user._id)) || 0,
      })),
    });
  })
);

router.patch(
  '/users/:id/role',
  asyncHandler(async (req, res) => {
    const body = z.object({ role: z.enum(['viewer', 'host', 'admin']) }).parse(req.body);
    const user = await User.findById(req.params.id);
    if (!user) throw ApiError.notFound('User not found');
    user.role = body.role;
    await user.save();
    res.json({ user: user.toPublic() });
  })
);

router.post(
  '/recommendations/retrain',
  asyncHandler(async (_req, res) => {
    const run = await recommendationService.retrain();
    res.json({ run });
  })
);

router.get(
  '/recommendations/report',
  asyncHandler(async (_req, res) => {
    const [latest, model] = await Promise.all([
      recommendationService.latestRun(),
      recommendationService.loadModel(),
    ]);
    res.json({
      latestRun: latest,
      live: {
        items: model.model.items.size,
        interactions: model.interactions.length,
        precisionAt5: model.evaluation.precisionAt5,
        evaluatedUsers: model.evaluation.evaluatedUsers,
        builtAt: model.builtAt,
        buildMs: model.buildMs,
      },
    });
  })
);

module.exports = router;
module.exports.slugify = slugify;
