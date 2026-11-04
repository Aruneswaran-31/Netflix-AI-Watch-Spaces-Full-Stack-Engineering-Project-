'use strict';

const express = require('express');
const { z } = require('zod');
const Title = require('../models/Title');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/errors');
const { eventsInRange, variationPoints } = require('../services/timelineService');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        q: z.string().max(120).optional(),
        genre: z.string().max(60).optional(),
      })
      .parse(req.query);

    const filter = {};
    if (query.genre) filter.genres = query.genre;
    if (query.q) filter.name = { $regex: query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

    const titles = await Title.find(filter).sort({ name: 1 }).limit(60);
    res.json({ titles: titles.map((title) => title.toPublic()) });
  })
);

router.get(
  '/:titleId',
  asyncHandler(async (req, res) => {
    const title = await Title.findById(req.params.titleId);
    if (!title) throw ApiError.notFound('Title not found');
    res.json({
      title: {
        ...title.toPublic(),
        genres: title.genres,
        timelineSummary: {
          total: title.timeline.length,
          trivia: title.timeline.filter((event) => event.type === 'trivia').length,
          characters: title.timeline.filter((event) => event.type === 'character').length,
          glossary: title.timeline.filter((event) => event.type === 'glossary').length,
          variationPoints: variationPoints(title.timeline).length,
        },
      },
    });
  })
);

/**
 * GET /api/v1/titles/:titleId/timeline?from=0&to=600&types=trivia,character
 * Hydrates the co-pilot as playback advances. Shape matches PRD §7.3.2.
 */
router.get(
  '/:titleId/timeline',
  asyncHandler(async (req, res) => {
    const title = await Title.findById(req.params.titleId);
    if (!title) throw ApiError.notFound('Title not found');

    const query = z
      .object({
        from: z.coerce.number().min(0).optional(),
        to: z.coerce.number().min(0).optional(),
        types: z.string().max(200).optional(),
      })
      .parse(req.query);

    const from = query.from ?? 0;
    const to = query.to ?? title.durationSeconds;
    if (to < from) throw ApiError.badRequest('`to` must be greater than or equal to `from`');

    const wantedTypes = query.types
      ? new Set(query.types.split(',').map((value) => value.trim()))
      : null;

    const events = eventsInRange(title.timeline, from, to)
      .filter((event) => !wantedTypes || wantedTypes.has(event.type))
      .map((event) => ({
        id: event.id,
        ts: event.ts,
        endTs: event.endTs,
        type: event.type === 'variation_point' ? 'variationPoint' : event.type,
        title: event.title,
        text: event.text,
        scene: event.scene,
        character: event.character,
        term: event.term,
        definition: event.definition,
        tags: event.tags,
        priority: event.priority,
        ...(event.type === 'variation_point'
          ? {
              variationId: event.id,
              variationKind: event.variationKind,
              options: (event.options || []).map((option) => ({
                id: option.id,
                label: option.label,
                description: option.description,
                subtitle: option.subtitle,
                assetRef: option.assetRef,
              })),
            }
          : {}),
      }));

    res.json({ titleId: String(title._id), from, to, count: events.length, events });
  })
);

module.exports = router;
