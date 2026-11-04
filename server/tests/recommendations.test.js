'use strict';

const { connectDb, clearDb, disconnectDb } = require('./helpers/db');
const { seedDatabase } = require('../src/seed');
const Title = require('../src/models/Title');
const User = require('../src/models/User');
const Interaction = require('../src/models/Interaction');
const recommendationService = require('../src/services/recommendationService');

function plainTitle(id, name, genre, synopsis) {
  return { _id: id, name, genres: [genre], synopsis, timeline: [], durationSeconds: 600 };
}

describe('hybrid recommender (pure)', () => {
  const titles = [
    plainTitle('t1', 'Dragon Fire', 'Fantasy', 'A dragon rider fantasy quest'),
    plainTitle('t2', 'Dragon Storm', 'Fantasy', 'A dragon fantasy quest across the sea'),
    plainTitle('t3', 'Office Laughs', 'Comedy', 'An office comedy about printers'),
  ];
  const interaction = (userId, titleId, extra = {}) => ({
    _id: `${userId}-${titleId}`,
    userId,
    titleId,
    completionRatio: 1,
    completed: true,
    rating: 5,
    createdAt: new Date(),
    ...extra,
  });

  test('content similarity outranks an unrelated genre and skips completed titles', () => {
    const interactions = [interaction('u1', 't1')];
    const model = recommendationService.buildModel(titles, interactions);
    const ranked = recommendationService.rankForUser({ model, userId: 'u1', user: null, limit: 5 });

    expect(ranked.map((row) => row.titleId)).toEqual(['t2', 't3']);
    expect(ranked[0].components.content).toBeGreaterThan(ranked[1].components.content);
    expect(ranked[0].reasons.length).toBeGreaterThan(0);
  });

  test('a cold-start user still gets a ranked, explained rail', () => {
    const interactions = [interaction('u2', 't1')];
    const model = recommendationService.buildModel(titles, interactions);
    const ranked = recommendationService.rankForUser({ model, userId: 'brand-new', user: null, limit: 3 });
    expect(ranked).toHaveLength(3);
    for (const row of ranked) {
      expect(row.reasons.length).toBeGreaterThan(0);
      expect(row.score).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('recommender against the seeded catalogue', () => {
  beforeAll(async () => {
    await connectDb();
    await clearDb();
    await seedDatabase();
    recommendationService.invalidate();
  });

  afterAll(async () => {
    await disconnectDb();
  });

  test('leave-one-out precision@5 clears the PRD target', async () => {
    const model = await recommendationService.loadModel();
    const evaluation = model.evaluation;
    expect(evaluation.evaluatedUsers).toBeGreaterThanOrEqual(5);
    expect(evaluation.precisionAt5).toBeGreaterThanOrEqual(0.6);
  });

  test('completed titles never appear in a user rail', async () => {
    const viewer = await User.findOne({ email: 'viewer@watchspaces.dev' });
    const completed = await Interaction.find({ userId: viewer._id, completed: true }).lean();
    expect(completed.length).toBeGreaterThan(0);

    const rail = await recommendationService.recommendationsFor(viewer, { limit: 10 });
    const completedIds = new Set(completed.map((row) => String(row.titleId)));
    expect(rail.some((row) => completedIds.has(row.titleId))).toBe(false);
  });

  test('new interactions change the cached rail after invalidation', async () => {
    const fresh = await User.create({
      email: 'rail-test@example.com',
      displayName: 'Rail Test',
      passwordHash: await User.hashPassword('RailTest123'),
      role: 'viewer',
      preferences: { genreAffinity: ['Comedy'] },
    });
    const before = await recommendationService.recommendationsFor(fresh, { limit: 3 });

    const comedy = await Title.findOne({ slug: 'big-buck-bunny' });
    await Interaction.create({
      userId: fresh._id,
      titleId: comedy._id,
      watchedSeconds: comedy.durationSeconds,
      completionRatio: 1,
      completed: true,
      rating: 5,
    });
    recommendationService.invalidate();

    const after = await recommendationService.recommendationsFor(fresh, { limit: 3 });
    expect(after.some((row) => row.titleId === String(comedy._id))).toBe(false);
    expect(after.length).toBeGreaterThan(0);
    expect(before.length).toBeGreaterThan(0);
  });
});
