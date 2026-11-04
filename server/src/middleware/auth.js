'use strict';

const authService = require('../services/authService');
const { ApiError, asyncHandler } = require('../lib/errors');

function extractBearer(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = extractBearer(req);
  if (!token) throw ApiError.unauthorized('Missing bearer token');
  try {
    req.user = await authService.userFromAccessToken(token);
  } catch (error) {
    throw ApiError.unauthorized('Invalid or expired access token');
  }
  next();
});

const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = extractBearer(req);
  if (!token) return next();
  try {
    req.user = await authService.userFromAccessToken(token);
  } catch (error) {
    req.user = null;
  }
  return next();
});

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(
        ApiError.forbidden(
          `Requires role: ${roles.join(' or ')}. Your role is "${req.user.role}".`
        )
      );
    }
    return next();
  };
}

function isAdmin(user) {
  return user?.role === 'admin';
}

/** Host of the specific room, or an admin. Room-scoped, server-enforced. */
function assertRoomHost(space, user) {
  if (isAdmin(user)) return;
  if (String(space.hostUserId) !== String(user?._id)) {
    throw ApiError.forbidden('Only the host of this Watch Space can do that');
  }
}

module.exports = { requireAuth, optionalAuth, requireRole, assertRoomHost, isAdmin, extractBearer };
