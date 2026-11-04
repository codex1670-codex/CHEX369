// Regression: "Share note" returned 500 on a server whose database was created by an older version
// (restored from MongoDB on Render). The notes table there lacked UNIQUE(user_id), edited_at and the
// song columns, so the upsert / feed / edit crashed. This builds such a database BEFORE the app boots.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

const DB = path.join(os.tmpdir(), `nexa-notes-legacy-${process.pid}.db`);
for (const s of ['', '-wal', '-shm']) fs.rmSync(DB + s, { force: true });
process.env.NEXA_DB_PATH = DB;

{ // old-shaped database: users + an ancient notes/note_likes pair
  const schema = fs.readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf-8');
  const old = new Database(DB);
  old.exec(schema);
  old.exec(`DROP TABLE note_likes; DROP TABLE notes;
    CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', emoji TEXT, mood TEXT,
      audience TEXT NOT NULL DEFAULT 'followers', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), expires_at TEXT NOT NULL);
    CREATE TABLE note_likes (note_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (note_id, user_id));`);
  old.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run('id-me', 'me', 'me@x.com', 'x', 'me');
  // a duplicate-per-user row that the old table allowed
  old.prepare("INSERT INTO notes (id, user_id, text, expires_at) VALUES ('a','id-me','old one','2999-01-01T00:00:00Z')").run();
  old.prepare("INSERT INTO notes (id, user_id, text, expires_at) VALUES ('b','id-me','old two','2999-01-01T00:00:00Z')").run();
  old.close();
}

const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { default: notesRouter } = await import('../src/routes/notes.js');
const { ACCESS_SECRET } = await import('../src/middleware/auth.js');

const app = express();
app.use(express.json());
app.use('/notes', notesRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const auth = { Authorization: `Bearer ${jwt.sign({ sub: 'id-me' }, ACCESS_SECRET)}`, 'Content-Type': 'application/json' };
const call = (method, p, body) => fetch(base + p, { method, headers: auth, body: body ? JSON.stringify(body) : undefined });
test.after(() => server.close());

test('feed works on an old database', async () => {
  const r = await call('GET', '/notes/feed');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).notes.length, 1);          // duplicates were merged to one note per person
});
test('sharing a note works and replaces the previous one', async () => {
  const r = await call('POST', '/notes', { text: 'hello', audience: 'everyone' });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).note.text, 'hello');
  const again = await call('POST', '/notes', { text: 'second', emoji: '🎵' });
  assert.equal(again.status, 201);
  const feed = await (await call('GET', '/notes/feed')).json();
  assert.equal(feed.notes.length, 1);
  assert.equal(feed.notes[0].text, 'second');
});
test('replacing a note that already has likes works', async () => {
  const { default: db } = await import('../src/db.js');
  const cur = db.prepare('SELECT id FROM notes WHERE user_id = ?').get('id-me');
  db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run('id-fan', 'fan', 'f@x.com', 'x', 'fan');
  db.prepare('INSERT INTO note_likes (note_id, user_id) VALUES (?, ?)').run(cur.id, 'id-fan');
  const r = await call('POST', '/notes', { text: 'third' });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).note.likeCount, 0);
});
test('edit and delete work', async () => {
  const e = await call('PATCH', '/notes/mine', { text: 'edited' });
  assert.equal(e.status, 200);
  assert.ok((await e.json()).note.editedAt);
  assert.equal((await call('DELETE', '/notes/mine')).status, 200);
});
test('bad input is a clean 400, not a 500', async () => {
  assert.equal((await call('POST', '/notes', {})).status, 400);
  assert.equal((await call('POST', '/notes', { text: 'x', songId: 'nope' })).status, 400);
});
