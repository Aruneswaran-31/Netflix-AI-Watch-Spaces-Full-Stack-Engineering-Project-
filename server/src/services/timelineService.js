'use strict';

const { z } = require('zod');
const { EVENT_TYPES, VARIATION_KINDS } = require('../models/Title');

const optionSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(160),
  description: z.string().max(400).optional().default(''),
  subtitle: z
    .object({
      locale: z.string().min(2).max(12).default('en'),
      text: z.string().min(1).max(500),
    })
    .optional(),
  assetRef: z.string().max(500).optional().default(''),
});

const timelineEventSchema = z.object({
  id: z.string().min(3).max(60).optional(),
  ts: z.number().min(0),
  endTs: z.number().min(0).optional(),
  type: z.enum(EVENT_TYPES),
  title: z.string().max(160).optional().default(''),
  text: z.string().max(1200).optional().default(''),
  scene: z.string().max(200).optional().default(''),
  character: z.string().max(120).optional().default(''),
  term: z.string().max(120).optional().default(''),
  definition: z.string().max(600).optional().default(''),
  tags: z.array(z.string().min(1).max(40)).max(20).optional().default([]),
  priority: z.enum(['normal', 'high']).optional().default('normal'),
  variationKind: z.enum(VARIATION_KINDS).optional(),
  options: z.array(optionSchema).optional(),
  defaultOptionId: z.string().max(40).optional().default(''),
});

const timelinePayloadSchema = z.object({
  timeline: z.array(timelineEventSchema).min(1).max(400),
});

/**
 * Validate a timeline upload. Returns structured, human-readable errors rather
 * than throwing, so the admin UI can render them inline.
 */
function validateTimeline(rawTimeline, { durationSeconds } = {}) {
  const parsed = timelinePayloadSchema.safeParse({ timeline: rawTimeline });
  const errors = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        path: issue.path.join('.') || 'timeline',
        message: issue.message,
        code: issue.code,
      });
    }
    return { valid: false, errors, events: [] };
  }

  const events = parsed.data.timeline.map((event) => ({ ...event }));
  const seen = new Set();
  const sorted = [...events].sort((a, b) => a.ts - b.ts);

  for (const [index, event] of events.entries()) {
    const label = `timeline[${index}]`;
    const id = event.id || `#${index}`;
    if (event.id && seen.has(event.id)) {
      errors.push({ path: label, message: `Duplicate event id "${event.id}"`, code: 'duplicate_id' });
    }
    if (event.id) seen.add(event.id);
    if (durationSeconds && event.ts > durationSeconds) {
      errors.push({
        path: `${label}.ts`,
        message: `Timestamp ${event.ts}s is past the title duration (${durationSeconds}s)`,
        code: 'timestamp_out_of_range',
      });
    }
    if (event.endTs !== undefined && event.endTs <= event.ts) {
      errors.push({
        path: `${label}.endTs`,
        message: 'endTs must be greater than ts',
        code: 'invalid_range',
      });
    }
    if (event.type === 'trivia' && !event.text) {
      errors.push({ path: `${label}.text`, message: 'Trivia events need text', code: 'missing_text' });
    }
    if (event.type === 'character' && !event.character) {
      errors.push({
        path: `${label}.character`,
        message: 'Character events need a character name',
        code: 'missing_character',
      });
    }
    if (event.type === 'glossary' && (!event.term || !event.definition)) {
      errors.push({
        path: `${label}`,
        message: 'Glossary events need both term and definition',
        code: 'missing_glossary_fields',
      });
    }
    if (event.type === 'variation_point') {
      if (!event.variationKind) {
        errors.push({
          path: `${label}.variationKind`,
          message: 'Variation points need variationKind (subtitle | localization | narrative)',
          code: 'missing_variation_kind',
        });
      }
      if (!event.options || event.options.length < 2) {
        errors.push({
          path: `${label}.options`,
          message: 'Variation points need at least two pre-approved options',
          code: 'missing_options',
        });
      } else {
        const optionIds = new Set();
        for (const [optionIndex, option] of event.options.entries()) {
          if (optionIds.has(option.id)) {
            errors.push({
              path: `${label}.options[${optionIndex}].id`,
              message: `Duplicate option id "${option.id}"`,
              code: 'duplicate_option',
            });
          }
          optionIds.add(option.id);
        }
        if (event.defaultOptionId && !optionIds.has(event.defaultOptionId)) {
          errors.push({
            path: `${label}.defaultOptionId`,
            message: 'defaultOptionId must reference one of the options',
            code: 'invalid_default_option',
          });
        }
      }
    }
  }

  // Stable ids for newly authored events, then sort by timestamp.
  const withIds = sorted.map((event) => ({
    ...event,
    id: event.id || `ev_${require('crypto').randomBytes(6).toString('hex')}`,
  }));

  return { valid: errors.length === 0, errors, events: withIds };
}

function normalizeTimeline(rawTimeline, options) {
  const result = validateTimeline(rawTimeline, options);
  if (!result.valid) {
    const error = new Error('Timeline failed validation');
    error.status = 422;
    error.code = 'validation_failed';
    error.details = result.errors;
    throw error;
  }
  return result.events;
}

function eventsInRange(timeline = [], from = 0, to = Number.MAX_SAFE_INTEGER) {
  return timeline
    .filter((event) => event.ts >= from && event.ts <= to)
    .sort((a, b) => a.ts - b.ts);
}

function variationPoints(timeline = []) {
  return timeline.filter((event) => event.type === 'variation_point');
}

function findVariation(timeline = [], variationId) {
  return timeline.find(
    (event) => event.type === 'variation_point' && (event.id === variationId || event.variationId === variationId)
  );
}

/**
 * Which authored markers did the room cross between two playhead positions?
 * Seeks forward never replay every skipped marker: the caller passes the last
 * observed position and a maximum catch-up window.
 */
function markersCrossed(timeline = [], fromExclusive, toInclusive, { maxWindowSeconds = 5 } = {}) {
  if (toInclusive <= fromExclusive) return [];
  const from = Math.max(fromExclusive, toInclusive - maxWindowSeconds);
  return eventsInRange(timeline, from + 1e-6, toInclusive).filter(
    (event) => event.type === 'trivia' || event.type === 'variation_point'
  );
}

function isTriviaEligible(event, verbosity) {
  if (event.type !== 'trivia') return false;
  if (verbosity === 'minimal') return event.priority === 'high';
  return true;
}

module.exports = {
  timelineEventSchema,
  timelinePayloadSchema,
  validateTimeline,
  normalizeTimeline,
  eventsInRange,
  variationPoints,
  findVariation,
  markersCrossed,
  isTriviaEligible,
};
