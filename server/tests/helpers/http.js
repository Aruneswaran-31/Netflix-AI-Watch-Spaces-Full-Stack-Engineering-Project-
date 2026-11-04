'use strict';

const http = require('http');
const { io: ioClient } = require('socket.io-client');
const { createApp } = require('../../src/app');
const { createSocketServer } = require('../../src/sockets');
const roomRuntime = require('../../src/services/roomRuntime');

async function startTestServer() {
  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server);
  app.set('io', io);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { app, server, io, url: `http://127.0.0.1:${port}` };
}

async function stopTestServer({ server, io }) {
  roomRuntime.destroyAll();
  await new Promise((resolve) => io.close(resolve));
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}

function connectSocket(url, token) {
  const socket = ioClient(url, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function emitAck(socket, event, payload = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), timeoutMs);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function waitForEvent(socket, event, { predicate = () => true, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    function handler(message) {
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(message);
    }
    socket.on(event, handler);
  });
}

module.exports = { startTestServer, stopTestServer, connectSocket, emitAck, waitForEvent };
