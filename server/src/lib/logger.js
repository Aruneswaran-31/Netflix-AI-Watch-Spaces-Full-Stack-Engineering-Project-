'use strict';

const config = require('../config/env');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function emit(level, scope, event, fields) {
  if (LEVELS[level] > LEVELS[config.logLevel]) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope,
    event,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

function createLogger(scope) {
  return {
    info: (event, fields = {}) => emit('info', scope, event, fields),
    warn: (event, fields = {}) => emit('warn', scope, event, fields),
    error: (event, fields = {}) => emit('error', scope, event, fields),
    debug: (event, fields = {}) => emit('debug', scope, event, fields),
    child: (childScope) => createLogger(`${scope}:${childScope}`),
  };
}

module.exports = { createLogger };
