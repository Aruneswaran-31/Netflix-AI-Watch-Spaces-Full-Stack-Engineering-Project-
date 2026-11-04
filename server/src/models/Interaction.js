'use strict';

const mongoose = require('mongoose');

const interactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    titleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Title', required: true, index: true },
    watchSpaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'WatchSpace' },
    watchedSeconds: { type: Number, default: 0, min: 0 },
    completionRatio: { type: Number, default: 0, min: 0, max: 1 },
    completed: { type: Boolean, default: false },
    rating: { type: Number, min: 1, max: 5 },
    coWatchedWith: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
    source: { type: String, enum: ['room', 'manual', 'seed'], default: 'manual' },
  },
  { timestamps: true }
);

interactionSchema.index({ userId: 1, titleId: 1, createdAt: -1 });

module.exports = mongoose.model('Interaction', interactionSchema);
