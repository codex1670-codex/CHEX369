// Persistence layer: snapshot -> wipe local disk -> restore, upload sync, lease, refusal to boot empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import { createPersistence, createMemoryStore } from '../src/persistence.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chex-p-'));
const mkDb = (file) => { const d = new Database(file); d.pragma('journal_mode = WAL'); d.exec('CREATE TABLE IF NOT EXISTS users (name TEXT)'); return d; };

test('accounts survive a wiped disk (the Render restart case)', async () => {
  const store = createMemoryStore();
  const dir1 = tmp(); const dbPath1 = path.join(dir1, 'nexa.db'); const up1 = path.join(dir1, 'uploads');
  fs.mkdirSync(path.join(up1, 'reels'), { recursive: true });

  const p1 = createPersistence({ storeFactory: async () => store });
  assert.equal(await p1.restoreDatabase(dbPath1), 'empty');
  const db1 = mkDb(dbPath1);
  db1.prepare('INSERT INTO users VALUES (?)').run('yesterday-user');
  const vid = path.join(up1, 'reels', 'a.mp4'); fs.writeFileSync(vid, 'video-bytes');
  fs.utimesSync(vid, new Date(Date.now() - 10000), new Date(Date.now() - 10000));
  p1._setForTest(() => db1, up1);
  await p1._runCycle(true);
  db1.close();

  // brand-new container: empty disk
  const dir2 = tmp(); const dbPath2 = path.join(dir2, 'nexa.db'); const up2 = path.join(dir2, 'uploads');
  fs.mkdirSync(up2, { recursive: true });
  const p2 = createPersistence({ storeFactory: async () => store });
  assert.equal(await p2.restoreDatabase(dbPath2), 'restored');
  const db2 = new Database(dbPath2);
  assert.equal(db2.prepare('SELECT name FROM users').get().name, 'yesterday-user');
  db2.close();

  p2._setForTest(() => null, up2);
  assert.equal(await p2.ensureLocalUpload('reels/a.mp4'), true);
  assert.equal(fs.readFileSync(path.join(up2, 'reels', 'a.mp4'), 'utf8'), 'video-bytes');
  assert.equal(await p2.ensureLocalUpload('../../etc/passwd'), false);
});

test('refuses to start empty when snapshots exist but are unreadable', async () => {
  const store = createMemoryStore();
  await store.put('nexa.db.gz', (await import('node:stream')).Readable.from([zlib.gzipSync(Buffer.from('not a database'))]));
  const p = createPersistence({ storeFactory: async () => store });
  await assert.rejects(() => p.restoreDatabase(path.join(tmp(), 'nexa.db')), /Refusing to start/);
});

test('an old instance stops writing once a newer one owns the lease', async () => {
  const store = createMemoryStore();
  const dir = tmp(); const dbPath = path.join(dir, 'nexa.db');
  const oldP = createPersistence({ storeFactory: async () => store });
  await oldP.restoreDatabase(dbPath);
  const db = mkDb(dbPath);
  oldP._setForTest(() => db, path.join(dir, 'uploads'));
  await store.takeLease('someone-newer');
  await oldP._runCycle(true);
  assert.equal(await store.count('nexa.db.gz'), 0);
  db.close();
});

test('only the 2 newest snapshots are kept', async () => {
  const store = createMemoryStore();
  const dir = tmp(); const dbPath = path.join(dir, 'nexa.db');
  const p = createPersistence({ storeFactory: async () => store });
  await p.restoreDatabase(dbPath);
  const db = mkDb(dbPath); p._setForTest(() => db, path.join(dir, 'uploads'));
  for (let i = 0; i < 4; i++) { db.prepare('INSERT INTO users VALUES (?)').run('u' + i); await p._runCycle(true); }
  assert.equal(await store.count('nexa.db.gz'), 2);
  db.close();
});

test('disabled without MONGODB_URI: nothing happens', async () => {
  const p = createPersistence({ uri: '' });
  assert.equal(p.enabled, false);
  assert.equal(await p.restoreDatabase('/nonexistent/x.db'), 'disabled');
});

test('MongoDB `users` collection mirrors accounts and drops deleted ones', async () => {
  const store = createMemoryStore();
  const dir = tmp(); const dbPath = path.join(dir, 'nexa.db');
  const p = createPersistence({ storeFactory: async () => store });
  await p.restoreDatabase(dbPath);
  const db = new Database(dbPath);
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, display_name TEXT, account_status TEXT DEFAULT 'active', created_at TEXT DEFAULT 'now')");
  db.prepare('INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)').run('u1', 'priya', 'Priya K');
  db.prepare('INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)').run('u2', 'rahul', 'Rahul');
  p._setForTest(() => db, path.join(dir, 'uploads'));

  await p._runCycle(true);
  assert.deepEqual([...store.users.values()].map(u => [u.username, u.name]).sort(), [['priya', 'Priya K'], ['rahul', 'Rahul']]);
  assert.ok(![...store.users.values()].some(u => 'password_hash' in u || 'email' in u));

  // rename -> updated
  db.prepare("UPDATE users SET display_name = 'Priya Kumar' WHERE id = 'u1'").run();
  await p._runCycle(true);
  assert.equal(store.users.get('u1').name, 'Priya Kumar');

  // account deleted -> removed from MongoDB immediately (hook) ...
  db.prepare("DELETE FROM users WHERE id = 'u2'").run();
  await p.removeUser('u2');
  assert.equal(store.users.has('u2'), false);

  // ... and if MongoDB was unreachable at that moment, the next periodic sync cleans it up
  db.prepare("DELETE FROM users WHERE id = 'u1'").run();
  db.prepare("INSERT INTO users (id, username, display_name) VALUES ('u3', 'meera', 'Meera')").run();
  const realRemove = store.removeUser;
  store.removeUser = async () => { throw new Error('Atlas unreachable'); };
  await p.removeUser('u1');
  store.removeUser = realRemove;
  assert.equal(store.users.has('u1'), true); // still there after the failed removal
  await p._runCycle(true);
  assert.equal(store.users.has('u1'), false);
  assert.equal(store.users.has('u3'), true);
  db.close();
});
