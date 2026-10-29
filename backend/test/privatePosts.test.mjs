// Private accounts: their posts/reels are hidden from everyone except the owner and people the owner follows.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-privposts-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });

const { default: db } = await import('../src/db.js');
const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { default: usersRouter } = await import('../src/routes/users.js');
const { default: postsRouter } = await import('../src/routes/posts.js');
const { default: feedRouter } = await import('../src/routes/feed.js');
const { default: searchRouter } = await import('../src/routes/search.js');
const { default: reelsRouter } = await import('../src/routes/reels.js');

const { ACCESS_SECRET } = await import('../src/middleware/auth.js');
const mk = (n) => { db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run(`id-${n}`, n, `${n}@x.com`, 'x', n); return `id-${n}`; };
const follow = (a, b) => db.prepare('INSERT INTO follows (follower_id, followed_id) VALUES (?,?)').run(a, b);
const owner = mk('owner'), friend = mk('friend'), fan = mk('fan'), stranger = mk('stranger');
follow(friend, owner); follow(fan, owner); follow(owner, friend); // owner follows friend only

db.prepare("INSERT INTO posts (id, user_id, caption) VALUES ('p1', ?, 'hello #secret')").run(owner);
db.prepare("INSERT INTO hashtags (id, tag) VALUES ('h1','secret')").run();
db.prepare("INSERT INTO post_hashtags (post_id, hashtag_id) VALUES ('p1','h1')").run();
db.prepare("INSERT INTO reels (id, user_id, video_url, caption) VALUES ('r1', ?, 'https://x.com/a.mp4', 'secret reel')").run(owner);

const app = express(); app.use(express.json());
app.use('/users', usersRouter); app.use('/posts', postsRouter); app.use('/feed', feedRouter);
app.use('/search', searchRouter); app.use('/reels', reelsRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const get = async (p, uid) => {
  const headers = uid ? { Authorization: `Bearer ${jwt.sign({ sub: uid }, ACCESS_SECRET)}` } : {};
  const r = await fetch(base + p, { headers }); return { status: r.status, body: await r.json().catch(() => ({})) };
};
test.after(() => server.close());

test('public account: everyone sees posts on the profile', async () => {
  for (const uid of [null, stranger, fan]) {
    const r = await get('/users/owner/posts', uid);
    assert.equal(r.status, 200); assert.equal(r.body.posts.length, 1);
  }
});

test('private account: profile posts, direct post, feed, hashtag and reels are hidden from outsiders', async () => {
  db.prepare('UPDATE users SET is_private = 1 WHERE id = ?').run(owner);
  for (const uid of [null, stranger, fan]) {
    assert.equal((await get('/users/owner/posts', uid)).status, 403);
    assert.equal((await get('/posts/p1', uid)).status, 404);
    assert.equal((await get('/reels/r1', uid)).status, 404);
  }
  assert.equal((await get('/search/hashtags/secret', stranger)).body.posts.length, 0);
  assert.equal((await get('/search?q=secret', stranger)).body.reels.length, 0);
  assert.equal((await get('/reels/feed', stranger)).body.reels.length, 0);
  assert.equal((await get('/feed/following', fan)).body.posts.length, 0);
  assert.equal((await get('/feed/foryou', stranger)).body.posts.length, 0);
});

test('private account: owner and people the owner follows still see everything', async () => {
  for (const uid of [owner, friend]) {
    assert.equal((await get('/users/owner/posts', uid)).body.posts.length, 1);
    assert.equal((await get('/posts/p1', uid)).status, 200);
    assert.equal((await get('/reels/r1', uid)).status, 200);
    assert.equal((await get('/search/hashtags/secret', uid)).body.posts.length, 1);
    assert.equal((await get('/reels/feed', uid)).body.reels.length, 1);
  }
  assert.equal((await get('/feed/following', friend)).body.posts.length, 1);
  assert.equal((await get('/users/owner', stranger)).body.user.canSeePosts, false);
});

test('switching back to public shows posts again', async () => {
  db.prepare('UPDATE users SET is_private = 0 WHERE id = ?').run(owner);
  assert.equal((await get('/users/owner/posts', stranger)).status, 200);
});
