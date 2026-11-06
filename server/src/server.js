'use strict';

const http = require('http');
const net = require('net');
const config = require('./config/env');
const { createLogger } = require('./lib/logger');
const { connectDatabase, disconnectDatabase } = require('./db');
const { createApp } = require('./app');
const { createSocketServer } = require('./sockets');
const { seedDatabase } = require('./seed');

const log = createLogger('server');

/**
 * Check the port before doing any work: starting the database first turns an
 * occupied port into a confusing half-boot, and the SPA's proxy then silently
 * talks to whichever process already owns the port.
 */
function assertPortAvailable(port) {
  if (!port) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE') error.port = port;
      reject(error);
    });
    probe.listen(port, () => probe.close(() => resolve()));
  });
}

async function start({ port = config.port } = {}) {
  await assertPortAvailable(port);
  await connectDatabase();
  if (config.seedDemoData) {
    const seeded = await seedDatabase();
    if (seeded) log.info('demo_data_seeded', {});
  }

  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server);
  app.set('io', io);

  await new Promise((resolve, reject) => {
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') error.port = port;
      reject(error);
    });
    server.listen(port, () => resolve());
  });

  const actualPort = server.address().port;
  log.info('server_started', {
    port: actualPort,
    env: config.env,
    cors: config.corsOrigins,
    aiProvider: config.ai.enabled ? config.ai.provider : 'grounded-synthesizer',
  });
  return { app, server, io, port: actualPort };
}

async function stop({ server, io } = {}) {
  if (io) await new Promise((resolve) => io.close(resolve));
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
}

if (require.main === module) {
  start()
    .then(({ server, io }) => {
      const shutdown = async (signal) => {
        log.info('shutdown', { signal });
        await stop({ server, io });
        process.exit(0);
      };
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    })
    .catch((error) => {
      if (error.code === 'EADDRINUSE') {
        // A silent mismatch here is the difference between a working app and one
        // where every request — including video — hits an unrelated server.
        log.error('port_in_use', {
          port: error.port,
          fix: `Port ${error.port} is used by another process. Set PORT in .env (for example PORT=4100) and start again — the client proxy reads the same value.`,
        });
        process.exit(1);
      }
      log.error('startup_failed', { message: error.message, stack: error.stack });
      process.exit(1);
    });
}

module.exports = { start, stop };
