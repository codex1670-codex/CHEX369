// Emoji reactions on posts: one per person, swappable/removable, grouped counts, visibility respected.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-postreact-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });

const { default: db } = await import('../src/db.js');
const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { default: postsRouter } = await import('../src/routes/posts.js');
const { ACCESS_SECRET } = await import('../src/middleware/auth.js');

const mk = (n) => { db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run(`id-${n}`, n, `${n}@x.com`, 'x', n); return `id-${n}`; };
const author = mk('author'), amy = mk('amy'), bob = mk('bob'), stranger = mk('stranger');
db.prepare("INSERT INTO posts (id, user_id, caption) VALUES ('p1', ?, 'hi')").run(author);
db.prepare("INSERT INTO posts (id, user_id, caption, audience) VALUES ('p2', ?, 'followers only', 'followers')").run(author);
db.prepare('INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)').run(amy, author);

const app = express(); app.use(express.json()); app.use('/posts', postsRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/posts`;
const call = async (method, p, uid, body) => {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = `Bearer ${jwt.sign({ sub: uid }, ACCESS_SECRET)}`;
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
test.after(() => server.close());

test('react, group counts, swap and remove', async () => {
  let r = await call('POST', '/p1/react', amy, { emoji: '🔥' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.post.reactions, [{ emoji: '🔥', count: 1, mine: true }]);
  await call('POST', '/p1/react', bob, { emoji: '🔥' });
  r = await call('GET', '/p1', stranger);
  assert.deepEqual(r.body.post.reactions, [{ emoji: '🔥', count: 2, mine: false }]);
  r = await call('POST', '/p1/react', amy, { emoji: '😂' });            // swap, still one reaction each
  const emojis = Object.fromEntries(r.body.post.reactions.map(g => [g.emoji, g.count]));
  assert.deepEqual(emojis, { '🔥': 1, '😂': 1 });
  r = await call('DELETE', '/p1/react', amy);
  assert.deepEqual(r.body.post.reactions.map(g => g.emoji), ['🔥']);
});

test('only real emoji are accepted, and login is required', async () => {
  assert.equal((await call('POST', '/p1/react', amy, { emoji: 'hello' })).status, 400);
  assert.equal((await call('POST', '/p1/react', amy, {})).status, 400);
  assert.equal((await call('POST', '/p1/react', null, { emoji: '🔥' })).status, 401);
});

test('reacting notifies the author once, never for your own post', async () => {
  const count = (actor) => db.prepare("SELECT COUNT(*) c FROM notifications WHERE recipient_id = ? AND actor_id = ? AND target_id = 'p1'").get(author, actor).c;
  await call('POST', '/p1/react', bob, { emoji: '❤️' });
  await call('POST', '/p1/react', bob, { emoji: '😍' });
  assert.equal(count(bob), 1);
  await call('POST', '/p1/react', author, { emoji: '👍' });
  assert.equal(count(author), 0);
});

test('you cannot react to a post you cannot see', async () => {
  assert.equal((await call('POST', '/p2/react', stranger, { emoji: '🔥' })).status, 404);
  assert.equal((await call('POST', '/p2/react', amy, { emoji: '🔥' })).status, 200); // follower
});
