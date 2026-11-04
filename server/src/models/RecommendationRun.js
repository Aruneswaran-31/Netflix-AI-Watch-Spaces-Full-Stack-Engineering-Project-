'use strict';

const mongoose = require('mongoose');

const recommendationRunSchema = new mongoose.Schema(
  {
    method: { type: String, default: 'hybrid-content-cf' },
    itemCount: { type: Number, default: 0 },
    interactionCount: { type: Number, default: 0 },
    userCount: { type: Number, default: 0 },
    precisionAt5: { type: Number, default: 0 },
    recallAt5: { type: Number, default: 0 },
    evaluatedUsers: { type: Number, default: 0 },
    details: { type: mongoose.Schema.Types.Mixed },
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RecommendationRun', recommendationRunSchema);
