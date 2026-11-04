'use strict';

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/setup-env.js'],
  testTimeout: 30000,
  verbose: true,
  collectCoverageFrom: ['src/**/*.js', '!src/seed/**'],
  coverageDirectory: '<rootDir>/coverage',
};
