'use strict';

const request = require('supertest');
const { connectDb, clearDb, disconnectDb } = require('./helpers/db');
const {
  startTestServer,
  stopTestServer,
  connectSocket,
  emitAck,
  waitForEvent,
} = require('./helpers/http');
const { seedDatabase } = require('../src/seed');
const Title = require('../src/models/Title');
const WatchSpace = require('../src/models/WatchSpace');
const ChatMessage = require('../src/models/ChatMessage');

let harness;
let hostSocket;
let viewerSocket;
let spaceId;
let viewerId;
let hostToken;
let viewerToken;

beforeAll(async () => {
  await connectDb();
  await clearDb();
  await seedDatabase();
  harness = await startTestServer();

  const hostLogin = await request(harness.app)
    .post('/api/v1/auth/login')
    .send({ email: 'host@watchspaces.dev', password: 'Host123!' });
  hostToken = hostLogin.body.accessToken;

  const viewerLogin = await request(harness.app)
    .post('/api/v1/auth/login')
    .send({ email: 'viewer@watchspaces.dev', password: 'Viewer123!' });
  viewerToken = viewerLogin.body.accessToken;
  viewerId = viewerLogin.body.user.id;

  const title = await Title.findOne({ slug: 'sintel' });
  const created = await request(harness.app)
    .post('/api/v1/watch-spaces')
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ titleId: String(title._id), name: 'Realtime suite', aiVerbosity: 'chatty' });
  expect(created.status).toBe(201);
  spaceId = created.body.watchSpaceId;

  hostSocket = await connectSocket(harness.url, hostToken);
  viewerSocket = await connectSocket(harness.url, viewerToken);

  const hostJoin = await emitAck(hostSocket, 'room.join', { watchSpaceId: spaceId });
  expect(hostJoin.ok).toBe(true);
  expect(hostJoin.isHost).toBe(true);

  const viewerJoin = await emitAck(viewerSocket, 'room.join', { watchSpaceId: spaceId });
  expect(viewerJoin.ok).toBe(true);
  expect(viewerJoin.isHost).toBe(false);
  expect(viewerJoin.presence.participantCount).toBe(2);
});

afterAll(async () => {
  hostSocket?.close();
  viewerSocket?.close();
  if (harness) await stopTestServer(harness);
  await disconnectDb();
});

test('participants cannot drive playback; the host can', async () => {
  const denied = await emitAck(viewerSocket, 'room.playback.update', {
    watchSpaceId: spaceId,
    action: 'play',
  });
  expect(denied.ok).toBe(false);
  expect(denied.error.code).toBe('not_host');

  const playing = waitForEvent(viewerSocket, 'room.playback.update', {
    predicate: (message) => message.payload.action === 'play',
  });
  const ack = await emitAck(hostSocket, 'room.playback.update', {
    watchSpaceId: spaceId,
    action: 'play',
    positionSeconds: 0,
  });
  expect(ack.ok).toBe(true);

  const broadcast = await playing;
  expect(broadcast.payload.status).toBe('playing');
  expect(broadcast.payload.positionSeconds).toBeGreaterThanOrEqual(0);
  expect(broadcast.watchSpaceId).toBe(spaceId);
});

test('a participant far out of sync is told to seek, not drift slowly', async () => {
  const response = await emitAck(viewerSocket, 'room.sync.ping', {
    watchSpaceId: spaceId,
    clientSentAt: Date.now(),
    positionSeconds: -5,
  });
  expect(response.ok).toBe(true);
  expect(response.driftMs).toBeGreaterThan(1200);
  expect(response.correction.mode).toBe('hard');
  expect(response.correction.apply).toBe(true);
  expect(response.authoritativePositionSeconds).toBeGreaterThanOrEqual(0);
});

test('chat is broadcast to the room and persisted', async () => {
  const received = waitForEvent(hostSocket, 'room.chat.message', {
    predicate: (message) => message.payload.body === 'the snow looks incredible',
  });
  const ack = await emitAck(viewerSocket, 'room.chat.message', {
    watchSpaceId: spaceId,
    body: 'the snow looks incredible',
  });
  expect(ack.ok).toBe(true);

  const broadcast = await received;
  expect(broadcast.payload.displayName).toBeTruthy();
  expect(broadcast.payload.tsSeconds).toBeGreaterThanOrEqual(0);

  const persisted = await ChatMessage.countDocuments({ watchSpaceId: spaceId, type: 'chat' });
  expect(persisted).toBeGreaterThanOrEqual(1);

  const history = await request(harness.app)
    .get(`/api/v1/watch-spaces/${spaceId}/chat`)
    .set('Authorization', `Bearer ${viewerToken}`);
  expect(history.status).toBe(200);
  expect(history.body.messages.some((message) => message.body === 'the snow looks incredible')).toBe(
    true
  );
});

