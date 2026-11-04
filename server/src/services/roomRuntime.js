'use strict';

/**
 * In-memory real-time room runtime.
 *
 * Authoritative playback position lives here (never in the database — PRD §9.4);
 * only coarse session summaries are persisted. One process owns a room's clock,
 * which is the documented single-worker deployment assumption of this build.
 */

const config = require('../config/env');
const { createLogger } = require('../lib/logger');
const analytics = require('./analyticsService');
const WatchSpace = require('../models/WatchSpace');
const ChatMessage = require('../models/ChatMessage');
const {
  createPlaybackState,
  transition,
  snapshot,
  positionAt,
  computeDriftMs,
  correctionFor,
} = require('./playbackStateMachine');
const { markersCrossed, isTriviaEligible } = require('./timelineService');

const log = createLogger('room');

const rooms = new Map();
let ioRef = null;

function envelope(event, watchSpaceId, payload) {
  return { event, watchSpaceId, payload, ts: Date.now() };
}

function init(io) {
  ioRef = io;
}

function roomId(spaceId) {
  return `ws:${spaceId}`;
}

function emit(room, event, payload) {
  if (!ioRef) return;
  ioRef.to(roomId(room.watchSpaceId)).emit(event, envelope(event, room.watchSpaceId, payload));
}

function ensureRoom(space, title) {
  const id = String(space._id);
  let room = rooms.get(id);
  if (!room) {
    room = {
      watchSpaceId: id,
      titleId: String(title._id),
      title,
      hostUserId: String(space.hostUserId),
      playback: createPlaybackState({
        durationSeconds: title.durationSeconds,
        now: Date.now(),
      }),
      connected: new Map(), // userId -> { socketIds:Set, joinedAt, displayName, role }
      sockets: new Map(), // socketId -> userId
      muted: new Set(),
      locked: space.status === 'ended',
      triviaSeen: new Set(),
      characterSeen: new Set(),
      variationAnnounced: new Set(),
      lastTickPosition: 0,
      tickTimer: null,
      pendingSeekTimer: null,
      hostMissingAt: null,
      hostGraceTimer: null,
      ended: space.status === 'ended',
      startedAt: space.startedAt || null,
      verbosity: space.settings?.aiVerbosity || 'normal',
    };
    rooms.set(id, room);
    startTicker(room);
  } else {
    room.title = title;
    room.playback.durationSeconds = title.durationSeconds;
    if (String(space.hostUserId) !== room.hostUserId) room.hostUserId = String(space.hostUserId);
    room.verbosity = space.settings?.aiVerbosity || room.verbosity || 'normal';
  }
  return room;
}

function getRoom(spaceId) {
  return rooms.get(String(spaceId));
}

function setHost(room, hostUserId) {
  room.hostUserId = String(hostUserId);
}

function presencePayload(room) {
  const participants = [...room.connected.entries()].map(([userId, info]) => ({
    userId,
    displayName: info.displayName,
    role: info.userId === room.hostUserId ? 'host' : info.role,
    joinedAt: info.joinedAt,
    muted: room.muted.has(userId),
    connections: info.socketIds.size,
  }));
  return {
    participantCount: room.connected.size,
    participantId: null,
    participants,
    hostUserId: room.hostUserId,
    locked: room.locked,
    mutedUserIds: [...room.muted],
  };
}

function broadcastPresence(room, action, userId) {
  const payload = presencePayload(room);
  emit(room, 'room.presence.update', { ...payload, action, participantId: userId || null });
}

function attach(space, title, user, socket) {
  const room = ensureRoom(space, title);
  if (room.locked) {
    const error = new Error('This Watch Space is locked');
    error.code = 'room_locked';
    throw error;
  }

  const userId = String(user._id);
  const existing = room.connected.get(userId);
  if (!existing && room.connected.size >= (space.settings?.maxParticipants || 25)) {
    const error = new Error('This Watch Space is full');
    error.code = 'room_full';
    throw error;
  }

  if (existing) {
    existing.socketIds.add(socket.id);
  } else {
    room.connected.set(userId, {
      socketIds: new Set([socket.id]),
      joinedAt: new Date(),
      displayName: user.displayName,
      role: user.role,
      userId,
    });
    // Presence enters/leaves the log exactly once per live connection, so the
    // session report's peak concurrency reconciles with the event log.
    analytics.recordSoon({
      watchSpaceId: room.watchSpaceId,
      type: 'participant_joined',
      userId,
    });
    WatchSpace.findByIdAndUpdate(room.watchSpaceId, {
      $max: { peakParticipants: room.connected.size },
    }).catch(() => {});
  }
  room.sockets.set(socket.id, userId);
  socket.join(roomId(room.watchSpaceId));

  const reconnectedHost = room.hostUserId === userId && room.hostMissingAt;
  if (room.hostUserId === userId && room.hostGraceTimer) {
    clearTimeout(room.hostGraceTimer);
    room.hostGraceTimer = null;
    room.hostMissingAt = null;
    emit(room, 'room.host.reconnected', { hostUserId: userId });
    analytics.recordSoon({
      watchSpaceId: room.watchSpaceId,
      type: 'host_reconnected',
      userId,
    });
    if (room.playback.status === 'paused') {
      // Playback deliberately stays paused after a host drop; the host decides
      // when to resume so no one's experience jumps.
      emit(room, 'room.playback.update', {
        action: 'pause',
        ...snapshot(room.playback),
        issuedBy: userId,
        reason: 'host_reconnected',
      });
    }
  }

  broadcastPresence(room, 'joined', userId);
  return { room, reconnectedHost };
}

