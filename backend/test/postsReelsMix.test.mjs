// Posts and reels share their feeds: video posts play in the Reels page, reels appear in the post feeds.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-mix-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });
process.env.PORT = '0';

const { default: db } = await import('../src/db.js');
const { default: reelsRouter } = await import('../src/routes/reels.js');
const { default: feedRouter } = await import('../src/routes/feed.js');
const bcrypt = (await import('bcryptjs')).default;

const mk = (name) => {
  const id = `id-${name}`;
  db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)')
    .run(id, name, `${name}@x.com`, bcrypt.hashSync('pw123456', 4), name);
  return id;
};
const author = mk('author'), fan = mk('fan'), stranger = mk('stranger');
db.prepare('INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)').run(fan, author);

const ins = (sql, ...a) => db.prepare(sql).run(...a);
ins("INSERT INTO posts (id, user_id, caption, image_url, media_type, audience, created_at) VALUES ('vid-pub', ?, 'v', '/uploads/a.mp4', 'video', 'public', '2026-01-03T00:00:00.000Z')", author);
ins("INSERT INTO posts (id, user_id, caption, image_url, media_type, audience, created_at) VALUES ('vid-fol', ?, 'v', '/uploads/b.mp4', 'video', 'followers', '2026-01-04T00:00:00.000Z')", author);
ins("INSERT INTO posts (id, user_id, caption, image_url, media_type, audience, created_at) VALUES ('img', ?, 'i', '/uploads/c.jpg', 'image', 'public', '2026-01-05T00:00:00.000Z')", author);
ins("INSERT INTO posts (id, user_id, caption, created_at) VALUES ('text', ?, 't', '2026-01-06T00:00:00.000Z')", author);
ins("INSERT INTO reels (id, user_id, video_url, caption, created_at) VALUES ('reel1', ?, '/uploads/r.mp4', 'r', '2026-01-02T00:00:00.000Z')", author);

// Call the real route handler for GET `path` as `viewer`.
const call = (router, urlPath, viewer) => new Promise((resolve, reject) => {
  const layer = router.stack.find(l => l.route?.path === urlPath && l.route.methods.get);
  const req = { query: {}, params: {}, userId: viewer, app: { get: () => null }, headers: {} };
  const res = { json: resolve, status() { return this; } };
  const handlers = layer.route.stack.map(s => s.handle).filter(h => h.length < 4);
  // Skip auth middleware (first handler) — we set userId directly.
  const run = (i) => { try { handlers[i](req, res, () => run(i + 1)); } catch (e) { reject(e); } };
  run(handlers.length > 1 ? 1 : 0);
});

test('Reels page shows reels AND public video posts (not photos / text posts)', async () => {
  const out = await call(reelsRouter, '/feed', stranger);
  const got = out.reels.map(r => `${r.kind}:${r.id}`).sort();
  assert.deepEqual(got, ['post:vid-pub', 'reel:reel1']);
  const vp = out.reels.find(r => r.id === 'vid-pub');
  assert.equal(vp.videoUrl, '/uploads/a.mp4');
  assert.ok(vp.author && 'likeCount' in vp && 'likedByMe' in vp);
});

test('followers-only video post reaches the Reels page only for followers', async () => {
  const ids = async (v) => (await call(reelsRouter, '/feed', v)).reels.map(r => r.id);
  assert.ok(!(await ids(stranger)).includes('vid-fol'));
  assert.ok((await ids(fan)).includes('vid-fol'));
});

test('Post feed (following) shows posts and reels together, newest first', async () => {
  const out = await call(feedRouter, '/following', fan);
  assert.deepEqual(out.posts.map(p => `${p.kind}:${p.id}`), ['post:text', 'post:img', 'post:vid-fol', 'post:vid-pub', 'reel:reel1']);
});

test('Post feed (for you) also carries reels', async () => {
  const out = await call(feedRouter, '/foryou', stranger);
  assert.ok(out.posts.some(p => p.kind === 'reel' && p.id === 'reel1'));
  assert.ok(out.posts.some(p => p.kind === 'post' && p.id === 'text'));
});

test('a blocked author’s reels disappear from the post feed', async () => {
  ins('INSERT INTO blocks (blocker_id, blocked_id) VALUES (?, ?)', fan, author);
  const out = await call(feedRouter, '/following', fan);
  assert.equal(out.posts.length, 0);
  ins('DELETE FROM blocks WHERE blocker_id = ?', fan);
});
