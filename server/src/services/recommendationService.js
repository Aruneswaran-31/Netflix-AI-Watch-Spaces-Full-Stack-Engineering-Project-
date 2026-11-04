'use strict';

/**
 * Hybrid recommender: content-based similarity (title metadata / authored tags)
 * blended with item-item collaborative filtering derived from co-watching, plus
 * a small popularity prior for cold start.
 *
 * The model is rebuilt from interaction data on demand (cheap at this dataset
 * size) and cached; `retrain` persists an offline precision@k report.
 */

const Title = require('../models/Title');
const Interaction = require('../models/Interaction');
const User = require('../models/User');
const RecommendationRun = require('../models/RecommendationRun');
const { createLogger } = require('../lib/logger');

const log = createLogger('recommender');

const WEIGHTS = { content: 0.6, collaborative: 0.35, popularity: 0.05 };
const STOPWORDS = new Set(
  'the a an and or of in on at to for from with by is are was were be as it its this that'.split(' ')
);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function vectorizeTitle(title) {
  const vector = new Map();
  const add = (token, weight) => {
    if (!token) return;
    vector.set(token, (vector.get(token) || 0) + weight);
  };
  for (const token of tokenize(title.name)) add(token, 2);
  for (const genre of title.genres || []) add(tokenize(genre).join('_'), 3);
  for (const token of tokenize(title.synopsis)) add(token, 0.6);
  for (const event of title.timeline || []) {
    for (const tag of event.tags || []) add(tokenize(tag).join('_'), 1.2);
    if (event.character) add(tokenize(event.character).join('_'), 1);
  }
  let norm = 0;
  for (const value of vector.values()) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  for (const [key, value] of vector) vector.set(key, value / norm);
  return vector;
}

function cosine(a, b) {
  if (!a || !b) return 0;
  let dot = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [key, value] of small) {
    const other = large.get(key);
    if (other) dot += value * other;
  }
  return dot;
}

function interactionWeight(interaction) {
  const ratingComponent = interaction.rating ? (interaction.rating / 5) * 0.6 : 0.3;
  const completionComponent = (interaction.completionRatio || 0) * 0.5;
  const completedComponent = interaction.completed ? 0.5 : 0;
  return Math.max(0.1, 0.4 + ratingComponent + completionComponent + completedComponent);
}

function buildModel(titles, interactions, users = []) {
  const items = new Map();
  for (const title of titles) {
    items.set(String(title._id), {
      title,
      id: String(title._id),
      vector: vectorizeTitle(title),
      genres: title.genres || [],
    });
  }

  const byUser = new Map();
  for (const interaction of interactions) {
    const userId = String(interaction.userId);
    if (!byUser.has(userId)) byUser.set(userId, []);
    byUser.get(userId).push(interaction);
  }

  // Item-item co-occurrence (users who watched both titles).
  const co = new Map();
  const totals = new Map();
  for (const list of byUser.values()) {
    for (const interaction of list) {
      const id = String(interaction.titleId);
      totals.set(id, (totals.get(id) || 0) + interactionWeight(interaction));
    }
    for (let i = 0; i < list.length; i += 1) {
      for (let j = 0; j < list.length; j += 1) {
        if (i === j) continue;
        const a = String(list[i].titleId);
        const b = String(list[j].titleId);
        if (!co.has(a)) co.set(a, new Map());
        const weight = Math.min(interactionWeight(list[i]), interactionWeight(list[j]));
        co.get(a).set(b, (co.get(a).get(b) || 0) + weight);
      }
    }
  }

  const itemSimilarity = new Map();
  for (const [a, row] of co) {
    const normA = Math.sqrt(totals.get(a) || 1);
    const sims = new Map();
    for (const [b, value] of row) {
      const normB = Math.sqrt(totals.get(b) || 1);
      sims.set(b, value / (normA * normB));
    }
    itemSimilarity.set(a, sims);
  }

  const popularity = new Map();
  const maxTotal = Math.max(1, ...totals.values());
  for (const [id, total] of totals) popularity.set(id, total / maxTotal);

  // User taste profiles: weighted mean of interacted item vectors.
  const profiles = new Map();
  for (const [userId, list] of byUser) {
    const profile = new Map();
    let totalWeight = 0;
    for (const interaction of list) {
      const item = items.get(String(interaction.titleId));
      if (!item) continue;
      const weight = interactionWeight(interaction);
      totalWeight += weight;
      for (const [token, value] of item.vector) {
        profile.set(token, (profile.get(token) || 0) + value * weight);
      }
    }
    if (totalWeight > 0) {
      let norm = 0;
      for (const value of profile.values()) norm += value * value;
      norm = Math.sqrt(norm) || 1;
      for (const [token, value] of profile) profile.set(token, value / norm);
    }
    profiles.set(userId, profile);
  }

  const genreAffinityVectors = new Map();
  for (const user of users) {
    const affinity = user.preferences?.genreAffinity || [];
    if (!affinity.length) continue;
    const vector = new Map();
    for (const genre of affinity) vector.set(tokenize(genre).join('_'), 1);
    genreAffinityVectors.set(String(user._id), vector);
  }

  return { items, itemSimilarity, popularity, profiles, genreAffinityVectors, byUser };
}

