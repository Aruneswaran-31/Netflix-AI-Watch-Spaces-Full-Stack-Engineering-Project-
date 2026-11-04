'use strict';

const { ZodError } = require('zod');

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, details) {
    return new ApiError(400, 'bad_request', message, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, 'unauthorized', message);
  }

  static forbidden(message = 'Insufficient permissions') {
    return new ApiError(403, 'forbidden', message);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, 'not_found', message);
  }

  static conflict(message, details) {
    return new ApiError(409, 'conflict', message, details);
  }

  static tooMany(message = 'Too many requests') {
    return new ApiError(429, 'rate_limited', message);
  }
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'not_found', message: `No route for ${req.method} ${req.originalUrl}` },
  });
}

function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: {
        code: 'validation_failed',
        message: 'Request payload failed validation',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
      },
    });
  }

  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  if (err.name === 'CastError') {
    return res.status(404).json({
      error: { code: 'not_found', message: 'Resource not found' },
    });
  }

  if (err.code === 11000) {
    return res.status(409).json({
      error: { code: 'conflict', message: 'That record already exists', details: err.keyValue },
    });
  }

  req.log?.error('unhandled_error', { message: err.message, stack: err.stack });
  return res.status(500).json({
    error: { code: 'internal_error', message: 'Unexpected server error' },
  });
}

module.exports = { ApiError, asyncHandler, errorHandler, notFoundHandler };
