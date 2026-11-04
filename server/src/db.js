'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const config = require('./config/env');
const { createLogger } = require('./lib/logger');

const log = createLogger('db');
let memoryServer = null;

async function startMemoryMongo() {
  // Lazily required so production installs never need the dev dependency.
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const dbPath = config.isTest
    ? fs.mkdtempSync(path.join(require('os').tmpdir(), 'watchspaces-test-'))
    : path.resolve(__dirname, '../.mongo');
  fs.mkdirSync(dbPath, { recursive: true });

  memoryServer = await MongoMemoryServer.create({
    instance: {
      dbPath,
      storageEngine: 'wiredTiger',
      ...(config.isTest ? {} : { port: config.memoryMongoPort }),
    },
    binary: { version: process.env.MONGOMS_VERSION || '7.0.24' },
  });
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
