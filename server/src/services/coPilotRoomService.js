'use strict';

const { randomUUID } = require('crypto');
const ChatMessage = require('../models/ChatMessage');
const WatchSpace = require('../models/WatchSpace');
const aiEngine = require('./aiEngine');
const analytics = require('./analyticsService');
const roomRuntime = require('./roomRuntime');
const { cleanText } = require('../lib/sanitize');
const { ApiError } = require('../lib/errors');
const { positionAt } = require('./playbackStateMachine');

/**
 * One code path for asking the co-pilot, whether the question arrives over REST
 * or the room socket. Persists both turns, updates counters, emits the answer.
 */
async function askInRoom({ space, title, user, question, currentTs }) {
  const safeQuestion = cleanText(question, { maxLength: 500 });
  if (safeQuestion.length < 2) throw ApiError.badRequest('Ask a question with at least 2 characters');

  const room = roomRuntime.getRoom(space._id);
  const ts = Number.isFinite(Number(currentTs))
    ? Math.max(0, Math.min(Number(currentTs), title.durationSeconds))
    : room
      ? positionAt(room.playback, Date.now())
      : 0;

  const started = Date.now();
  const result = await aiEngine.askCoPilot({ title, question: safeQuestion, currentTs: ts });
  const questionId = `q_${randomUUID().slice(0, 8)}`;

  const questionMessage = await ChatMessage.create({
    watchSpaceId: space._id,
    userId: user._id,
    displayName: user.displayName,
    type: 'chat',
    body: safeQuestion,
    tsSeconds: ts,
    payload: { kind: 'ai_question', questionId },
  }).catch(() => null);

  const answerMessage = await ChatMessage.create({
    watchSpaceId: space._id,
    userId: null,
    displayName: 'AI Co-Pilot',
    type: 'ai_answer',
    body: result.answer,
    tsSeconds: ts,
    payload: {
      questionId,
      question: safeQuestion,
      grounded: result.grounded,
      sources: result.sources,
      sourceEvents: result.sourceEvents,
      provider: result.provider,
      confidence: result.confidence,
      latencyMs: result.latencyMs,
    },
  }).catch(() => null);

  await WatchSpace.findByIdAndUpdate(space._id, { $inc: { aiQuestionCount: 1 } }).catch(() => {});

  const payload = {
    questionId,
    userId: String(user._id),
    displayName: user.displayName,
    question: safeQuestion,
    answer: result.answer,
    grounded: result.grounded,
    sources: result.sources,
    sourceEvents: result.sourceEvents,
    provider: result.provider,
    confidence: result.confidence,
    tsSeconds: ts,
    latencyMs: result.latencyMs,
    messageId: answerMessage ? String(answerMessage._id) : null,
    questionMessageId: questionMessage ? String(questionMessage._id) : null,
    generatedAt: result.generatedAt,
  };

  if (room) roomRuntime.emit(room, 'room.ai.answer', payload);

  analytics.recordSoon({
    watchSpaceId: space._id,
    type: 'ai_question',
    userId: user._id,
    payload: { questionId, question: safeQuestion, tsSeconds: ts },
  });
  analytics.recordSoon({
    watchSpaceId: space._id,
    type: 'ai_answer',
    userId: user._id,
    payload: {
      questionId,
      grounded: result.grounded,
      sourceEvents: result.sourceEvents,
      provider: result.provider,
      latencyMs: result.latencyMs,
      totalMs: Date.now() - started,
    },
  });

  return payload;
}

module.exports = { askInRoom };
