import { Redis } from 'ioredis';
import { config } from './config.js';

/**
 * Cache with one interface and two backends: Redis/Valkey when REDIS_URL is set, otherwise a small
 * in-process TTL map (single instance, dev, tests). Callers never need to know which one they have.
 */
export interface Cache {
  readonly backend: 'redis' | 'memory';
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Returns the cached value, or computes, stores and returns it. */
  wrap<T>(key: string, ttlSeconds: number, compute: () => Promise<T> | T): Promise<T>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

class MemoryCache implements Cache {
  readonly backend = 'memory' as const;
  private store = new Map<string, { v: string; exp: number }>();
  private sweeper = setInterval(() => this.sweep(), 60_000);
  constructor() { this.sweeper.unref(); }
  private sweep() { const now = Date.now(); for (const [k, e] of this.store) if (e.exp <= now) this.store.delete(k); }
  async get<T>(key: string) {
    const e = this.store.get(key);
    if (!e || e.exp <= Date.now()) { this.store.delete(key); return null; }
    return JSON.parse(e.v) as T;
  }
  async set(key: string, value: unknown, ttl = 60) { this.store.set(key, { v: JSON.stringify(value), exp: Date.now() + ttl * 1000 }); }
  async del(key: string) { this.store.delete(key); }
  async wrap<T>(key: string, ttl: number, compute: () => Promise<T> | T): Promise<T> { return wrapImpl(this, key, ttl, compute); }
  async ping() { return true; }
  async close() { clearInterval(this.sweeper); this.store.clear(); }
}

class RedisCache implements Cache {
  readonly backend = 'redis' as const;
  constructor(private client: Redis) {}
  async get<T>(key: string) { const v = await this.client.get(key); return v === null ? null : (JSON.parse(v) as T); }
  async set(key: string, value: unknown, ttl = 60) { await this.client.set(key, JSON.stringify(value), 'EX', ttl); }
  async del(key: string) { await this.client.del(key); }
  async wrap<T>(key: string, ttl: number, compute: () => Promise<T> | T): Promise<T> { return wrapImpl(this, key, ttl, compute); }
  async ping() { try { return (await this.client.ping()) === 'PONG'; } catch { return false; } }
  async close() { await this.client.quit().catch(() => {}); }
}

async function wrapImpl<T>(c: Cache, key: string, ttl: number, compute: () => Promise<T> | T): Promise<T> {
  const hit = await c.get<T>(key).catch(() => null);
  if (hit !== null) return hit;
  const fresh = await compute();
  await c.set(key, fresh, ttl).catch(() => {}); // a cache failure must never break a request
  return fresh;
}

export function createCache(url: string | undefined = config.REDIS_URL): Cache {
  if (!url) return new MemoryCache();
  const client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
  client.on('error', (err: Error) => console.warn('[nexa] redis error:', err.message));
  return new RedisCache(client);
}

export const cache: Cache = createCache();
