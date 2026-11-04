'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = ['viewer', 'host', 'admin'];

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    displayName: { type: String, required: true, trim: true, maxlength: 60 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'viewer', index: true },
    preferences: {
      subtitleLocale: { type: String, default: 'en', maxlength: 12 },
      genreAffinity: { type: [String], default: [] },
      reduceMotion: { type: Boolean, default: false },
    },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    email: this.email,
    displayName: this.displayName,
    role: this.role,
    preferences: {
      subtitleLocale: this.preferences?.subtitleLocale || 'en',
      genreAffinity: this.preferences?.genreAffinity || [],
    },
    createdAt: this.createdAt,
  };
};

userSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
};

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
