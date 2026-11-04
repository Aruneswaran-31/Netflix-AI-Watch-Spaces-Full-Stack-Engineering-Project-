'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');
const { connectDb, clearDb, disconnectDb } = require('./helpers/db');
const { seedDatabase } = require('../src/seed');
const Title = require('../src/models/Title');
const User = require('../src/models/User');

const app = createApp();
let hostToken;
let viewerToken;
let adminToken;
let viewerId;
let titleId;
let spaceId;

async function login(email, password) {
  const response = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  return response.body.accessToken;
}

beforeAll(async () => {
  await connectDb();
  await clearDb();
  await seedDatabase();
  hostToken = await login('host@watchspaces.dev', 'Host123!');
  viewerToken = await login('viewer@watchspaces.dev', 'Viewer123!');
  adminToken = await login('admin@watchspaces.dev', 'Admin123!');
  const viewer = await User.findOne({ email: 'viewer@watchspaces.dev' });
  viewerId = String(viewer._id);
  const title = await Title.findOne({ slug: 'sintel' });
  titleId = String(title._id);
});

afterAll(async () => {
  await disconnectDb();
});

describe('authentication', () => {
  test('register returns a usable access token and refresh token', async () => {
    const registration = await request(app).post('/api/v1/auth/register').send({
      email: 'newcomer@example.com',
      password: 'CorrectHorse1',
      displayName: 'New Comer',
      accountType: 'viewer',
    });
    expect(registration.status).toBe(201);
    expect(registration.body.accessToken).toBeTruthy();
    expect(registration.body.user.role).toBe('viewer');

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${registration.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('newcomer@example.com');
  });

  test('rejects duplicate registration and bad passwords', async () => {
    const duplicate = await request(app).post('/api/v1/auth/register').send({
      email: 'host@watchspaces.dev',
      password: 'CorrectHorse1',
      displayName: 'Impostor',
    });
    expect(duplicate.status).toBe(409);

    const weak = await request(app).post('/api/v1/auth/register').send({
      email: 'weak@example.com',
      password: 'short',
      displayName: 'Weak',
    });
    expect(weak.status).toBe(422);
  });

  test('refresh rotates the refresh token', async () => {
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@watchspaces.dev', password: 'Viewer123!' });
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginResponse.body.refreshToken });
    expect(refresh.status).toBe(200);
    expect(refresh.body.refreshToken).not.toBe(loginResponse.body.refreshToken);

    const reused = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginResponse.body.refreshToken });
    expect(reused.status).toBe(401);
  });

  test('protected routes reject anonymous callers', async () => {
    expect((await request(app).get('/api/v1/titles')).status).toBe(401);
    expect((await request(app).get('/api/v1/dashboard')).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/v1/titles')
          .set('Authorization', 'Bearer not-a-real-token')
      ).status
    ).toBe(401);
  });
});

describe('role-based access control', () => {
  test('viewers cannot create a Watch Space; hosts can', async () => {
    const denied = await request(app)
      .post('/api/v1/watch-spaces')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ titleId });
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toMatch(/host role/i);

    const created = await request(app)
      .post('/api/v1/watch-spaces')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({ titleId, name: 'RBAC room', aiVerbosity: 'chatty' });
    expect(created.status).toBe(201);
    expect(created.body.inviteCode).toMatch(/^NX-/);
    spaceId = created.body.watchSpaceId;
  });

  test('only the room host can mutate room settings', async () => {
    const denied = await request(app)
      .patch(`/api/v1/watch-spaces/${spaceId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Hijacked' });
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .patch(`/api/v1/watch-spaces/${spaceId}`)
      .set('Authorization', `Bearer ${hostToken}`)
      .send({ settings: { aiVerbosity: 'minimal' } });
    expect(allowed.status).toBe(200);
    expect(allowed.body.watchSpace.settings.aiVerbosity).toBe('minimal');
  });

  test('room analytics are host-only', async () => {
    const denied = await request(app)
      .get(`/api/v1/watch-spaces/${spaceId}/analytics`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .get(`/api/v1/watch-spaces/${spaceId}/analytics`)
      .set('Authorization', `Bearer ${hostToken}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.analytics).toHaveProperty('reconciled');
  });

  test('admin endpoints are admin-only', async () => {
    const asViewer = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(asViewer.status).toBe(403);

    const asHost = await request(app)
      .get('/api/v1/admin/titles')
      .set('Authorization', `Bearer ${hostToken}`);
    expect(asHost.status).toBe(403);

    const asAdmin = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.users.length).toBeGreaterThan(0);
  });
});

