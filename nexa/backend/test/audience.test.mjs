// Post audience (public / followers) and online presence.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-audience-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });
process.env.PORT = '0';

const { default: db } = await import('../src/db.js');
const { canViewPost, VISIBLE_SQL, visibleParams } = await import('../src/routes/posts.js');
const presence = await import('../src/presence.js');
const bcrypt = (await import('bcryptjs')).default;

const mk = (name) => {
  const id = `id-${name}`;
  db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)')
    .run(id, name, `${name}@x.com`, bcrypt.hashSync('pw123456', 4), name);
  return id;
};
const author = mk('author'), fan = mk('fan'), stranger = mk('stranger');
db.prepare("INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)").run(fan, author);
db.prepare("INSERT INTO posts (id, user_id, caption, audience) VALUES ('pub', ?, 'hi all', 'public')").run(author);
db.prepare("INSERT INTO posts (id, user_id, caption, audience) VALUES ('fol', ?, 'followers only', 'followers')").run(author);
db.prepare("INSERT INTO posts (id, user_id, caption) VALUES ('old', ?, 'made before audiences existed')").run(author);

test('posts default to public (old posts stay visible)', () => {
  assert.equal(db.prepare("SELECT audience a FROM posts WHERE id='old'").get().a, 'public');
});

test('followers-only post: visible to author and followers, hidden from everyone else', () => {
  const row = db.prepare("SELECT * FROM posts WHERE id='fol'").get();
  assert.equal(canViewPost(row, author), true);
  assert.equal(canViewPost(row, fan), true);
  assert.equal(canViewPost(row, stranger), false);
  assert.equal(canViewPost(row, undefined), false);
  assert.equal(canViewPost(db.prepare("SELECT * FROM posts WHERE id='pub'").get(), stranger), true);
});

test('SQL filter used by For You / hashtags matches canViewPost', () => {
  const ids = (viewer) => db.prepare(`SELECT p.id FROM posts p WHERE ${VISIBLE_SQL} ORDER BY p.id`).all(...visibleParams(viewer)).map(r => r.id);
  assert.deepEqual(ids(stranger), ['old', 'pub']);
  assert.deepEqual(ids(fan), ['fol', 'old', 'pub']);
  assert.deepEqual(ids(author), ['fol', 'old', 'pub']);
});

test('the database rejects an unknown audience', () => {
  assert.throws(() => db.prepare("INSERT INTO posts (id, user_id, caption, audience) VALUES ('bad', ?, 'x', 'secret')").run(author));
});

test('presence: online while any socket is open; hidden when the user opts out', () => {
  assert.equal(presence.markConnected(author), true);   // first socket
  assert.equal(presence.markConnected(author), false);  // second device
  assert.equal(presence.isOnline(author), true);
  assert.deepEqual(presence.onlineIdsFor(fan), [author]);
  assert.equal(presence.markDisconnected(author), false); // one device left
  assert.equal(presence.isOnline(author), true);
  db.prepare('UPDATE users SET show_online = 0 WHERE id = ?').run(author);
  assert.equal(presence.isOnline(author), false);
  assert.deepEqual(presence.onlineIdsFor(fan), []);
  db.prepare('UPDATE users SET show_online = 1 WHERE id = ?').run(author);
  assert.equal(presence.markDisconnected(author), true);  // last socket closed
  assert.equal(presence.isOnline(author), false);
});

test('presence never reveals people you blocked (or who blocked you)', () => {
  presence.markConnected(stranger);
  assert.deepEqual(presence.onlineIdsFor(fan), [stranger]);
  db.prepare('INSERT INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').run(fan, stranger);
  assert.deepEqual(presence.onlineIdsFor(fan), []);
  presence.markDisconnected(stranger);
});
