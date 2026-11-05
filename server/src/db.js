'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const mongoose = require('mongoose');
const config = require('./config/env');
const { createLogger } = require('./lib/logger');

const log = createLogger('db');
let memoryServer = null;

/**
 * A second `npm run dev` on the same checkout would otherwise die inside
 * mongod with an opaque "DBPathInUse" lock error. If the embedded instance from
 * the first process is still listening, reuse it instead of starting a rival.
 */
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function startMemoryMongo() {
  if (!config.isTest && (await portOpen(config.memoryMongoPort))) {
    log.warn('embedded_mongo_reused', {
      port: config.memoryMongoPort,
      note: 'Reusing the embedded MongoDB already running for this checkout. Set MONGODB_URI to point at a managed instance.',
    });
    return `mongodb://127.0.0.1:${config.memoryMongoPort}/${config.mongoDb}`;
  }

  // Lazily required so production installs never need the dev dependency.
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const dbPath = config.isTest
    ? fs.mkdtempSync(path.join(require('os').tmpdir(), 'watchspaces-test-'))
    : path.resolve(__dirname, '../.mongo');
  fs.mkdirSync(dbPath, { recursive: true });

  try {
    memoryServer = await MongoMemoryServer.create({
      instance: {
        dbPath,
        storageEngine: 'wiredTiger',
        ...(config.isTest ? {} : { port: config.memoryMongoPort }),
      },
      binary: { version: process.env.MONGOMS_VERSION || '7.0.24' },
    });
  } catch (error) {
    if (/DBPathInUse|lock file/i.test(error.message)) {
      throw new Error(
        `Another embedded MongoDB already holds ${dbPath}. Stop that process (or set MONGODB_URI to a managed database) and start again.`
      );
    }
    throw error;
  }
  log.warn('embedded_mongo_started', {
    uri: memoryServer.getUri(),
    dbPath,
    note: 'Set MONGODB_URI to use a managed MongoDB instance instead.',
  });
  return memoryServer.getUri(config.mongoDb);
}

async function connectDatabase(uri) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  const target = uri || config.mongoUri || (await startMemoryMongo());
  mongoose.set('strictQuery', true);
  await mongoose.connect(target, {
    dbName: config.mongoDb,
    serverSelectionTimeoutMS: 10000,
  });
  log.info('mongo_connected', {
    database: mongoose.connection.name,
    embedded: !config.mongoUri,
  });
  return mongoose.connection;
}

async function disconnectDatabase() {
  await mongoose.connection.close();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

module.exports = { connectDatabase, disconnectDatabase };
