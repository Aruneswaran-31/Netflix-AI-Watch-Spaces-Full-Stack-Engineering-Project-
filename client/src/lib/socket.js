import { io } from 'socket.io-client';
import { getTokens } from './api';

/**
 * One authenticated socket per room view. The access token travels in the
 * handshake; the server re-validates it and never trusts client room state.
 */
export function connectRoomSocket() {
  const token = getTokens()?.accessToken;
  const socket = io({
    path: '/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 600,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });
  return socket;
}

/** Promise wrapper around the socket ack contract: { ok, ... } | { ok:false, error }. */
export function emitAck(socket, event, payload, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('Not connected to the room yet'));
      return;
    }
    const timer = setTimeout(() => reject(new Error('The room did not respond in time')), timeoutMs);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      if (response?.ok) resolve(response);
      else reject(new Error(response?.error?.message || 'Room request failed'));
    });
  });
}
