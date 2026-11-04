'use strict';

const express = require('express');
const mongoose = require('mongoose');
const roomRuntime = require('../services/roomRuntime');

const router = express.Router();

router.get('/healthz', (_req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

router.get('/readyz', (_req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  const payload = {
    status: dbReady ? 'ready' : 'not_ready',
    checks: {
      database: dbReady ? 'up' : 'down',
      realtimeGateway: roomRuntime ? 'up' : 'down',
      activeRooms: roomRuntime._rooms.size,
    },
    timestamp: new Date().toISOString(),
  };
  res.status(dbReady ? 200 : 503).json(payload);
});

module.exports = router;
