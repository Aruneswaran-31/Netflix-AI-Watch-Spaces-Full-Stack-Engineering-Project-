'use strict';

/**
 * Offline recommender evaluation.
 *
 * Seeds the demo catalogue if the database is empty, builds the hybrid model and
 * reports leave-one-out precision@5/recall@5 together with build timing. This is
 * the same pure evaluation function that the Jest suite uses.
 */

const { connectDatabase, disconnectDatabase } = require('../src/db');
const { seedDatabase } = require('../src/seed');
const recommendationService = require('../src/services/recommendationService');
const Interaction = require('../src/models/Interaction');

async function main() {
  await connectDatabase();
  await seedDatabase();

  const loaded = await recommendationService.loadModel();
  const [{ interactions = 0 } = {}] = await Interaction.aggregate([
    { $count: 'interactions' },
  ]);

  const report = {
    evaluatedAt: new Date().toISOString(),
    method: 'hybrid-content-cf',
    weights: recommendationService.WEIGHTS,
    catalogueItems: loaded.model.items.size,
    interactions,
    users: loaded.users.length,
    evaluatedUsers: loaded.evaluation.evaluatedUsers,
    precisionAt5: loaded.evaluation.precisionAt5,
    recallAt5: loaded.evaluation.recallAt5,
    buildMs: loaded.buildMs,
  };

  console.log(JSON.stringify(report, null, 2));
  await disconnectDatabase();
  return report;
}

main().catch(async (error) => {
  console.error('evaluation failed:', error.message);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
