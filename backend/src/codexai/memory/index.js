// Memory AI front door. MongoDB when MONGODB_URI is set; otherwise the local database (clearly reported in the dashboard).
// The Mongo connection is made lazily and shared, so a slow/offline MongoDB never blocks server start-up; if it is
// unreachable, calls fail fast and CODEX still answers (history just isn't saved, and the person is told).
import { createSqliteMemory } from './sqliteStore.js';
import { createMongoMemory, connectMongo } from './mongoStore.js';
import { redact } from '../../circle/redact.js';

export function createMemory({ db, config, connect = connectMongo, mongoDbFactory } = {}) {
  const local = createSqliteMemory(db);
  if (!config.mongo.uri && !mongoDbFactory) return local;

  let store = null; let failedAt = 0;
  const open = async () => {
    if (store) return store;
    if (Date.now() - failedAt < 30_000) throw new Error('MongoDB unavailable');
    try {
      const conn = mongoDbFactory ? await mongoDbFactory() : await connect({ uri: config.mongo.uri, dbName: config.mongo.db });
      store = createMongoMemory(conn.db || conn); return store;
    } catch (e) { failedAt = Date.now(); throw e; }
  };
  const proxy = { kind: 'mongodb' };
  for (const name of Object.keys(local).filter((k) => k !== 'kind')) {
    proxy[name] = async (...args) => (await open())[name](...args);
  }
  proxy.status = async () => { try { return await (await open()).status(); } catch { return { kind: 'mongodb', ok: false }; } };
  return proxy;
}

// What may be saved as a long-term memory: short, plain, and never a secret.
export function validateMemoryText(text, maxChars = 300) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 3) return { ok: false, error: 'That memory is too short.' };
  if (t.length > maxChars) return { ok: false, error: `Keep a memory under ${maxChars} characters.` };
  if (redact(t).count > 0) return { ok: false, error: 'That looks like it contains private details (a number, email, password or code). CODEX does not store those.' };
  return { ok: true, text: t };
}
