'use strict';

const express = require('express');
const { z } = require('zod');
const authService = require('../services/authService');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/errors');
const { cleanText } = require('../lib/sanitize');

const router = express.Router();

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

const registerSchema = z.object({
  email: z.string().email('Enter a valid email address').max(254),
  password: passwordSchema,
  displayName: z.string().min(2, 'Display name must be at least 2 characters').max(60),
  accountType: z.enum(['viewer', 'host']).optional().default('viewer'),
});

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const tokens = await authService.register(
      { ...body, displayName: cleanText(body.displayName, { maxLength: 60 }) },
      { userAgent: req.headers['user-agent'] || '' }
    );
    res.status(201).json(tokens);
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(1).max(128) })
      .parse(req.body);
    const tokens = await authService.login(body, {
      userAgent: req.headers['user-agent'] || '',
    });
    res.json(tokens);
  })
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const body = z.object({ refreshToken: z.string().min(10) }).parse(req.body);
    const tokens = await authService.rotateRefreshToken(body, {
      userAgent: req.headers['user-agent'] || '',
    });
    res.json(tokens);
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await authService.logout({ refreshToken: req.body?.refreshToken });
    res.status(204).end();
  })
);

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toPublic() });
});

router.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        displayName: z.string().min(2).max(60).optional(),
        preferences: z
          .object({
            subtitleLocale: z.string().min(2).max(12).optional(),
            genreAffinity: z.array(z.string().min(1).max(40)).max(10).optional(),
          })
          .optional(),
      })
      .parse(req.body);

    if (body.displayName) req.user.displayName = cleanText(body.displayName, { maxLength: 60 });
    if (body.preferences) {
      req.user.preferences = {
        subtitleLocale:
          body.preferences.subtitleLocale || req.user.preferences?.subtitleLocale || 'en',
        genreAffinity:
          body.preferences.genreAffinity || req.user.preferences?.genreAffinity || [],
      };
    }
    await req.user.save();
    res.json({ user: req.user.toPublic() });
  })
);

router.get(
  '/users/lookup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const email = cleanText(String(req.query.email || ''), { maxLength: 254 }).toLowerCase();
    if (!email) throw ApiError.badRequest('email query parameter is required');
    const User = require('../models/User');
    const user = await User.findOne({ email }).select('displayName email role');
    if (!user) throw ApiError.notFound('No account with that email');
    res.json({ user: { id: String(user._id), displayName: user.displayName, role: user.role } });
  })
);

module.exports = router;
