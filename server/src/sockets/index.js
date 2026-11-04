'use strict';

const { Server } = require('socket.io');
const config = require('../config/env');
const { createLogger } = require('../lib/logger');
const { cleanText } = require('../lib/sanitize');
const authService = require('../services/authService');
const roomService = require('../services/roomService');
const roomRuntime = require('../services/roomRuntime');
const coPilot = require('../services/coPilotRoomService');
const voteService = require('../services/voteService');
const analytics = require('../services/analyticsService');
const WatchSpace = require('../models/WatchSpace');
const Title = require('../models/Title');
const ChatMessage = require('../models/ChatMessage');
const { snapshot, positionAt } = require('../services/playbackStateMachine');

const log = createLogger('socket');

function allow(socket, key, max, windowMs) {
  const now = Date.now();
  const bucket = (socket.data.rate ||= {});
  const hits = (bucket[key] || []).filter((ts) => now - ts < windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  bucket[key] = hits;
  return true;
}

function ok(ack, payload) {
  if (typeof ack === 'function') ack({ ok: true, ...payload });
}

function fail(ack, error) {
  if (typeof ack === 'function') {
    ack({
      ok: false,
      error: {
        code: error.code || (error.status === 403 ? 'forbidden' : 'error'),
        message: error.message || 'Request failed',
      },
    });
  }
}

function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigins, credentials: true },
    path: '/socket.io',
    pingInterval: 20000,
    pingTimeout: 20000,
    maxHttpBufferSize: 512 * 1024,
  });

  roomRuntime.init(io);

  io.use(async (socket, next) => {
    try {
      const header = socket.handshake.headers?.authorization || '';
      const token =
        socket.handshake.auth?.token ||
        (header.startsWith('Bearer ') ? header.slice(7) : null);
      if (!token) return next(new Error('unauthorized'));
      socket.data.user = await authService.userFromAccessToken(token);
      socket.data.rooms = new Set();
      next();
    } catch (error) {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    log.info('socket_connected', { socketId: socket.id, userId: String(user._id) });

    const loadRoom = async (watchSpaceId) => {
      const space = await WatchSpace.findById(watchSpaceId);
      if (!space) throw Object.assign(new Error('Watch Space not found'), { code: 'not_found' });
      const title = await Title.findById(space.titleId);
      if (!title) throw Object.assign(new Error('Title not found'), { code: 'not_found' });
      return { space, title };
    };

    socket.on('room.join', async (payload = {}, ack) => {
      try {
        const { space, title } = payload.watchSpaceId
          ? await loadRoom(payload.watchSpaceId)
          : await (async () => {
              const found = await WatchSpace.findOne({ inviteCode: payload.inviteCode });
              if (!found) throw Object.assign(new Error('Invite code not found'), { code: 'not_found' });
              return loadRoom(found._id);
            })();

        await roomService.joinWatchSpace({ space, user });
        const { room } = roomRuntime.attach(space, title, user, socket);
        room.verbosity = space.settings?.aiVerbosity || 'normal';
        socket.data.rooms.add(room.watchSpaceId);

        const presence = roomRuntime.presencePayload(room);
        socket.emit(
          'room.state.snapshot',
          roomRuntime.envelope('room.state.snapshot', room.watchSpaceId, {
            watchSpace: (await WatchSpace.findById(space._id)).toPublic(),
            title: title.toPublic(),
            playback: snapshot(room.playback),
            presence,
            serverNow: Date.now(),
            you: {
              userId: String(user._id),
              role: user.role,
              isHost: roomRuntime.isHost(room, user._id),
            },
          })
        );

        ok(ack, {
          watchSpaceId: room.watchSpaceId,
          title: title.toPublic(),
          playback: snapshot(room.playback),
          presence,
          serverNow: Date.now(),
          isHost: roomRuntime.isHost(room, user._id),
        });
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('room.leave', async (payload = {}, ack) => {
      const watchSpaceId = String(payload.watchSpaceId || '');
      socket.leave(roomRuntime.roomId(watchSpaceId));
      socket.data.rooms?.delete(watchSpaceId);
      roomRuntime.detach(socket);
      ok(ack, { watchSpaceId });
    });

    socket.on('room.playback.update', async (payload = {}, ack) => {
      try {
        const room = roomRuntime.getRoom(payload.watchSpaceId);
        if (!room) throw Object.assign(new Error('Join the room first'), { code: 'not_joined' });
        if (!allow(socket, 'playback', 20, 1000)) throw Object.assign(new Error('Too many playback events'), { code: 'rate_limited' });
        const result = roomRuntime.applyPlayback(room, {
          action: payload.action,
          positionSeconds: payload.positionSeconds,
          userId: user._id,
        });
        ok(ack, { playback: result });
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('room.sync.ping', async (payload = {}, ack) => {
      const room = roomRuntime.getRoom(payload.watchSpaceId);
      if (!room) {
        fail(ack, Object.assign(new Error('Join the room first'), { code: 'not_joined' }));
        return;
      }
      const result = roomRuntime.syncPing(room, user, {
        clientSentAt: payload.clientSentAt,
        positionSeconds: payload.positionSeconds,
      });
      ok(ack, result);
    });

    socket.on('room.chat.message', async (payload = {}, ack) => {
      try {
        const room = roomRuntime.getRoom(payload.watchSpaceId);
        if (!room) throw Object.assign(new Error('Join the room first'), { code: 'not_joined' });
        if (room.muted.has(String(user._id))) {
          throw Object.assign(new Error('The host muted you in this room'), { code: 'muted' });
        }
        if (!allow(socket, 'chat', 6, 3000)) {
          throw Object.assign(new Error('Slow down a little'), { code: 'rate_limited' });
        }
        const body = cleanText(payload.body, { maxLength: 1000 });
        if (!body) throw Object.assign(new Error('Message is empty'), { code: 'empty_message' });

        const message = await ChatMessage.create({
          watchSpaceId: room.watchSpaceId,
          userId: user._id,
          displayName: user.displayName,
          type: 'chat',
          body,
          tsSeconds: positionAt(room.playback, Date.now()),
          clientMessageId: cleanText(payload.clientMessageId || '', { maxLength: 80 }),
        });
        await WatchSpace.findByIdAndUpdate(room.watchSpaceId, {
          $inc: { chatCount: 1 },
          $set: { lastActivityAt: new Date() },
        });

        roomRuntime.emit(room, 'room.chat.message', message.toPublic());
        analytics.recordSoon({
          watchSpaceId: room.watchSpaceId,
          type: 'chat',
          userId: user._id,
          payload: { messageId: String(message._id) },
        });
        ok(ack, { message: message.toPublic() });
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('room.typing', (payload = {}) => {
      const watchSpaceId = String(payload.watchSpaceId || '');
      if (!socket.data.rooms?.has(watchSpaceId)) return;
      socket.to(roomRuntime.roomId(watchSpaceId)).emit(
        'room.typing',
        roomRuntime.envelope('room.typing', watchSpaceId, {
          userId: String(user._id),
          displayName: user.displayName,
          isTyping: Boolean(payload.isTyping),
        })
      );
    });

    socket.on('room.reaction', (payload = {}) => {
      const room = roomRuntime.getRoom(payload.watchSpaceId);
      if (!room) return;
      const emoji = cleanText(payload.emoji || '', { maxLength: 8 });
      if (!emoji) return;
      roomRuntime.emit(room, 'room.reaction', {
        userId: String(user._id),
        displayName: user.displayName,
        emoji,
        tsSeconds: positionAt(room.playback, Date.now()),
      });
    });

    socket.on('room.ai.ask', async (payload = {}, ack) => {
      try {
        const { space, title } = await loadRoom(payload.watchSpaceId);
        const isParticipant = space.participantIds.some((id) => String(id) === String(user._id));
        if (!isParticipant && user.role !== 'admin') {
          throw Object.assign(new Error('Join the Watch Space before asking the co-pilot'), { code: 'not_member' });
        }
        if (!allow(socket, 'ai', 3, 5000)) {
          throw Object.assign(new Error('Give the co-pilot a moment to finish'), { code: 'rate_limited' });
        }
        const result = await coPilot.askInRoom({
          space,
          title,
          user,
          question: payload.question,
          currentTs: payload.currentTs,
        });
        ok(ack, { result });
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('room.variation.open', async (payload = {}, ack) => {
      try {
        const { space, title } = await loadRoom(payload.watchSpaceId);
        if (!roomRuntime.isHost(roomRuntime.getRoom(space._id), user._id) && user.role !== 'admin') {
          throw Object.assign(new Error('Only the host can open a vote'), { code: 'forbidden' });
        }
        const vote = await voteService.openVote({
          space,
          title,
          variationId: payload.variationId,
          durationSeconds: payload.durationSeconds,
          user,
        });
        ok(ack, { vote });
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('room.variation.vote', async (payload = {}, ack) => {
      try {
        const { space } = await loadRoom(payload.watchSpaceId);
        const vote = await voteService.castBallot({
          voteId: payload.voteId,
          spaceId: space._id,
          user,
          optionId: payload.optionId,
        });
        ok(ack, { vote });
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('room.variation.close', async (payload = {}, ack) => {
      try {
        const { space } = await loadRoom(payload.watchSpaceId);
        if (!roomRuntime.isHost(roomRuntime.getRoom(space._id), user._id) && user.role !== 'admin') {
          throw Object.assign(new Error('Only the host can close a vote'), { code: 'forbidden' });
        }
        const vote = await voteService.closeVote({
          voteId: payload.voteId,
          spaceId: space._id,
          user,
        });
        ok(ack, { vote });
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('room.subtitle.set', (payload = {}) => {
      const locale = cleanText(payload.locale || 'en', { maxLength: 12 }) || 'en';
      socket.data.subtitleLocale = locale;
      socket.emit(
        'room.subtitle.variant',
        roomRuntime.envelope('room.subtitle.variant', String(payload.watchSpaceId || ''), {
          locale,
          subtitle: payload.subtitle || null,
        })
      );
    });

    socket.on('disconnect', (reason) => {
      roomRuntime.detach(socket);
      log.info('socket_disconnected', { socketId: socket.id, userId: String(user._id), reason });
    });
  });

  return io;
}

module.exports = { createSocketServer };
