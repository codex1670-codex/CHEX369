
 // Durable storage on hosts with a throw-away disk (Render free/starter without a disk).
//
// The app's data model is SQLite (≈490 relational queries). Instead of rewriting all of it,
// this module keeps the SQLite file — and every uploaded photo/video — safe in MongoDB
// (GridFS) so accounts survive restarts, sleeps and redeploys:
//
//   boot      : if there is no local database, download the newest valid snapshot from MongoDB
//   running   : every SYNC_SECONDS, if anything changed, upload a consistent snapshot
//               (SQLite online-backup API, gzipped) + any new/changed upload files
//   shutdown  : one last flush (Render sends SIGTERM before stopping/redeploying)
//   uploads   : fetched back from MongoDB on first request if missing locally
//
// Safety rules (so a bad boot can never wipe good data):
//   * If MONGODB_URI is set but MongoDB can't be reached, or snapshots exist but none is
//     readable, the server REFUSES to start instead of starting empty and overwriting them.
//   * Only the newest instance owns a "lease"; an old instance that is still draining during a
//     zero-downtime deploy stops writing as soon as the new one takes over.
//   * The last 2 snapshots are kept; restore verifies the file (PRAGMA quick_check) first.
//
// Besides the snapshots, a plain, human-readable `users` collection is kept in the same MongoDB
// database (view it in Atlas -> Browse Collections): one document per account with the username,
// name, status and signup date (never the password or e-mail). It follows SQLite automatically:
// new / renamed accounts are upserted, and an account that is deleted is removed from MongoDB too.
//
// Not set (no MONGODB_URI) -> everything here is a no-op and the app behaves exactly as before.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const DB_FILE = 'nexa.db.gz';
const UP = 'u/'; // GridFS filename prefix for uploads
const INSTANCE = crypto.randomUUID();
const SYNC_MS = Math.max(5, Number(process.env.MONGO_SYNC_SECONDS) || 20) * 1000;

