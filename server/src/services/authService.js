'use strict';

const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const config = require('../config/env');
const { ApiError } = require('../lib/errors');
const {
  signAccessToken,
  createRefreshToken,
  hashToken,
  verifyAccessToken,
} = require('../lib/tokens');

const PUBLIC_REGISTER_ROLES = ['viewer', 'host'];

async function issueTokens(user, { userAgent = '' } = {}) {
  const accessToken = signAccessToken(user);
  const refreshToken = createRefreshToken();
  const expiresAt = new Date(Date.now() + config.jwt.refreshDays * 24 * 60 * 60 * 1000);
  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt,
    userAgent,
  });
  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: config.jwt.accessTtl,
    refreshExpiresAt: expiresAt,
    user: user.toPublic(),
  };
}

async function register({ email, password, displayName, accountType = 'viewer' }, context = {}) {
  const normalizedEmail = String(email).toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) throw ApiError.conflict('An account with that email already exists');

  const role = PUBLIC_REGISTER_ROLES.includes(accountType) ? accountType : 'viewer';
  const user = await User.create({
    email: normalizedEmail,
    displayName: displayName?.trim() || normalizedEmail.split('@')[0],
    passwordHash: await User.hashPassword(password),
    role,
  });
  return issueTokens(user, context);
}

async function login({ email, password }, context = {}) {
  const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select(
    '+passwordHash'
  );
  if (!user) throw ApiError.unauthorized('Email or password is incorrect');
  const valid = await user.verifyPassword(password);
  if (!valid) throw ApiError.unauthorized('Email or password is incorrect');
  user.lastSeenAt = new Date();
  await user.save();
  return issueTokens(user, context);
}

async function rotateRefreshToken({ refreshToken }, context = {}) {
  if (!refreshToken) throw ApiError.unauthorized('Refresh token required');
  const tokenHash = hashToken(refreshToken);
  const stored = await RefreshToken.findOne({ tokenHash });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw ApiError.unauthorized('Refresh token is invalid or expired');
  }
  const user = await User.findById(stored.userId);
  if (!user) throw ApiError.unauthorized('Account no longer exists');

  // Rotation: the used token is revoked and linked to its replacement.
  const nextToken = createRefreshToken();
  stored.revokedAt = new Date();
  stored.replacedBy = hashToken(nextToken);
  await stored.save();

  const accessToken = signAccessToken(user);
  const expiresAt = new Date(Date.now() + config.jwt.refreshDays * 24 * 60 * 60 * 1000);
  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(nextToken),
    expiresAt,
    userAgent: context.userAgent || stored.userAgent,
  });

  return {
    accessToken,
    refreshToken: nextToken,
    tokenType: 'Bearer',
    expiresIn: config.jwt.accessTtl,
    user: user.toPublic(),
  };
}

async function logout({ refreshToken }) {
  if (!refreshToken) return;
  await RefreshToken.updateOne(
    { tokenHash: hashToken(refreshToken) },
    { $set: { revokedAt: new Date() } }
  );
}

async function userFromAccessToken(token) {
  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  return user;
}

module.exports = {
  register,
  login,
  rotateRefreshToken,
  logout,
  userFromAccessToken,
  issueTokens,
};
