'use strict';

const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    watchSpaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WatchSpace',
      required: true,
      index: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    displayName: { type: String, default: '' },
    type: {
      type: String,
      enum: ['chat', 'ai_answer', 'ai_trivia', 'system'],
      default: 'chat',
    },
    body: { type: String, required: true, maxlength: 2000 },
    tsSeconds: { type: Number, default: 0 },
    clientMessageId: { type: String, default: '' },
    payload: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

chatMessageSchema.index({ watchSpaceId: 1, createdAt: 1 });
chatMessageSchema.index({ watchSpaceId: 1, clientMessageId: 1 });

chatMessageSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    watchSpaceId: String(this.watchSpaceId),
    userId: this.userId ? String(this.userId) : null,
    displayName: this.displayName || (this.type === 'chat' ? 'Guest' : 'AI Co-Pilot'),
    type: this.type,
    body: this.body,
    tsSeconds: this.tsSeconds,
    payload: this.payload,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