test('seeking near an authored marker surfaces contextual trivia within one tick window', async () => {
  await emitAck(hostSocket, 'room.playback.update', {
    watchSpaceId: spaceId,
    action: 'seek',
    positionSeconds: 40,
  });
  await emitAck(hostSocket, 'room.playback.update', {
    watchSpaceId: spaceId,
    action: 'play',
    positionSeconds: 40,
  });

  const trivia = await waitForEvent(viewerSocket, 'room.ai.trivia', { timeoutMs: 8000 });
  expect(trivia.payload.eventId).toBeTruthy();
  expect(trivia.payload.text.length).toBeGreaterThan(10);
  expect(trivia.payload.tsSeconds).toBeLessThanOrEqual(50);
});

test('a viewer gets a grounded co-pilot answer over the socket', async () => {
  const answered = waitForEvent(viewerSocket, 'room.ai.answer', { timeoutMs: 8000 });
  const ack = await emitAck(viewerSocket, 'room.ai.ask', {
    watchSpaceId: spaceId,
    question: 'Who is Scales?',
    currentTs: 108,
  });
  expect(ack.ok).toBe(true);
  expect(ack.result.grounded).toBe(true);
  expect(ack.result.sourceEvents.length).toBeGreaterThan(0);

  const broadcast = await answered;
  expect(broadcast.payload.questionId).toBe(ack.result.questionId);
  expect(broadcast.payload.answer.toLowerCase()).toContain('scales');
});

test('only the host can open a variation vote; ballots aggregate and apply', async () => {
  const variations = await request(harness.app)
    .get(`/api/v1/watch-spaces/${spaceId}/variations`)
    .set('Authorization', `Bearer ${viewerToken}`);
  expect(variations.status).toBe(200);
  const variation = variations.body.variations[0];
  expect(variation.options.length).toBeGreaterThanOrEqual(2);

  const denied = await emitAck(viewerSocket, 'room.variation.open', {
    watchSpaceId: spaceId,
    variationId: variation.id,
  });
  expect(denied.ok).toBe(false);
  expect(denied.error.code).toBe('forbidden');

  const opened = await emitAck(hostSocket, 'room.variation.open', {
    watchSpaceId: spaceId,
    variationId: variation.id,
    durationSeconds: 30,
  });
  expect(opened.ok).toBe(true);
  expect(opened.vote.status).toBe('open');
  expect(opened.vote.options.length).toBeGreaterThanOrEqual(2);

  const choice = variation.options[1].id;
  const ballot = await emitAck(viewerSocket, 'room.variation.vote', {
    watchSpaceId: spaceId,
    voteId: opened.vote.id,
    optionId: choice,
  });
  expect(ballot.ok).toBe(true);
  expect(ballot.vote.totalBallots).toBe(1);

  const appliedEvent = waitForEvent(viewerSocket, 'room.variation.applied');
  const closed = await emitAck(hostSocket, 'room.variation.close', {
    watchSpaceId: spaceId,
    voteId: opened.vote.id,
  });
  expect(closed.ok).toBe(true);
  expect(closed.vote.status).toBe('closed');
  expect(closed.vote.winningOptionId).toBe(choice);

  const applied = await appliedEvent;
  expect(applied.payload.winningOptionId).toBe(choice);
  expect(applied.payload.variationKind).toBeTruthy();
});

test('when the host drops, playback pauses and the longest-present participant is promoted', async () => {
  const disconnected = waitForEvent(viewerSocket, 'room.host.disconnected', { timeoutMs: 5000 });
  hostSocket.close();
  const drop = await disconnected;
  expect(drop.payload.paused).toBe(true);
  expect(drop.payload.policy).toMatch(/promote/);

  const promoted = await waitForEvent(viewerSocket, 'room.host.changed', { timeoutMs: 5000 });
  expect(promoted.payload.hostUserId).toBe(viewerId);
  expect(promoted.payload.reason).toBe('host_inactivity');

  const space = await WatchSpace.findById(spaceId);
  expect(String(space.hostUserId)).toBe(viewerId);

  const denied = await emitAck(viewerSocket, 'room.playback.update', {
    watchSpaceId: spaceId,
    action: 'play',
  });
  expect(denied.ok).toBe(true);
});