const log = (...a) => console.log('[persist]', ...a);
const warn = (...a) => console.warn('[persist]', ...a);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------------------------------
// Stores. Both implement the same tiny interface, so the logic below is testable offline.
// ---------------------------------------------------------------------------------------
export async function createMongoStore(uri, dbName = process.env.MONGODB_DB || 'chex') {
  const { MongoClient, GridFSBucket } = await import('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000, appName: 'chex' });
  await client.connect();
  const mdb = client.db(dbName);
  const bucket = new GridFSBucket(mdb, { bucketName: 'chex_state' });
  const meta = mdb.collection('chex_meta');
  const usersCol = mdb.collection(process.env.MONGO_USERS_COLLECTION || 'users');
  const versions = (name) => bucket.find({ filename: name }).sort({ uploadDate: -1 }).toArray();

  return {
    kind: 'mongodb',
    async takeLease(id) {
      await meta.updateOne(
        { _id: 'lease' },
        { $set: { owner: id, at: new Date() } },
        { upsert: true }
      );
    },
    async checkLease(id) {
      const d = await meta.findOne({ _id: 'lease' });
      return !d || d.owner === id;
    },
    async put(name, readable, metadata) {
      await pipeline(readable, bucket.openUploadStream(name, { metadata }));
    },
    // nth newest version (0 = newest), or null
    async get(name, nth = 0) {
      const f = (await versions(name))[nth];
      return f ? bucket.openDownloadStream(f._id) : null;
    },
    async count(name) {
      return (await versions(name)).length;
    },
    async prune(name, keep) {
      for (const f of (await versions(name)).slice(keep)) await bucket.delete(f._id);
    },
    async list(prefix) {
      const files = await bucket.find({
        filename: { $regex: '^' + escapeRe(prefix) }
      }).toArray();
      return files.map((f) => ({ name: f.filename, length: f.length }));
    },
    // Readable users collection (see header). upserts: changed rows; keepIds: every id that still exists.
    async syncUsers(upserts, keepIds) {
      if (upserts.length) {
        await usersCol.bulkWrite(
          upserts.map((r) => ({
            updateOne: {
              filter: { _id: r.id },
              update: {
                $set: {
                  username: r.username,
                  name: r.name,
                  status: r.status,
                  createdAt: r.createdAt,
                  updatedAt: new Date()
                }
              },
              upsert: true
            }
          })),
          { ordered: false }
        );
      }
      if (keepIds && keepIds.length) {
        await usersCol.deleteMany({ _id: { $nin: keepIds } });
      }
    },
    async removeUser(id) {
      await usersCol.deleteOne({ _id: id });
    },
    async close() {
      await client.close();
    }
  };
}

export function createMemoryStore() {
  const files = new Map(); // name -> [{buf}] newest first
  let lease = null;
  const users = new Map(); // id -> doc (mirrors the MongoDB `users` collection)
  const collect = async (r) => {
    const c = [];
    for await (const x of r) c.push(Buffer.from(x));
    return Buffer.concat(c);
  };

  return {
    kind: 'memory', files, users,
    async takeLease(id) {
      lease = id;
    },
    async checkLease(id) {
      return lease === null || lease === id;
    },
    async put(name, readable) {
      const buf = await collect(readable);
      files.set(name, [{ buf }, ...(files.get(name) || [])]);
    },
    async get(name, nth = 0) {
      const v = files.get(name)?.[nth];
      return v ? Readable.from([v.buf]) : null;
    },
    async count(name) {
      return (files.get(name) || []).length;
    },
    async prune(name, keep) {
      const v = files.get(name);
      if (!v) return;
      if (keep <= 0) files.delete(name);
      else files.set(name, v.slice(0, keep));
    },
    async list(prefix) {
      return [...files]
        .filter(([n]) => n.startsWith(prefix))
        .map(([n, v]) => ({ name: n, length: v[0].buf.length }));
    },
    async syncUsers(upserts, keepIds) {
      for (const r of upserts) {
        users.set(r.id, {
          _id: r.id,
          username: r.username,
          name: r.name,
          status: r.status,
          createdAt: r.createdAt
        });
      }
      if (keepIds && keepIds.length) {
        for (const id of [...users.keys()]) {
          if (!keepIds.includes(id)) users.delete(id);
        }
      }
    },
    async removeUser(id) {
      users.delete(id);
    },
    async close() {}
  };
}

// ---------------------------------------------------------------------------------------
// The sync engine
// ---------------------------------------------------------------------------------------
export function createPersistence({ uri = process.env.MONGODB_URI, storeFactory } = {}) {
  const enabled = !!uri || !!storeFactory;
  let store = null;
  let dbPath = null;
  let uploadsRoot = null;
  let getDb = null;
  let timer = null;
  let lastChanges = -1;
  let stopped = false;
  let busy = null;
  let usersTimer = null;
  const known = new Map();      // upload rel path -> size already stored in MongoDB
  const pendingRemoval = new Set();
  const inflight = new Map();   // rel -> Promise (dedupe on-demand downloads)

  const safeRel = (rel) => {
    if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
    const norm = path.posix.normalize(rel.replace(/\\/g, '/')).replace(/^\/+/, '');
    if (!norm || norm.startsWith('..') || norm.includes('/../')) return null;
    return norm;
  };

  async function connect() {
    if (store) return store;
    store = storeFactory ? await storeFactory() : await createMongoStore(uri);
    return store;
  }

  // --- boot: restore the database before SQLite opens it --------------------------------
  async function restoreDatabase(targetPath) {
    dbPath = targetPath;
    if (!enabled) return 'disabled';
    await connect(); // throws if MongoDB is unreachable -> server refuses to boot (by design)

    const haveLocal = fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0;
    let result = 'local';

    if (!haveLocal) {
      const count = await store.count(DB_FILE);
      result = 'empty';

      for (let i = 0; i < count && result !== 'restored'; i++) {
        const tmp = dbPath + '.restore';

        try {
          const rs = await store.get(DB_FILE, i);
          if (!rs) throw new Error('snapshot stream is missing');

          await pipeline(rs, zlib.createGunzip(), fs.createWriteStream(tmp));

          const { default: Database } = await import('better-sqlite3');
          let t;
          let ok;

          try {
            t = new Database(tmp, { readonly: true });
            ok = t.pragma('quick_check', { simple: true }) === 'ok';
          } finally {
            if (t?.open) t.close();
          }

          if (!ok) throw new Error('quick_check failed');

          for (const ext of ['-wal', '-shm']) {
            fs.rmSync(dbPath + ext, { force: true });
          }

          fs.renameSync(tmp, dbPath);
          result = 'restored';
          log(`database restored from MongoDB (snapshot #${i === 0 ? 'latest' : i + 1})`);
        } catch (err) {
          warn(`snapshot #${i + 1} unusable: ${err.message}`);

          try {
            fs.rmSync(tmp, { force: true });
          } catch (cleanupErr) {
            warn(`could not remove temporary restore file: ${cleanupErr.message}`);
          }
        }
      }

      if (count > 0 && result !== 'restored') {
        throw new Error(
          'MongoDB has saved snapshots but none could be restored. Refusing to start with an empty database.'
        );
      }

      if (result === 'empty') {
        log('no snapshot in MongoDB yet — starting a fresh database');
      }
    }

    await store.takeLease(INSTANCE);
    return result;
  }

  // --- snapshots ---------------------------------------------------------------------
  async function snapshotDatabase(force = false) {
    const db = getDb?.();
    if (!db || !dbPath) return false;

    const changes = db.prepare('SELECT total_changes() AS c').get().c;
    if (!force && changes === lastChanges) return false;

    const tmp = dbPath + '.snap';

    try {
      await db.backup(tmp);
      await store.put(
        DB_FILE,
        fs.createReadStream(tmp).pipe(zlib.createGzip()),
        { savedAt: new Date(), owner: INSTANCE }
      );
      await store.prune(DB_FILE, 2);
      lastChanges = changes;
      return true;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  // --- users collection (readable copy of the accounts) -------------------------------
  const userSigs = new Map(); // id -> signature already written to MongoDB
  let usersFirstRun = true;
  let usersDirty = false; // a MongoDB removal failed: sweep leftovers on the next cycle

  async function syncUsers() {
    const db = getDb?.();
    if (!db || !store) return;

    let rows;
    try {
      rows = db.prepare(
        'SELECT id, username, display_name AS name, account_status AS status, created_at AS createdAt FROM users'
      ).all();
    } catch {
      return;
    } // no users table / older schema: nothing to mirror

    const sig = (r) => `${r.username}\u0000${r.name}\u0000${r.status}`;
    const upserts = rows.filter((r) => userSigs.get(r.id) !== sig(r));
    const current = new Set(rows.map((r) => r.id));
    const gone = [...userSigs.keys()].filter((id) => !current.has(id));

    if (!upserts.length && !gone.length && !usersFirstRun && !usersDirty) return;

    // Orphans are only swept when at least one account exists locally, so an empty database can never wipe the list.
    await store.syncUsers(upserts, rows.length ? rows.map((r) => r.id) : null);

    for (const r of upserts) userSigs.set(r.id, sig(r));
    for (const id of gone) userSigs.delete(id);

    usersFirstRun = false;
    usersDirty = false;
  }

  // --- uploads -----------------------------------------------------------------------
  function walk(dir, base = '') {
    const out = [];
    let entries = [];

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }

    for (const e of entries) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push(...walk(path.join(dir, e.name), rel));
      } else if (e.isFile() && !e.name.endsWith('.tmp') && !e.name.startsWith('.')) {
        out.push(rel);
      }
    }

    return out;
  }

  async function syncUploads() {
    if (!uploadsRoot) return;

    for (const rel of [...pendingRemoval]) {
      await store.prune(UP + rel, 0);
      known.delete(rel);
      pendingRemoval.delete(rel);
    }

    for (const rel of walk(uploadsRoot)) {
      const full = path.join(uploadsRoot, rel);
      let st;

      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }

      if (Date.now() - st.mtimeMs < 4000) continue; // still being written
      if (known.get(rel) === st.size) continue;

      await store.put(UP + rel, fs.createReadStream(full), { size: st.size });
      await store.prune(UP + rel, 1);
      known.set(rel, st.size);
    }
  }

  async function runCycle(force = false) {
    if (!enabled || !store || stopped) return;
    if (busy) return busy;

    busy = (async () => {
      try {
        if (!(await store.checkLease(INSTANCE))) {
          stopped = true;
          warn('another instance took over — this one stops writing to MongoDB');
          return;
        }

        await snapshotDatabase(force);

        try {
          await syncUsers();
        } catch (err) {
          warn('users sync failed (will retry):', err.message);
        }

        await syncUploads();
      } catch (err) {
        warn('sync failed (will retry):', err.message);
      } finally {
        busy = null;
      }
    })();

    return busy;
  }

  // On-demand download of an upload that's missing locally (e.g. after a redeploy).
  async function ensureLocalUpload(relIn) {
    const rel = safeRel(relIn);
    if (!enabled || !store || !uploadsRoot || !rel) return false;

    const full = path.join(uploadsRoot, rel);
    if (!full.startsWith(uploadsRoot + path.sep)) return false;
    if (fs.existsSync(full)) return true;
    if (inflight.has(rel)) return inflight.get(rel);

    const p = (async () => {
      try {
        const rs = await store.get(UP + rel, 0);
        if (!rs) return false;

        fs.mkdirSync(path.dirname(full), { recursive: true });
        const tmp = full + '.tmp';
        await pipeline(rs, fs.createWriteStream(tmp));
        fs.renameSync(tmp, full);
        known.set(rel, fs.statSync(full).size);
        return true;
      } catch (err) {
        warn(`could not fetch upload ${rel}:`, err.message);
        return false;
      } finally {
        inflight.delete(rel);
      }
    })();

    inflight.set(rel, p);
    return p;
  }

  return {
    enabled,
    get instanceId() {
      return INSTANCE;
    },
    restoreDatabase,

    start({ getDb: g, uploadsRoot: root }) {
      if (!enabled) return;
      getDb = g;
      uploadsRoot = root;

      (async () => {
        try {
          for (const f of await store.list(UP)) {
            known.set(f.name.slice(UP.length), f.length);
          }
        } catch (err) {
          warn('could not list stored uploads:', err.message);
        }

        await runCycle(true); // make sure the first snapshot exists right away
        timer = setInterval(() => runCycle(), SYNC_MS);
        timer.unref?.();
        log(`sync on — saving to MongoDB every ${SYNC_MS / 1000}s when something changed`);
      })();
    },

    // A permanently deleted account disappears from the MongoDB `users` collection straight away
    // (the periodic sync would also catch it within a few seconds).
    async removeUser(userId) {
      if (!enabled || !store || stopped || !userId) return;
      userSigs.delete(userId);

      try {
        await store.removeUser(userId);
      } catch (err) {
        usersDirty = true;
        warn('could not remove user from MongoDB (periodic sync will retry):', err.message);
      }
    },

    // New / changed accounts show up in MongoDB within a second or two instead of waiting for the next cycle.
    syncUsersSoon() {
      if (!enabled || !store || stopped) return;
      clearTimeout(usersTimer);
      usersTimer = setTimeout(() => {
        syncUsers().catch((err) => warn('users sync failed:', err.message));
      }, 800);
      usersTimer.unref?.();
    },

    // Called from removeLocalUpload so deleted media is also dropped from MongoDB.
    queueRemoval(url) {
      if (!enabled || typeof url !== 'string' || !url.startsWith('/uploads/')) return;
      const rel = safeRel(url.slice('/uploads/'.length));
      if (rel) pendingRemoval.add(rel);
    },

    // Express middleware: put before express.static('/uploads').
    uploadsMiddleware() {
      return async (req, res, next) => {
        if (!enabled || (req.method !== 'GET' && req.method !== 'HEAD')) return next();

        try {
          await ensureLocalUpload(decodeURIComponent(req.path));
        } catch {
          /* fall through to 404 */
        }

        next();
      };
    },

    async flush() {
      if (!enabled || !store) return;
      if (timer) clearInterval(timer);

      try {
        if (busy) await busy;
        stopped = false;
        await runCycle(true);
      } catch (err) {
        warn('final flush failed:', err.message);
      }

      try {
        await store.close();
      } catch {
        /* ignore */
      }
    },

    ensureLocalUpload,
    _runCycle: runCycle,
    _setForTest(g, root) {
      getDb = g;
      uploadsRoot = root;
    }
  };
}

const persistence = createPersistence();
export default persistence;