function detach(socket) {
  for (const room of rooms.values()) {
    const userId = room.sockets.get(socket.id);
    if (!userId) continue;
    room.sockets.delete(socket.id);
    const info = room.connected.get(userId);
    if (info) {
      info.socketIds.delete(socket.id);
      if (info.socketIds.size === 0) {
        room.connected.delete(userId);
        broadcastPresence(room, 'left', userId);
        analytics.recordSoon({
          watchSpaceId: room.watchSpaceId,
          type: 'participant_left',
          userId,
        });
      }
    }
    if (userId === room.hostUserId && !room.connected.has(userId)) {
      handleHostMissing(room);
    }
    if (room.connected.size === 0) {
      stopTicker(room);
    }
  }
}

function handleHostMissing(room) {
  if (room.ended || room.hostGraceTimer) return;
  room.hostMissingAt = Date.now();
  if (room.playback.status === 'playing') {
    room.playback = transition(room.playback, 'pause', { now: Date.now() });
  }
  emit(room, 'room.host.disconnected', {
    hostUserId: room.hostUserId,
    paused: true,
    graceMs: config.room.hostGraceMs,
    playback: snapshot(room.playback),
    policy: 'pause-then-promote-longest-present-participant',
  });
  analytics.recordSoon({
    watchSpaceId: room.watchSpaceId,
    type: 'host_disconnected',
    userId: room.hostUserId,
  });
  log.info('host_disconnected', { watchSpaceId: room.watchSpaceId, graceMs: config.room.hostGraceMs });

  room.hostGraceTimer = setTimeout(() => {
    promoteAfterHostLoss(room).catch((error) => {
      log.error('host_promotion_failed', { message: error.message });
    });
  }, config.room.hostGraceMs);
  if (room.hostGraceTimer.unref) room.hostGraceTimer.unref();
}

async function promoteAfterHostLoss(room) {
  room.hostGraceTimer = null;
  if (room.ended) return;
  const candidates = [...room.connected.entries()]
    .filter(([userId]) => userId !== room.hostUserId)
    .sort((a, b) => new Date(a[1].joinedAt) - new Date(b[1].joinedAt));
  if (candidates.length === 0) {
    emit(room, 'room.host.disconnected', {
      hostUserId: room.hostUserId,
      paused: true,
      participantCount: 0,
      promotion: 'none',
    });
    return;
  }
  const [newHostId, info] = candidates[0];
  const previous = room.hostUserId;
  room.hostUserId = newHostId;
  room.hostMissingAt = null;
  await WatchSpace.findByIdAndUpdate(room.watchSpaceId, { hostUserId: newHostId });
  emit(room, 'room.host.changed', {
    previousHostUserId: previous,
    hostUserId: newHostId,
    displayName: info.displayName,
    reason: 'host_inactivity',
    playback: snapshot(room.playback),
  });
  emit(room, 'room.system.message', {
    body: `${info.displayName} is now the host. Playback is paused — press play to continue.`,
  });
  analytics.recordSoon({
    watchSpaceId: room.watchSpaceId,
    type: 'host_changed',
    userId: newHostId,
    payload: { previousHostUserId: previous, reason: 'host_inactivity' },
  });
  log.info('host_promoted', { watchSpaceId: room.watchSpaceId, newHostId });
}

function isHost(room, userId) {
  return String(userId) === String(room.hostUserId);
}

