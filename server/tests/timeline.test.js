'use strict';

const {
  validateTimeline,
  eventsInRange,
  markersCrossed,
  variationPoints,
  isTriviaEligible,
} = require('../src/services/timelineService');
const { TITLES } = require('../src/seed/titles');

describe('timeline validation', () => {
  test('every seeded timeline is valid against its duration', () => {
    for (const title of TITLES) {
      const result = validateTimeline(title.timeline, { durationSeconds: title.durationSeconds });
      expect(result.valid).toBe(true);
      expect(result.events.length).toBe(title.timeline.length);
      expect(result.events.map((event) => event.ts)).toEqual(
        [...result.events.map((event) => event.ts)].sort((a, b) => a - b)
      );
    }
  });

  test('reports duplicate ids, missing glossary fields and timestamp overflow', () => {
    const result = validateTimeline(
      [
        { id: 'ev_same', ts: 5, type: 'trivia', text: 'One' },
        { id: 'ev_same', ts: 10, type: 'glossary', term: 'Cut' },
        { id: 'ev_late', ts: 900, type: 'trivia', text: 'Past the end' },
      ],
      { durationSeconds: 600 }
    );
    expect(result.valid).toBe(false);
    const codes = result.errors.map((error) => error.code);
    expect(codes).toContain('duplicate_id');
    expect(codes).toContain('missing_glossary_fields');
    expect(codes).toContain('timestamp_out_of_range');
  });

  test('variation points require a kind, two options and a valid default', () => {
    const result = validateTimeline(
      [
        {
          id: 'ev_var',
          ts: 30,
          type: 'variation_point',
          defaultOptionId: 'missing',
          options: [{ id: 'only', label: 'Only option' }],
        },
      ],
      { durationSeconds: 600 }
    );
    expect(result.valid).toBe(false);
    const messages = result.errors.map((error) => error.code);
    expect(messages).toContain('missing_variation_kind');
    expect(messages).toContain('missing_options');
  });

  test('assigns stable ids to newly authored events', () => {
    const result = validateTimeline([{ ts: 12, type: 'trivia', text: 'Fresh marker' }]);
    expect(result.valid).toBe(true);
    expect(result.events[0].id).toMatch(/^ev_[a-f0-9]{12}$/);
  });
});

describe('timeline queries', () => {
  const timeline = [
    { id: 'a', ts: 10, type: 'trivia', text: 'A' },
    { id: 'b', ts: 40, type: 'character', character: 'Scale' },
    { id: 'c', ts: 42, type: 'trivia', text: 'C' },
    { id: 'd', ts: 80, type: 'variation_point', options: [] },
  ];

  test('eventsInRange is inclusive and sorted', () => {
    expect(eventsInRange(timeline, 40, 80).map((event) => event.id)).toEqual(['b', 'c', 'd']);
  });

  test('markersCrossed does not replay markers skipped by a forward seek', () => {
    expect(markersCrossed(timeline, 0, 85, { maxWindowSeconds: 5 })).toEqual([]);
    expect(markersCrossed(timeline, 79, 85, { maxWindowSeconds: 10 }).map((event) => event.id)).toEqual([
      'd',
    ]);
    expect(markersCrossed(timeline, 40, 45).map((event) => event.id)).toEqual(['c']);
  });

  test('variationPoints filters authored variation markers', () => {
    expect(variationPoints(timeline).map((event) => event.id)).toEqual(['d']);
  });

  test('minimal verbosity only surfaces high-priority trivia', () => {
    expect(isTriviaEligible({ type: 'trivia', priority: 'normal' }, 'minimal')).toBe(false);
    expect(isTriviaEligible({ type: 'trivia', priority: 'high' }, 'minimal')).toBe(true);
    expect(isTriviaEligible({ type: 'trivia', priority: 'normal' }, 'normal')).toBe(true);
  });
});