describe('timeline metadata administration', () => {
  test('rejects an invalid timeline with path-level errors', async () => {
    const response = await request(app)
      .post('/api/v1/admin/titles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Broken Metadata',
        durationSeconds: 120,
        videoAssetUrl: 'https://example.com/broken.mp4',
        timeline: [{ ts: 10, type: 'trivia' }],
      });
    expect(response.status).toBe(400);
    expect(response.body.error.details[0].path).toMatch(/timeline\[0\]/);
  });

  test('accepts and versions a valid timeline upload', async () => {
    const validation = await request(app)
      .post(`/api/v1/admin/titles/${titleId}/timeline/validate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ timeline: [{ ts: 5, type: 'trivia', text: 'A test marker.' }] });
    expect(validation.status).toBe(200);
    expect(validation.body.valid).toBe(true);

    const timeline = await request(app)
      .get(`/api/v1/titles/${titleId}/timeline?from=0&to=600`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(timeline.status).toBe(200);
    expect(timeline.body.events.length).toBeGreaterThan(0);
    expect(timeline.body.events[0]).toHaveProperty('ts');
    const variation = timeline.body.events.find((event) => event.type === 'variationPoint');
    if (variation) {
      expect(variation.options.length).toBeGreaterThanOrEqual(2);
      expect(variation.variationId).toBe(variation.id);
    }
  });
});

describe('AI co-pilot REST contract', () => {
  test('non-members cannot query the co-pilot', async () => {
    const outsiderLogin = await request(app).post('/api/v1/auth/register').send({
      email: 'outsider@example.com',
      password: 'CorrectHorse1',
      displayName: 'Outsider',
    });
    const response = await request(app)
      .post(`/api/v1/watch-spaces/${spaceId}/ai/ask`)
      .set('Authorization', `Bearer ${outsiderLogin.body.accessToken}`)
      .send({ question: 'Who is Scales?', currentTs: 60 });
    expect(response.status).toBe(403);
  });

  test('members get a grounded, cited answer', async () => {
    await request(app)
      .post(`/api/v1/watch-spaces/${spaceId}/join`)
      .set('Authorization', `Bearer ${viewerToken}`);

    const response = await request(app)
      .post(`/api/v1/watch-spaces/${spaceId}/ai/ask`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ question: 'Who is the dragon hatchling?', currentTs: 60 });

    expect(response.status).toBe(200);
    expect(response.body.grounded).toBe(true);
    expect(response.body.sourceEvents.length).toBeGreaterThan(0);
    expect(response.body.provider).toBe('grounded-synthesizer');
  });

  test('off-timeline questions are declined over REST too', async () => {
    const response = await request(app)
      .post(`/api/v1/watch-spaces/${spaceId}/ai/ask`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ question: 'Who won the 2022 World Cup?', currentTs: 60 });
    expect(response.status).toBe(200);
    expect(response.body.grounded).toBe(false);
  });
});

describe('dashboard and recommendations contract', () => {
  test('returns stats, recent titles and a rail with explanations', async () => {
    const response = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(response.status).toBe(200);
    expect(response.body.stats).toHaveProperty('titlesWatched');
    expect(Array.isArray(response.body.recommendations)).toBe(true);
    if (response.body.recommendations.length) {
      expect(response.body.recommendations[0].reasons.length).toBeGreaterThan(0);
      expect(response.body.recommendations[0].components).toHaveProperty('content');
    }
  });

  test('recording an interaction invalidates the cached rail', async () => {
    const response = await request(app)
      .post('/api/v1/interactions')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ titleId, watchedSeconds: 30, rating: 4 });
    expect(response.status).toBe(201);
    expect(response.body.interaction.completionRatio).toBeGreaterThan(0);
  });
});
