'use strict';

const request = require('supertest');
const { connectDb, clearDb, disconnectDb } = require('./helpers/db');
const { seedDatabase } = require('../src/seed');
const { createApp } = require('../src/app');
const analytics = require('../src/services/analyticsService');
const SessionEvent = require('../src/models/SessionEvent');
const Title = require('../src/models/Title');
const WatchSpace = require('../src/models/WatchSpace');

const app = createApp();
let hostToken;
let spaceId;

beforeAll(async () => {
  await connectDb();
  await clearDb();
  await seedDatabase();

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'host@watchspaces.dev', password: 'Host123!' });
  hostToken = login.body.accessToken;
  const viewer = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'viewer@watchspaces.dev', password: 'Viewer123!' });

  const title = await Title.findOne({ slug: 'elephants-dream' });
  const created = await request(app)
    .post('/api/v1/watch-spaces')
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ titleId: String(title._id), name: 'Analytics room' });
  expect(created.status).toBe(201);
  spaceId = created.body.watchSpaceId;

  const hostId = login.body.user.id;
  const viewerId = viewer.body.user.id;
  const base = Date.now() - 60_000;
  const at = (offset) => new Date(base + offset);

  await SessionEvent.insertMany([
    { watchSpaceId: spaceId, type: 'participant_joined', userId: hostId, createdAt: at(0) },
    { watchSpaceId: spaceId, type: 'participant_joined', userId: viewerId, createdAt: at(1000) },
    { watchSpaceId: spaceId, type: 'chat', userId: viewerId, createdAt: at(2000) },
    {
      watchSpaceId: spaceId,
      type: 'ai_question',
      userId: viewerId,
      payload: { question: 'Who is the boy?' },
      createdAt: at(3000),
    },
    { watchSpaceId: spaceId, type: 'ai_answer', userId: viewerId, createdAt: at(3200) },
    { watchSpaceId: spaceId, type: 'trivia_surfaced', createdAt: at(4000) },
    { watchSpaceId: spaceId, type: 'participant_left', userId: viewerId, createdAt: at(5000) },
  ]);

  // Drop the implicit room_created event so the fixture is exactly the 7 events above.
  await SessionEvent.deleteMany({ watchSpaceId: spaceId, type: 'room_created' });

  await WatchSpace.findByIdAndUpdate(spaceId, {
    $set: { chatCount: 1, aiQuestionCount: 1, triviaCount: 1, peakParticipants: 2 },
  });
});

afterAll(async () => {
  await disconnectDb();
});

test('session summary computes counts and peak concurrency from the event log', async () => {
  const summary = await analytics.sessionSummary(spaceId);
  expect(summary.eventCount).toBe(7);
  expect(summary.joinedCount).toBe(2);
  expect(summary.leftCount).toBe(1);
  expect(summary.chatMessages).toBe(1);
  expect(summary.aiQuestions).toBe(1);
  expect(summary.aiAnswers).toBe(1);
  expect(summary.triviaSurfaced).toBe(1);
  expect(summary.peakConcurrentParticipants).toBe(2);
  expect(summary.observedDurationSeconds).toBe(5);
  expect(summary.timeline.length).toBe(7);
});

test('host analytics reports reconciled counters and live playback position', async () => {
  const response = await request(app)
    .get(`/api/v1/watch-spaces/${spaceId}/analytics`)
    .set('Authorization', `Bearer ${hostToken}`);

  expect(response.status).toBe(200);
  const { analytics: report } = response.body;
  expect(report.chatMessages).toBe(1);
  expect(report.aiQuestions).toBe(1);
  expect(report.peakConcurrentParticipants).toBe(2);
  expect(report.counters).toMatchObject({
    chatCount: 1,
    aiQuestionCount: 1,
    triviaCount: 1,
    peakParticipants: 2,
  });
  expect(report.reconciled).toEqual({
    chatMessages: true,
    aiQuestions: true,
    triviaSurfaced: true,
    peakParticipants: true,
  });
  expect(report.playbackPositionSeconds).toBeGreaterThanOrEqual(0);
});
