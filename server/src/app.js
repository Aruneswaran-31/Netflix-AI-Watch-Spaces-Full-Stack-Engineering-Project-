'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const config = require('./config/env');
const { createLogger } = require('./lib/logger');
const { errorHandler, notFoundHandler } = require('./lib/errors');
const { randomUUID } = require('crypto');

const log = createLogger('api');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The SPA loads open-licensed sample video from third-party hosts.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (config.corsOrigins.includes(origin) || config.env !== 'production') {
          return callback(null, true);
        }
        return callback(new Error('Origin not allowed by CORS'));
      },
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    })
  );
  app.use(compression());
  app.use(express.json({ limit: '512kb' }));

  app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || randomUUID();
    res.setHeader('X-Request-Id', req.id);
    req.log = log.child(req.id.slice(0, 8));
    const started = Date.now();
    res.on('finish', () => {
      req.log.info('http_request', {
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: Date.now() - started,
        userId: req.user ? String(req.user._id) : undefined,
        correlationId: req.headers['x-session-correlation'] || undefined,
      });
    });
    next();
  });

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config.isTest,
  });
  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config.isTest,
    message: { error: { code: 'rate_limited', message: 'Too many auth attempts, try again later' } },
  });

  app.use('/api', apiLimiter);
  app.use('/api/v1/auth/login', authLimiter);
  app.use('/api/v1/auth/register', authLimiter);
  app.use('/api/v1/auth/refresh', authLimiter);

  app.use('/api/v1', require('./routes/health.routes'));
  app.use('/api/v1/auth', require('./routes/auth.routes'));
  app.use('/api/v1/titles', require('./routes/titles.routes'));
  app.use('/api/v1/watch-spaces', require('./routes/watchSpaces.routes'));
  app.use('/api/v1', require('./routes/engagement.routes'));
  app.use('/api/v1/admin', require('./routes/admin.routes'));

  app.get('/api/v1/meta/ai', (_req, res) => {
    res.json({
      provider: config.ai.enabled ? config.ai.provider : 'grounded-synthesizer',
      model: config.ai.enabled ? config.ai.model : null,
      fallbackEnabled: true,
      grounding: 'retrieval over authored title timeline; every answer cites source event ids',
    });
  });

  // Optionally serve the built SPA from the API process (single-container deploy).
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist, { maxAge: '1h', index: false }));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use('/api', notFoundHandler);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
