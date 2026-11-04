'use strict';

const { createHash, randomBytes } = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config/env');

function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, email: user.email, type: 'access' },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessTtl, issuer: 'watchspaces' }
  );
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, config.jwt.accessSecret, { issuer: 'watchspaces' });
  if (payload.type !== 'access') throw new Error('Invalid token type');
  return payload;
}

function createRefreshToken() {
  return randomBytes(48).toString('hex');
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

module.exports = { signAccessToken, verifyAccessToken, createRefreshToken, hashToken };