function applyPlayback(room, { action, positionSeconds, userId }) {
  if (room.ended) {
    const error = new Error('This Watch Space has ended');
    error.code = 'room_ended';
    throw error;
  }
  if (!isHost(room, userId)) {
    const error = new Error('Only the current host can control playback');
    error.code = 'not_host';
    error.status = 403;
    throw error;
  }

  const now = Date.now();
  const previousStatus = room.playback.status;
  room.playback = transition(room.playback, action, {
    positionSeconds,
    now,
    issuedBy: userId,
    durationSeconds: room.title.durationSeconds,
  });

  if (action === 'seek') {
    clearTimeout(room.pendingSeekTimer);
    room.pendingSeekTimer = setTimeout(() => settleSeek(room), 300);
    if (room.pendingSeekTimer.unref) room.pendingSeekTimer.unref();
  }

  if (action === 'play' && previousStatus !== 'playing') {
    if (!room.startedAt) {
      room.startedAt = new Date();
      WatchSpace.findByIdAndUpdate(room.watchSpaceId, {
        status: 'live',
        startedAt: room.startedAt,
      }).catch(() => {});
      analytics.recordSoon({ watchSpaceId: room.watchSpaceId, type: 'room_started', userId });
    }
    room.lastTickPosition = positionAt(room.playback, now) - 0.001;
    startTicker(room);
  }

  if (action === 'seek') {
    // A forward seek must not replay skipped trivia markers.
    room.lastTickPosition = positionAt(room.playback, now);
  }

  const payload = {
    action,
    ...snapshot(room.playback, now),
    issuedBy: userId,
  };
  emit(room, 'room.playback.update', payload);
  return payload;
}

function settleSeek(room) {
  if (room.ended || room.playback.status !== 'seeking') return;
  room.playback = transition(room.playback, 'seekEnd', { now: Date.now() });
  room.lastTickPosition = positionAt(room.playback, Date.now());
  emit(room, 'room.playback.update', {
    action: 'seekEnd',
    ...snapshot(room.playback),
    issuedBy: room.hostUserId,
  });
}

function syncPing(room, user, { clientSentAt, positionSeconds }) {
  const now = Date.now();
  const authoritative = positionAt(room.playback, now);
  const clientPosition = Number.isFinite(positionSeconds) ? positionSeconds : authoritative;
  const driftMs = computeDriftMs(authoritative, clientPosition);
  const correction = correctionFor({
    driftMs,
    softMs: config.room.driftSoftMs,
    hardMs: config.room.driftHardMs,
    authoritativePositionSeconds: Number(authoritative.toFixed(3)),
    clientPositionSeconds: clientPosition,
  });
  return {
    clientSentAt,
    serverReceivedAt: now,
    serverSentAt: now,
    serverNow: now,
    authoritativePositionSeconds: Number(authoritative.toFixed(3)),
    status: room.playback.status,
    revision: room.playback.revision,
    driftMs,
    correction,
    hostUserId: room.hostUserId,
  };
}

function startTicker(room) {
  if (room.tickTimer || room.ended) return;
  room.tickTimer = setInterval(() => tick(room), config.room.triviaTickMs);
  if (room.tickTimer.unref) room.tickTimer.unref();
}

function stopTicker(room) {
  if (room.tickTimer) {
    clearInterval(room.tickTimer);
    room.tickTimer = null;
  }
}

function tick(room) {
  if (room.ended || room.connected.size === 0) return;
  if (room.playback.status !== 'playing') {
    room.lastTickPosition = positionAt(room.playback, Date.now());
    return;
  }
  const now = Date.now();
  const position = positionAt(room.playback, now);
  const crossed = markersCrossed(room.title.timeline, room.lastTickPosition, position, {
    maxWindowSeconds: Math.max(5, config.room.triviaTickMs / 1000 + 2),
  });
  const verbosity = room.verbosity || 'normal';

  for (const event of crossed) {
    if (event.type === 'trivia' && !room.triviaSeen.has(event.id)) {
      if (verbosity === 'chatty' || isTriviaEligible(event, verbosity)) {
        room.triviaSeen.add(event.id);
        emit(room, 'room.ai.trivia', {
          eventId: event.id,
          text: event.text,
          title: event.title,
          character: event.character,
          scene: event.scene,
          tsSeconds: event.ts,
          priority: event.priority,
          auto: true,
        });
        WatchSpace.findByIdAndUpdate(room.watchSpaceId, { $inc: { triviaCount: 1 } }).catch(() => {});
        analytics.recordSoon({
          watchSpaceId: room.watchSpaceId,
          type: 'trivia_surfaced',
          payload: { eventId: event.id, tsSeconds: event.ts },
        });
      }
    }
    if (event.type === 'variation_point' && !room.variationAnnounced.has(event.id)) {
      room.variationAnnounced.add(event.id);
      emit(room, 'room.variation.available', {
        variationId: event.id,
        tsSeconds: event.ts,
        question: event.title || 'An approved variation is available',
        options: (event.options || []).map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description,
        })),
        variationKind: event.variationKind,
      });
    }
  }

  if (verbosity === 'chatty') {
    for (const event of room.title.timeline || []) {
      if (
        event.type === 'character' &&
        !room.characterSeen.has(event.id) &&
        event.ts > room.lastTickPosition &&
        event.ts <= position
      ) {
        room.characterSeen.add(event.id);
        emit(room, 'room.ai.character', {
          eventId: event.id,
          character: event.character,
          text: event.text,
          tsSeconds: event.ts,
        });
      }
    }
  }

  room.lastTickPosition = position;
  if (position >= room.playback.durationSeconds) {
    room.playback = transition(room.playback, 'end', { now });
    emit(room, 'room.playback.update', {
      action: 'end',
      ...snapshot(room.playback, now),
      issuedBy: 'server',
    });
  }
}

