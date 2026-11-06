'use strict';

const User = require('../models/User');
const Title = require('../models/Title');
const Interaction = require('../models/Interaction');
const WatchSpace = require('../models/WatchSpace');
const { createLogger } = require('../lib/logger');
const { TITLES, DEMO_USERS, DEMO_INTERACTIONS } = require('./titles');
const { validateTimeline } = require('../services/timelineService');

const log = createLogger('seed');

async function seedUsers() {
  const users = new Map();
  for (const demo of DEMO_USERS) {
    let user = await User.findOne({ email: demo.email });
    if (!user) {
      user = await User.create({
        email: demo.email,
        displayName: demo.displayName,
        passwordHash: await User.hashPassword(demo.password),
        role: demo.role,
        preferences: { subtitleLocale: 'en', genreAffinity: demo.genreAffinity || [] },
      });
    }
    users.set(demo.key, user);
  }
  return users;
}

/**
 * Titles are reconciled on every boot, not only on an empty database.
 *
 * A catalogue that only seeds when it is empty means a database created before
 * a title (or its poster or bundled clip) existed never learns about it. That
 * is exactly how blank cards and dead video sources survived a restart.
 *
 * Existing titles get their media fields refreshed but keep their authored
 * timeline: admins edit timelines in the app, and a restart must not silently
 * revert that work.
 */
async function seedTitles() {
  const titles = new Map();
  let created = 0;

  for (const definition of TITLES) {
    const validation = validateTimeline(definition.timeline, {
      durationSeconds: definition.durationSeconds,
    });
    if (!validation.valid) {
      throw new Error(
        `Seed timeline for ${definition.name} is invalid: ${JSON.stringify(validation.errors)}`
      );
    }

    let title = await Title.findOne({ slug: definition.slug });
    if (!title) {
      title = await Title.create({
        ...definition,
        timeline: validation.events,
      });
      created += 1;
    } else {
      title.set({
        posterUrl: definition.posterUrl,
        videoAssetUrl: definition.videoAssetUrl,
        fallbackAssetUrl: definition.fallbackAssetUrl,
        durationSeconds: definition.durationSeconds,
      });
      await title.save();
    }
    titles.set(definition.slug, title);
  }

  return { titles, created };
}

/**
 * Insert only the seeded interactions that are missing, so a title added to the
 * catalogue later still gets its demo signal for the recommender.
 */
async function seedInteractions(users, titles) {
  const existing = await Interaction.find({ source: 'seed' }, { userId: 1, titleId: 1 });
  const known = new Set(existing.map((row) => `${row.userId}:${row.titleId}`));

  const base = new Date('2026-09-01T18:00:00Z').getTime();
  const docs = [];
  DEMO_INTERACTIONS.forEach((entry, index) => {
    const user = users.get(entry.key);
    const title = titles.get(entry.slug);
    if (!user || !title) return;
    if (known.has(`${user._id}:${title._id}`)) return;

    const createdAt = new Date(base + index * 6 * 60 * 60 * 1000);
    const ratio = entry.completed ? 1 : entry.ratio || 0.4;
    docs.push({
      userId: user._id,
      titleId: title._id,
      watchedSeconds: Math.round(title.durationSeconds * ratio),
      completionRatio: ratio,
      completed: Boolean(entry.completed),
      rating: entry.rating,
      source: 'seed',
      createdAt,
      updatedAt: createdAt,
    });
  });

  if (!docs.length) return 0;
  const created = await Interaction.insertMany(docs, { ordered: true });
  log.info('interactions_seeded', { count: created.length });
  return created.length;
}

async function seedDemoRoom(host, viewer, titles) {
  const existing = await WatchSpace.findOne({ inviteCode: 'NX-DEMO' });
  if (existing) return existing;

  const title = titles.get('sintel');
  return WatchSpace.create({
    titleId: title._id,
    hostUserId: host._id,
    name: 'Sintel · Friday night watch party',
    inviteCode: 'NX-DEMO',
    status: 'scheduled',
    visibility: 'public',
    settings: {
      maxParticipants: 25,
      aiVerbosity: 'normal',
      votingEnabled: true,
      subtitlesEnabled: true,
    },
    participantIds: [host._id, viewer._id],
    peakParticipants: 2,
  });
}

/**
 * Idempotent demo seed. Safe to run on every boot: users, titles and demo
 * interactions are created only when missing.
 */
async function seedDatabase() {
  const users = await seedUsers();
  const { titles, created: titlesCreated } = await seedTitles();
  const interactionsCreated = await seedInteractions(users, titles);
  const room = await seedDemoRoom(users.get('host'), users.get('viewer'), titles);
  await Interaction.updateOne(
    { userId: users.get('host')._id, titleId: titles.get('sintel')._id },
    { $set: { watchSpaceId: room._id } }
  );

  log.info('seed_complete', {
    users: users.size,
    titles: titles.size,
    titlesCreated,
    interactionsCreated,
    demoRoom: room.inviteCode,
  });
  return titlesCreated > 0 || interactionsCreated > 0;
}

module.exports = { seedDatabase };
