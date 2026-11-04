'use strict';

const mongoose = require('mongoose');

const watchSpaceSchema = new mongoose.Schema(
  {
    titleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Title', required: true, index: true },
    hostUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    inviteCode: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ['scheduled', 'live', 'ended'],
      default: 'scheduled',
      index: true,
    },
    visibility: { type: String, enum: ['public', 'invite'], default: 'invite' },
    settings: {
      maxParticipants: { type: Number, default: 25, min: 2, max: 50 },
      aiVerbosity: { type: String, enum: ['minimal', 'normal', 'chatty'], default: 'normal' },
      votingEnabled: { type: Boolean, default: true },
      subtitlesEnabled: { type: Boolean, default: true },
    },
    locked: { type: Boolean, default: false },
    participantIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
    peakParticipants: { type: Number, default: 0 },
    chatCount: { type: Number, default: 0 },
    aiQuestionCount: { type: Number, default: 0 },
    triviaCount: { type: Number, default: 0 },
    startedAt: { type: Date },
    endedAt: { type: Date },
    lastActivityAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

watchSpaceSchema.index({ status: 1, createdAt: -1 });

watchSpaceSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    titleId: String(this.titleId),
    hostUserId: String(this.hostUserId),
    name: this.name,
    inviteCode: this.inviteCode,
    status: this.status,
    locked: this.locked,
    visibility: this.visibility,
    settings: {
      maxParticipants: this.settings?.maxParticipants ?? 25,
      aiVerbosity: this.settings?.aiVerbosity ?? 'normal',
      votingEnabled: this.settings?.votingEnabled ?? true,
      subtitlesEnabled: this.settings?.subtitlesEnabled ?? true,
    },
    participantIds: (this.participantIds || []).map(String),
    peakParticipants: this.peakParticipants,
    createdAt: this.createdAt,
    startedAt: this.startedAt,
    endedAt: this.endedAt,
  };
};

module.exports = mongoose.model('WatchSpace', watchSpaceSchema);
