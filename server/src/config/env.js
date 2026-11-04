'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Root .env first, then server/.env (dotenv never overrides existing values).
for (const candidate of [
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env'),
]) {
  if (fs.existsSync(candidate)) dotenv.config({ path: candidate });
}

function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const env = process.env.NODE_ENV || 'development';
const isProduction = env === 'production';
const isTest = env === 'test';

const aiProvider = process.env.OPENAI_API_KEY
  ? {
      key: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      provider: 'openai',
    }
  : {
      key: process.env.ZAI_API_KEY || '',
      baseUrl: process.env.ZAI_API_BASE || 'https://api.z.ai/api/paas/v4',
      model: process.env.ZAI_MODEL || '',
      provider: 'zai',
    };

const config = {
  env,
  isProduction,
  isTest,
  port: int(process.env.PORT, 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  mongoUri: process.env.MONGODB_URI || '',
  mongoDb: process.env.MONGODB_DB || 'watchspaces',
  memoryMongoPort: int(process.env.MEMORY_MONGO_PORT, 27077),
  jwt: {
    accessSecret:
      process.env.JWT_ACCESS_SECRET ||
      'insecure-development-access-secret-change-me-please',
    refreshSecret:
      process.env.JWT_REFRESH_SECRET ||
      'insecure-development-refresh-secret-change-me-please',
    accessTtl: process.env.ACCESS_TOKEN_TTL || '45m',
    refreshDays: int(process.env.REFRESH_TOKEN_TTL_DAYS, 7),
  },
  seed: {
    adminEmail: (process.env.ADMIN_EMAIL || 'admin@watchspaces.dev').toLowerCase(),
    adminPassword: process.env.ADMIN_PASSWORD || 'Admin123!',
    hostEmail: (process.env.HOST_EMAIL || 'host@watchspaces.dev').toLowerCase(),
    hostPassword: process.env.HOST_PASSWORD || 'Host123!',
    viewerEmail: (process.env.VIEWER_EMAIL || 'viewer@watchspaces.dev').toLowerCase(),
    viewerPassword: process.env.VIEWER_PASSWORD || 'Viewer123!',
  },
  ai: {
    ...aiProvider,
    enabled: Boolean(aiProvider.key && aiProvider.model),
    timeoutMs: int(process.env.AI_TIMEOUT_MS, 8000),
    // Retrieval window around the playhead, in seconds.
    lookbackSeconds: int(process.env.AI_LOOKBACK_SECONDS, 360),
    lookaheadSeconds: int(process.env.AI_LOOKAHEAD_SECONDS, 30),
    maxSources: int(process.env.AI_MAX_SOURCES, 6),
    minScore: Number(process.env.AI_MIN_SCORE || 1.15),
    minCoverage: Number(process.env.AI_MIN_COVERAGE || 0.5),
  },
  room: {
    hostGraceMs: int(process.env.HOST_DISCONNECT_GRACE_MS, 15000),
    maxParticipantsCeiling: int(process.env.MAX_PARTICIPANTS_CEILING, 50),
    driftSoftMs: int(process.env.DRIFT_SOFT_MS, 250),
    driftHardMs: int(process.env.DRIFT_HARD_MS, 1200),
    triviaTickMs: int(process.env.TRIVIA_TICK_MS, 1000),
    seatReleaseMs: int(process.env.SEAT_RELEASE_MS, 30000),
  },
  corsOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  logLevel: process.env.LOG_LEVEL || (isTest ? 'error' : 'info'),
  seedDemoData: bool(process.env.SEED_DEMO_DATA, true),
};

if (isProduction) {
  for (const [name, value] of [
    ['JWT_ACCESS_SECRET', config.jwt.accessSecret],
    ['JWT_REFRESH_SECRET', config.jwt.refreshSecret],
  ]) {
    if (/insecure-development/.test(value) || value.length < 32) {
      throw new Error(`${name} must be a unique 32+ character secret in production`);
    }
  }
}

module.exports = config;
