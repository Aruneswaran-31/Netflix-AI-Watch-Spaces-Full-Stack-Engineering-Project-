'use strict';

const SessionEvent = require('../models/SessionEvent');
const { createLogger } = require('../lib/logger');

const log = createLogger('analytics');

async function record({ watchSpaceId, type, userId, payload = {}, correlationId = '' }) {
  try {
    await SessionEvent.create({ watchSpaceId, type, userId, payload, correlationId });
  } catch (error) {
    log.warn('session_event_failed', { message: error.message, type });
  }
}

function recordSoon(event) {
  // Analytics must never block a socket broadcast or an API response.
  setImmediate(() => {
    record(event).catch(() => {});
  });
}

/**
 * Build a session report purely from the event log, so numbers reconcile with
 * the log by construction (PRD §6.3 acceptance criteria).
 */
async function sessionSummary(watchSpaceId) {
  const [rows, byType] = await Promise.all([
    SessionEvent.find({ watchSpaceId }).sort({ createdAt: 1 }).lean(),
    SessionEvent.aggregate([
      { $match: { watchSpaceId: require('mongoose').Types.ObjectId.createFromHexString(String(watchSpaceId)) } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
  ]);

  const counts = Object.fromEntries(byType.map((row) => [row._id, row.count]));
  const joins = rows.filter((row) => row.type === 'participant_joined');
  const leaves = rows.filter((row) => row.type === 'participant_left');

  // Peak concurrency from the ordered join/leave log.
  let current = 0;
  let peak = 0;
  for (const row of rows) {
    if (row.type === 'participant_joined') current += 1;
    if (row.type === 'participant_left') current = Math.max(0, current - 1);
    peak = Math.max(peak, current);
  }

  const questions = counts.ai_question || 0;
  const answers = counts.ai_answer || 0;
  const first = rows[0]?.createdAt;
  const last = rows[rows.length - 1]?.createdAt;

  return {
    watchSpaceId: String(watchSpaceId),
    eventCount: rows.length,
    joinedCount: joins.length,
    leftCount: leaves.length,
    peakConcurrentParticipants: peak,
    chatMessages: counts.chat || 0,
    aiQuestions: questions,
    aiAnswers: answers,
    triviaSurfaced: counts.trivia_surfaced || 0,
    variationsOpened: counts.variation_opened || 0,
    variationVotes: counts.variation_vote || 0,
    variationsApplied: counts.variation_applied || 0,
    subtitleSwaps: counts.subtitle_swapped || 0,
    hostChanges: counts.host_changed || 0,
    observedDurationSeconds: first && last ? Math.round((last - first) / 1000) : 0,
    countsByType: counts,
    timeline: rows.map((row) => ({
      type: row.type,
      at: row.createdAt,
      userId: row.userId ? String(row.userId) : null,
      payload: row.payload,
    })),
  };
}

module.exports = { record, recordSoon, sessionSummary };
