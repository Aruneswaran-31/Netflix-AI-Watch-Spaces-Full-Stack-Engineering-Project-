'use strict';

/**
 * The sample clips are committed under server/public/media and served from the
 * API origin. These checks exist because the demo previously streamed every
 * title from a third-party host: playback died outright on networks that block
 * it, and nothing caught that.
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startTestServer, stopTestServer } = require('./helpers/http');
const { connectDb, disconnectDb } = require('./helpers/db');
const { TITLES } = require('../src/seed/titles');

let server;

jest.setTimeout(30000);

beforeAll(async () => {
  await connectDb();
  server = await startTestServer();
});

afterAll(async () => {
  await stopTestServer(server);
  await disconnectDb();
});

describe('bundled sample media', () => {
  it('serves a committed clip with a video content type', async () => {
    const response = await request(server.app).get('/api/v1/media/sintel-10s.mp4');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/video\/mp4/);
    expect(Number(response.headers['content-length'])).toBeGreaterThan(100000);
  });

  it('honours range requests so the browser can seek', async () => {
    const response = await request(server.app)
      .get('/api/v1/media/sintel-10s.mp4')
      .set('Range', 'bytes=0-1023');
    expect(response.status).toBe(206);
    expect(response.headers['content-range']).toMatch(/^bytes 0-1023\//);
  });

  it('returns 404 for an unknown asset', async () => {
    const response = await request(server.app).get('/api/v1/media/does-not-exist.mp4');
    expect(response.status).toBe(404);
  });

  it('every local media reference in the seed points at a committed file', () => {
    const mediaDir = path.resolve(__dirname, '../public/media');
    const referenced = TITLES.flatMap((title) =>
      [title.videoAssetUrl, title.fallbackAssetUrl].filter((url) => url && url.startsWith('/api/v1/media/'))
    );
    expect(referenced.length).toBeGreaterThan(0);
    for (const url of referenced) {
      const file = path.join(mediaDir, url.replace('/api/v1/media/', ''));
      expect(fs.existsSync(file)).toBe(true);
    }
  });

  it('every full film carries a local fallback', () => {
    const films = TITLES.filter((title) => title.videoAssetUrl.startsWith('http'));
    expect(films.length).toBeGreaterThan(0);
    for (const film of films) {
      expect(film.fallbackAssetUrl).toMatch(/^\/api\/v1\/media\//);
    }
  });
});
