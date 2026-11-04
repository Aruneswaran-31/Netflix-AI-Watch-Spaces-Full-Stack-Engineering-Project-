'use strict';

const http = require('http');
const config = require('./config/env');
const { createLogger } = require('./lib/logger');
const { connectDatabase, disconnectDatabase } = require('./db');
const { createApp } = require('./app');
const { createSocketServer } = require('./sockets');
const { seedDatabase } = require('./seed');

const log = createLogger('server');

async function start({ port = config.port } = {}) {
  await connectDatabase();
  if (config.seedDemoData) {
    const seeded = await seedDatabase({ onlyIfEmpty: true });
    if (seeded) log.info('demo_data_seeded', {});
  }

  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server);
  app.set('io', io);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
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
      log.error('startup_failed', { message: error.message, stack: error.stack });
      process.exit(1);
    });
}

module.exports = { start, stop };
