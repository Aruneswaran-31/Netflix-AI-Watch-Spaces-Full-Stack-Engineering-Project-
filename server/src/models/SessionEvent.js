'use strict';

const mongoose = require('mongoose');

const SESSION_EVENT_TYPES = [
  'room_created',
  'room_started',
  'room_ended',
  'participant_joined',
  'participant_left',
  'chat',
  'ai_question',
  'ai_answer',
  'trivia_surfaced',
  'variation_opened',
  'variation_vote',
  'variation_applied',
  'subtitle_swapped',
  'playback',
  'host_changed',
  'host_disconnected',
  'host_reconnected',
];

const sessionEventSchema = new mongoose.Schema(
  {
    watchSpaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WatchSpace',
      required: true,
      index: true,
    },
    type: { type: String, enum: SESSION_EVENT_TYPES, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    payload: { type: mongoose.Schema.Types.Mixed },
    correlationId: { type: String, default: '' },
  },
  { timestamps: true }
);

sessionEventSchema.index({ watchSpaceId: 1, type: 1, createdAt: 1 });

module.exports = mongoose.model('SessionEvent', sessionEventSchema);
module.exports.SESSION_EVENT_TYPES = SESSION_EVENT_TYPES;
