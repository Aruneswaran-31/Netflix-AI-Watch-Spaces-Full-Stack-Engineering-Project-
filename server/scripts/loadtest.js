'use strict';

/**
 * Small, dependency-free HTTP load test for the read-heavy dashboard path.
 *
 * It exercises the real Express app (routing, JWT auth, Mongo queries, the
 * cached recommendation rail) without starting an external port. Numbers are
 * therefore app+DB latency, not internet latency.
 *
 * Usage: npm run loadtest -- [totalRequests] [concurrency]
 */

const request = require('supertest');
const { connectDatabase, disconnectDatabase } = require('../src/db');
const { seedDatabase } = require('../src/seed');
const { createApp } = require('../src/app');

const TOTAL = Math.max(10, Number(process.argv[2]) || 120);
const CONCURRENCY = Math.max(1, Number(process.argv[3]) || 12);

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function main() {
  await connectDatabase();
  await seedDatabase();
  const app = createApp();

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'host@watchspaces.dev', password: 'Host123!' });
  if (login.status !== 200) throw new Error(`login failed (${login.status})`);
  const token = login.body.accessToken;

  // Warm caches so the reported numbers are steady-state, not a cold start.
  for (let i = 0; i < 5; i += 1) {
    await request(app).get('/api/v1/dashboard').set('Authorization', `Bearer ${token}`);
  }

  const durations = [];
  const statuses = {};
  let cursor = 0;
  const started = Date.now();

  async function worker() {
    while (cursor < TOTAL) {
      cursor += 1;
      const requestStarted = process.hrtime.bigint();
      const response = await request(app)
        .get('/api/v1/dashboard')
        .set('Authorization', `Bearer ${token}`);
      const elapsed = Number(process.hrtime.bigint() - requestStarted) / 1e6;
      durations.push(elapsed);
      statuses[response.status] = (statuses[response.status] || 0) + 1;
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const wallMs = Date.now() - started;
  durations.sort((a, b) => a - b);

  const report = {
    endpoint: 'GET /api/v1/dashboard',
    requests: TOTAL,
    concurrency: CONCURRENCY,
    wallMs,
    requestsPerSecond: Number(((TOTAL / wallMs) * 1000).toFixed(1)),
    statuses,
    latencyMs: {
      min: Number(durations[0].toFixed(1)),
      p50: Number(percentile(durations, 50).toFixed(1)),
      p95: Number(percentile(durations, 95).toFixed(1)),
      p99: Number(percentile(durations, 99).toFixed(1)),
      max: Number(durations[durations.length - 1].toFixed(1)),
    },
  };

  console.log(JSON.stringify(report, null, 2));
  await disconnectDatabase();
  return report;
}

main().catch(async (error) => {
  console.error('load test failed:', error.message);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
