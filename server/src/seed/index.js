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

async function seedTitles() {
  const titles = new Map();
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
    } else {
      // Keep seed metadata authoritative on reseed.
      title.set({ ...definition, timeline: validation.events });
      await title.save();
    }
    titles.set(definition.slug, title);
  }
  return titles;
}

async function seedInteractions(users, titles) {
  const existing = await Interaction.countDocuments();
  if (existing > 0) return existing;

  const base = new Date('2026-09-01T18:00:00Z').getTime();
  const docs = [];
  DEMO_INTERACTIONS.forEach((entry, index) => {
    const user = users.get(entry.key);
    const title = titles.get(entry.slug);
    if (!user || !title) return;
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
 * Media URLs and poster frames are deployment facts rather than editorial
 * content: refresh them for existing titles on every boot, so a database seeded
 * before a poster or clip existed does not keep serving the stale one.
 */
async function reconcileCatalogueMedia() {
  for (const definition of TITLES) {
    await Title.updateOne(
      { slug: definition.slug },
      {
        $set: {
          videoAssetUrl: definition.videoAssetUrl,
          fallbackAssetUrl: definition.fallbackAssetUrl,
          posterUrl: definition.posterUrl,
          durationSeconds: definition.durationSeconds,
          license: definition.license,
        },
      }
    );
  }
}

/**
 * Idempotent demo seed. `onlyIfEmpty` makes server bootstrap cheap on restarts.
 */
async function seedDatabase({ onlyIfEmpty = false } = {}) {
  const titleCount = await Title.countDocuments();
  if (onlyIfEmpty && titleCount > 0) {
    await reconcileCatalogueMedia();
    return false;
  }

  const users = await seedUsers();
  const titles = await seedTitles();
  const interactionCount = await seedInteractions(users, titles);
  const room = await seedDemoRoom(users.get('host'), users.get('viewer'), titles);
  await Interaction.updateOne(
    { userId: users.get('host')._id, titleId: titles.get('sintel')._id },
    { $set: { watchSpaceId: room._id } }
  );

  log.info('seed_complete', {
    users: users.size,
    titles: titles.size,
    interactions: interactionCount,
    demoRoom: room.inviteCode,
  });
  return true;
}

module.exports = { seedDatabase };