function rankForUser({ model, userId, user, limit = 10 }) {
  const key = String(userId);
  const profile = model.profiles.get(key) || model.genreAffinityVectors.get(key) || new Map();
  const seen = model.byUser.get(key) || [];
  const seenMap = new Map(seen.map((i) => [String(i.titleId), i]));
  const seenWeightTotal = seen.reduce((sum, i) => sum + interactionWeight(i), 0) || 1;

  const results = [];
  for (const [id, item] of model.items) {
    const prior = seenMap.get(id);
    if (prior?.completed) continue;

    const contentScore = cosine(profile, item.vector);
    let cfScore = 0;
    for (const interaction of seen) {
      const sims = model.itemSimilarity.get(String(interaction.titleId));
      if (!sims) continue;
      const sim = sims.get(id) || 0;
      cfScore += sim * interactionWeight(interaction);
    }
    cfScore = Math.min(1, cfScore / seenWeightTotal);
    const popularityScore = model.popularity.get(id) || 0;

    let score =
      WEIGHTS.content * contentScore +
      WEIGHTS.collaborative * cfScore +
      WEIGHTS.popularity * popularityScore;

    if (prior && !prior.completed) score *= 0.6;
    if (!seen.length && profile.size === 0) score = popularityScore * 0.5 + contentScore * 0.5;

    const reasons = [];
    if (prior) reasons.push(`Continue "${item.title.name}" (${Math.round((prior.completionRatio || 0) * 100)}% watched)`);
    if (contentScore > 0.05) {
      const matchingGenre = (user?.preferences?.genreAffinity || []).find((genre) =>
        (item.title.genres || []).some((g) => g.toLowerCase() === String(genre).toLowerCase())
      );
      if (matchingGenre) reasons.push(`Matches your ${matchingGenre} affinity`);
      else if (item.title.genres?.length) reasons.push(`${item.title.genres.slice(0, 2).join(' · ')} like your recent titles`);
    }
    if (cfScore > 0.02) reasons.push('Watched by people with your taste');
    if (!reasons.length) reasons.push('Popular in the catalogue right now');

    results.push({
      titleId: id,
      title: item.title.toPublic ? item.title.toPublic() : item.title,
      score: Number(score.toFixed(4)),
      components: {
        content: Number(contentScore.toFixed(4)),
        collaborative: Number(cfScore.toFixed(4)),
        popularity: Number(popularityScore.toFixed(4)),
      },
      reasons: reasons.slice(0, 2),
    });
  }

  results.sort((a, b) => b.score - a.score || a.titleId.localeCompare(b.titleId));
  return results.slice(0, limit);
}

/**
 * Leave-one-out evaluation: hide each user's most recent interaction, rank the
 * catalogue from the rest, and measure how often the hidden title lands in the
 * top k. Pure function so the offline script and Jest share it.
 */
function evaluatePrecisionAtK({ model, interactions, k = 5 }) {
  const byUser = new Map();
  for (const interaction of interactions) {
    const key = String(interaction.userId);
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(interaction);
  }

  let hitCount = 0;
  let evaluatedUsers = 0;
  const perUser = [];

  for (const [userId, list] of byUser) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const hidden = sorted[0];
    const trainingInteractions = interactions.filter(
      (interaction) => String(interaction._id) !== String(hidden._id)
    );
    const trainingModel = buildModel(
      [...model.items.values()].map((item) => item.title),
      trainingInteractions
    );
    const ranked = rankForUser({ model: trainingModel, userId, limit: k, user: null });
    const hit = ranked.some((row) => row.titleId === String(hidden.titleId));
    if (hit) hitCount += 1;
    evaluatedUsers += 1;
    perUser.push({ userId, hit, ranked: ranked.map((row) => row.titleId) });
  }

  return {
    precisionAt5: evaluatedUsers ? Number((hitCount / evaluatedUsers).toFixed(4)) : 0,
    recallAt5: evaluatedUsers ? Number((hitCount / evaluatedUsers).toFixed(4)) : 0,
    evaluatedUsers,
    perUser,
  };
}

let cache = null;
let cacheVersion = 0;

function invalidate() {
  cache = null;
  cacheVersion += 1;
}

async function loadModel() {
  if (cache) return cache;
  const started = Date.now();
  const [titles, interactions, users] = await Promise.all([
    Title.find(),
    Interaction.find().lean(),
    User.find().select('displayName preferences').lean(),
  ]);
  const model = buildModel(titles, interactions, users);
  const base = {
    model,
    titles,
    interactions,
    users,
    builtAt: new Date(),
    buildMs: Date.now() - started,
  };

  // Offline eval uses the same pure function the script reports.
  const evaluation = evaluatePrecisionAtK({ model, interactions, k: 5 });
  cache = { ...base, evaluation };
  log.info('model_built', {
    items: model.items.size,
    interactions: interactions.length,
    precisionAt5: evaluation.precisionAt5,
    buildMs: base.buildMs,
  });
  return cache;
}

async function recommendationsFor(user, { limit = 10 } = {}) {
  const { model } = await loadModel();
  return rankForUser({ model, userId: user._id, user, limit });
}

async function retrain() {
  invalidate();
  const started = Date.now();
  const loaded = await loadModel();
  const run = await RecommendationRun.create({
    method: 'hybrid-content-cf',
    itemCount: loaded.model.items.size,
    interactionCount: loaded.interactions.length,
    userCount: loaded.users.length,
    precisionAt5: loaded.evaluation.precisionAt5,
    recallAt5: loaded.evaluation.recallAt5,
    evaluatedUsers: loaded.evaluation.evaluatedUsers,
    details: {
      weights: WEIGHTS,
      buildMs: loaded.buildMs,
      perUser: loaded.evaluation.perUser,
      trainedAt: new Date().toISOString(),
    },
    durationMs: Date.now() - started,
  });
  return run;
}

async function latestRun() {
  return RecommendationRun.findOne().sort({ createdAt: -1 }).lean();
}

module.exports = {
  buildModel,
  vectorizeTitle,
  cosine,
  interactionWeight,
  rankForUser,
  evaluatePrecisionAtK,
  recommendationsFor,
  loadModel,
  invalidate,
  retrain,
  latestRun,
  WEIGHTS,
};
