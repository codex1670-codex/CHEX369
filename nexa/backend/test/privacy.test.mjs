// Followers/following visibility: public = everyone, private = owner + people the owner follows.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-privacy-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });

const { default: db } = await import('../src/db.js');
const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { default: usersRouter } = await import('../src/routes/users.js');

const mk = (name) => {
  db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)')
    .run(`id-${name}`, name, `${name}@x.com`, 'x', name);
  return `id-${name}`;
};
const follow = (a, b) => db.prepare('INSERT INTO follows (follower_id, followed_id) VALUES (?,?)').run(a, b);

const owner = mk('owner'), friend = mk('friend'), fan = mk('fan'), stranger = mk('stranger');
follow(friend, owner); follow(fan, owner);   // friend and fan follow owner
follow(owner, friend);                        // owner follows friend only

const app = express();
app.use(express.json());
app.use('/users', usersRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/users`;
const { ACCESS_SECRET } = await import('../src/middleware/auth.js');
const get = async (url, uid) => {
  const headers = {};
  if (uid) headers.Authorization = `Bearer ${jwt.sign({ sub: uid }, ACCESS_SECRET)}`;
  const r = await fetch(base + url, { headers });
  return { status: r.status, body: await r.json() };
};
test.after(() => server.close());

test('public account: anyone, even logged out, can see followers and following', async () => {
  for (const uid of [null, stranger, friend]) {
    const a = await get('/owner/followers', uid);
    assert.equal(a.status, 200); assert.equal(a.body.users.length, 2);
    const b = await get('/owner/following', uid);
    assert.equal(b.status, 200); assert.equal(b.body.users.length, 1);
  }
});

test('private account: only owner and people the owner follows get in', async () => {
  db.prepare('UPDATE users SET is_private = 1 WHERE id = ?').run(owner);
  assert.equal((await get('/owner/followers', null)).status, 403);
  assert.equal((await get('/owner/followers', stranger)).status, 403);
  assert.equal((await get('/owner/following', fan)).status, 403);  // fan follows owner, owner doesn't follow fan
  assert.equal((await get('/owner/followers', friend)).status, 200); // owner follows friend
  assert.equal((await get('/owner/following', friend)).status, 200);
  assert.equal((await get('/owner/followers', owner)).status, 200);  // the owner themself
  const p = await get('/owner', stranger);
  assert.equal(p.body.user.isPrivate, true);
  assert.equal(p.body.user.canSeeConnections, false);
});

test('switching back to public reopens the lists', async () => {
  db.prepare('UPDATE users SET is_private = 0 WHERE id = ?').run(owner);
  assert.equal((await get('/owner/followers', stranger)).status, 200);
});
