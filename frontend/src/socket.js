import { io } from 'socket.io-client';
import { getAccessToken, ensureFreshAccessToken } from './api.js';

let socket = null;

export function connectSocket() {
  if (socket) return socket;
  // `auth` is a function so every (re)connect sends the CURRENT token. A fixed object would keep
  // the first token, which expires after 15 minutes — and every later reconnect (network blip,
  // server restart/sleep) would then be rejected, silently killing chat, calls and games.
  socket = io('/', {
    auth: (cb) => cb({ token: getAccessToken() }),
    reconnectionDelayMax: 10000,
  });
  socket.on('connect_error', async (err) => {
    if (err?.message !== 'unauthorized') return;
    // Token expired: get a new one, then let socket.io retry with it.
    const fresh = await ensureFreshAccessToken();
    if (fresh && socket && !socket.connected) setTimeout(() => socket?.connect(), 500);
  });
  return socket;
}

export function getSocket() { return socket; }

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
