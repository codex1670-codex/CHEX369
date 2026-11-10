import type { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { config } from './config.js';

/**
 * When REDIS_URL is set, Socket.IO rooms and broadcasts are shared across every server instance, so
 * the app can scale horizontally (several containers) without chat, calls or games losing messages.
 * Without it, it is a harmless no-op.
 */
export function attachRealtimeAdapter(io: Server, url: string | undefined = config.REDIS_URL): { enabled: boolean; close: () => Promise<void> } {
  if (!url) return { enabled: false, close: async () => {} };
  const pub = new Redis(url, { maxRetriesPerRequest: null });
  const sub = pub.duplicate();
  for (const c of [pub, sub]) c.on('error', (err: Error) => console.warn('[nexa] realtime redis error:', err.message));
  io.adapter(createAdapter(pub, sub));
  return { enabled: true, close: async () => { await Promise.allSettled([pub.quit(), sub.quit()]); } };
}
