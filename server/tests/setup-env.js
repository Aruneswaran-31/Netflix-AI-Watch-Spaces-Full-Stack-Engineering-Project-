'use strict';

// Runs before any module (and therefore src/config/env.js) is imported.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.SEED_DEMO_DATA = 'false';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-long-enough-0001';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-0002';
process.env.HOST_DISCONNECT_GRACE_MS = '400';
process.env.TRIVIA_TICK_MS = '200';
process.env.DRIFT_SOFT_MS = '250';
process.env.DRIFT_HARD_MS = '1200';
// The deterministic grounded synthesizer is the behaviour under test.
delete process.env.OPENAI_API_KEY;
delete process.env.ZAI_API_KEY;
