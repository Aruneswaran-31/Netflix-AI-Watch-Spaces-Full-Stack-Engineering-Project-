'use strict';

const mongoose = require('mongoose');
const { randomBytes } = require('crypto');

const EVENT_TYPES = ['trivia', 'character', 'glossary', 'variation_point', 'beat'];
const VARIATION_KINDS = ['subtitle', 'localization', 'narrative'];

function newEventId() {
  return `ev_${randomBytes(6).toString('hex')}`;
}

const optionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    description: { type: String, default: '' },
    // Authored, pre-approved localized line. Never generated at watch time.
    subtitle: {
      locale: { type: String, default: 'en' },
      text: { type: String, default: '' },
    },
    assetRef: { type: String, default: '' },
  },
  { _id: false }
);

const timelineEventSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, default: newEventId },
    ts: { type: Number, required: true, min: 0 },
    endTs: { type: Number, min: 0 },
    type: { type: String, enum: EVENT_TYPES, required: true },
    // Short human label used by the admin editor and trivia cards.
    title: { type: String, default: '' },
    text: { type: String, default: '' },
    scene: { type: String, default: '' },
    character: { type: String, default: '' },
    term: { type: String, default: '' },
    definition: { type: String, default: '' },
    tags: { type: [String], default: [] },
    priority: { type: String, enum: ['normal', 'high'], default: 'normal' },
    variationKind: { type: String, enum: VARIATION_KINDS },
    options: { type: [optionSchema], default: undefined },
    defaultOptionId: { type: String, default: '' },
  },
  { _id: false }
);

const titleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    year: { type: Number, min: 1900, max: 2100 },
    synopsis: { type: String, default: '' },
    durationSeconds: { type: Number, required: true, min: 1 },
    genres: { type: [String], default: [], index: true },
    videoAssetUrl: { type: String, required: true },
    // Local copy played when the upstream host is unreachable (blocked network,
    // offline demo). Kept short on purpose so it always loads.
    fallbackAssetUrl: { type: String, default: '' },
    posterUrl: { type: String, default: '' },
    accentColor: { type: String, default: '#e50914' },
    license: { type: String, default: '' },
    timeline: { type: [timelineEventSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Range scans over the embedded timeline ("events between ts=X and ts=Y").
titleSchema.index({ 'timeline.ts': 1 });

titleSchema.virtual('timelineCount').get(function count() {
  return this.timeline?.length || 0;
});

titleSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    name: this.name,
    slug: this.slug,
    year: this.year,
    synopsis: this.synopsis,
    durationSeconds: this.durationSeconds,
    genres: this.genres,
    videoAssetUrl: this.videoAssetUrl,
    fallbackAssetUrl: this.fallbackAssetUrl,
    posterUrl: this.posterUrl,
    accentColor: this.accentColor,
    license: this.license,
    timelineCount: this.timeline?.length || 0,
  };
};

module.exports = mongoose.model('Title', titleSchema);
module.exports.EVENT_TYPES = EVENT_TYPES;
module.exports.VARIATION_KINDS = VARIATION_KINDS;
module.exports.newEventId = newEventId;