function setSettings(room, settings = {}) {
  if (settings.aiVerbosity) room.verbosity = settings.aiVerbosity;
  if (typeof settings.locked === 'boolean') setLocked(room, settings.locked);
}

function setMuted(room, userId, muted) {
  const target = String(userId);
  if (muted) room.muted.add(target);
  else room.muted.delete(target);
  const info = room.connected.get(target);
  if (info && ioRef) {
    for (const socketId of info.socketIds) {
      const socket = ioRef.sockets.sockets.get(socketId);
      socket?.emit(
        'room.moderated',
        envelope('room.moderated', room.watchSpaceId, {
          action: muted ? 'muted' : 'unmuted',
          by: room.hostUserId,
        })
      );
    }
  }
  broadcastPresence(room, 'updated', target);
}

function setLocked(room, locked) {
  room.locked = Boolean(locked);
  emit(room, 'room.lock.update', { locked: room.locked, by: room.hostUserId });
  broadcastPresence(room, 'updated', null);
}

function transferHostTo(room, newHostUserId, previousHostUserId) {
  room.hostUserId = String(newHostUserId);
  room.hostMissingAt = null;
  emit(room, 'room.host.changed', {
    previousHostUserId: previousHostUserId ? String(previousHostUserId) : null,
    hostUserId: String(newHostUserId),
    reason: 'transfer',
    playback: snapshot(room.playback),
  });
  broadcastPresence(room, 'updated', null);
}

async function endRoom(room, userId) {
  room.ended = true;
  stopTicker(room);
  clearTimeout(room.pendingSeekTimer);
  clearTimeout(room.hostGraceTimer);
  if (room.playback.status === 'playing') {
    room.playback = transition(room.playback, 'pause', { now: Date.now() });
  }
  emit(room, 'room.ended', {
    endedBy: userId,
    endedAt: new Date().toISOString(),
    playback: snapshot(room.playback),
  });
  analytics.recordSoon({ watchSpaceId: room.watchSpaceId, type: 'room_ended', userId });
  await ChatMessage.create({
    watchSpaceId: room.watchSpaceId,
    type: 'system',
    body: 'The host ended this Watch Space.',
    tsSeconds: positionAt(room.playback, Date.now()),
  }).catch(() => {});
  emit(room, 'room.system.message', { body: 'The host ended this Watch Space.' });
  rooms.delete(room.watchSpaceId);
}

function removeParticipant(room, userId) {
  room.muted.delete(userId);
  const info = room.connected.get(userId);
  if (info) {
    for (const socketId of info.socketIds) {
      const socket = ioRef?.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit(
          'room.moderated',
          envelope('room.moderated', room.watchSpaceId, {
            action: 'removed',
            reason: 'Removed by the host',
          })
        );
        socket.leave(roomId(room.watchSpaceId));
      }
      room.sockets.delete(socketId);
    }
    room.connected.delete(userId);
    broadcastPresence(room, 'left', userId);
  }
}

function destroyAll() {
  for (const room of rooms.values()) {
    stopTicker(room);
    clearTimeout(room.pendingSeekTimer);
    clearTimeout(room.hostGraceTimer);
  }
  rooms.clear();
}

module.exports = {
  init,
  ensureRoom,
  getRoom,
  attach,
  detach,
  applyPlayback,
  settleSeek,
  syncPing,
  setSettings,
  setMuted,
  setLocked,
  transferHostTo,
  endRoom,
  removeParticipant,
  setHost,
  presencePayload,
  broadcastPresence,
  emit,
  roomId,
  envelope,
  destroyAll,
  isHost,
  handleHostMissing,
  promoteAfterHostLoss,
  tick,
  _rooms: rooms,
};
