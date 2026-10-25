// Who is online right now. A user counts as online while at least one of their sockets is
// connected (phone + laptop = 2 connections, still one person). Held in memory only: it is
// live state, so it resets on a restart and everybody simply reconnects.
import db from './db.js';

const connections = new Map(); // userId -> number of open sockets

export function markConnected(userId) {
  const n = (connections.get(userId) || 0) + 1;
  connections.set(userId, n);
  return n === 1; // true when this is the user's first socket (they just came online)
}

export function markDisconnected(userId) {
  const n = (connections.get(userId) || 0) - 1;
  if (n <= 0) { connections.delete(userId); return true; } // true when their last socket closed
  connections.set(userId, n);
  return false;
}

// People who switched "Show when I'm online" off never appear as online to anyone else.
export function showsOnline(userId) {
  const row = db.prepare('SELECT show_online FROM users WHERE id = ?').get(userId);
  return !!row && row.show_online !== 0;
}

export function isConnected(userId) { return connections.has(userId); }

export function isOnline(userId) {
  return connections.has(userId) && showsOnline(userId);
}

// Online user ids visible to `viewerId` (never includes people blocked either way).
export function onlineIdsFor(viewerId) {
  const blocked = new Set(db.prepare(`
    SELECT blocked_id AS id FROM blocks WHERE blocker_id = ?
    UNION SELECT blocker_id AS id FROM blocks WHERE blocked_id = ?
  `).all(viewerId, viewerId).map(r => r.id));
  const out = [];
  for (const id of connections.keys()) {
    if (id === viewerId || blocked.has(id) || !showsOnline(id)) continue;
    out.push(id);
    if (out.length >= 500) break;
  }
  return out;
}
