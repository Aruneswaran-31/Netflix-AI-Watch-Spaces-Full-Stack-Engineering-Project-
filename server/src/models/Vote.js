'use strict';

const mongoose = require('mongoose');

const voteSchema = new mongoose.Schema(
  {
    watchSpaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WatchSpace',
      required: true,
      index: true,
    },
    titleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Title', required: true },
    variationId: { type: String, required: true, index: true },
    question: { type: String, default: '' },
    options: {
      type: [{ id: String, label: String, description: String }],
      default: [],
    },
    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    closesAt: { type: Date, required: true },
    openedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ballots: {
      type: [
        {
          userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
          optionId: { type: String, required: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    winningOptionId: { type: String, default: '' },
    closedAt: { type: Date },
  },
  { timestamps: true }
);

voteSchema.index({ watchSpaceId: 1, variationId: 1, status: 1 });

voteSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    watchSpaceId: String(this.watchSpaceId),
    variationId: this.variationId,
    question: this.question,
    options: this.options.map((o) => ({
      id: o.id,
      label: o.label,
      description: o.description,
    })),
    status: this.status,
    closesAt: this.closesAt,
    winningOptionId: this.winningOptionId,
    ballotCount: this.ballots.length,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('Vote', voteSchema);
