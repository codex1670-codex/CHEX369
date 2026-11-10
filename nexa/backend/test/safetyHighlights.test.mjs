// Blocked / muted / restricted lists, profile relationship flags, story highlights and archive.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-safety-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });

const { default: db } = await import('../src/db.js');
const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { default: usersRouter } = await import('../src/routes/users.js');
const { default: storiesRouter } = await import('../src/routes/stories.js');
const { default: highlightsRouter } = await import('../src/routes/highlights.js');
const { ACCESS_SECRET } = await import('../src/middleware/auth.js');

const mk = (name) => {
  db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)')
    .run(`id-${name}`, name, `${name}@x.com`, 'x', name);
  return `id-${name}`;
};
const follow = (a, b) => db.prepare('INSERT INTO follows (follower_id, followed_id) VALUES (?,?)').run(a, b);
const past = new Date(Date.now() - 48 * 3600e3).toISOString();
const future = new Date(Date.now() + 3600e3).toISOString();
let n = 0;
const story = (uid, { audience = 'everyone', expires = past, text = 'hi' } = {}) => {
  const id = `s${++n}`;
  db.prepare("INSERT INTO stories (id, user_id, media_type, content, audience, created_at, expires_at) VALUES (?,?,'text',?,?,?,?)")
    .run(id, uid, text, audience, new Date(Date.now() - (100 - n) * 1000).toISOString(), expires);
  return id;
};

const me = mk('me'), amy = mk('amy'), bob = mk('bob'), cat = mk('cat'), dan = mk('dan');

const app = express();
app.use(express.json());
app.use('/users', usersRouter);
app.use('/stories', storiesRouter);
app.use('/highlights', highlightsRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, url, uid, body) => {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = `Bearer ${jwt.sign({ sub: uid }, ACCESS_SECRET)}`;
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
test.after(() => server.close());

test('blocked / muted / restricted lists show only my own entries and update live', async () => {
  for (const kind of ['blocked', 'muted', 'restricted']) assert.deepEqual((await call('GET', `/users/me/${kind}`, me)).body.users, []);
  await call('POST', '/users/amy/block', me);
  await call('POST', '/users/bob/mute', me);
  await call('POST', '/users/cat/restrict', me);
  await call('POST', '/users/me/block', dan); // someone else's list must never leak into mine
  const b = (await call('GET', '/users/me/blocked', me)).body.users;
  const m = (await call('GET', '/users/me/muted', me)).body.users;
  const r = (await call('GET', '/users/me/restricted', me)).body.users;
  assert.deepEqual(b.map(u => u.username), ['amy']);
  assert.deepEqual(m.map(u => u.username), ['bob']);
  assert.deepEqual(r.map(u => u.username), ['cat']);
  assert.ok(b[0].since && b[0].displayName === 'amy' && b[0].id === amy);
  // amy can not see that she is blocked in any list of hers
  for (const kind of ['blocked', 'muted', 'restricted']) assert.deepEqual((await call('GET', `/users/me/${kind}`, amy)).body.users, []);
  // undo from the lists
  await call('DELETE', '/users/amy/block', me); await call('DELETE', '/users/bob/mute', me); await call('DELETE', '/users/cat/restrict', me);
  for (const kind of ['blocked', 'muted', 'restricted']) assert.deepEqual((await call('GET', `/users/me/${kind}`, me)).body.users, []);
  assert.equal((await call('GET', '/users/me/blocked')).status, 401);
});

test('profile reports the viewer\'s own mute / restrict state, and a blocked profile is hidden', async () => {
  let p = (await call('GET', '/users/bob', me)).body.user;
  assert.equal(p.isMuted, false); assert.equal(p.isRestricted, false);
  await call('POST', '/users/bob/mute', me); await call('POST', '/users/bob/restrict', me);
  p = (await call('GET', '/users/bob', me)).body.user;
  assert.equal(p.isMuted, true); assert.equal(p.isRestricted, true);
  // bob looking at me sees nothing about what I did
  const mine = (await call('GET', '/users/me', bob)).body.user;
  assert.equal(mine.isMuted, false); assert.equal(mine.isRestricted, false);
  await call('POST', '/users/amy/block', me);
  assert.equal((await call('GET', '/users/amy', me)).status, 404);
  await call('DELETE', '/users/amy/block', me); await call('DELETE', '/users/bob/mute', me); await call('DELETE', '/users/bob/restrict', me);
});

test('muting someone hides their stories from my tray', async () => {
  story(bob, { expires: future }); follow(me, bob);
  assert.equal((await call('GET', '/stories/feed', me)).body.groups.length, 1);
  await call('POST', '/users/bob/mute', me);
  assert.equal((await call('GET', '/stories/feed', me)).body.groups.length, 0);
  await call('DELETE', '/users/bob/mute', me);
});

test('archive lists my expired stories; highlights keep them after the 24h are up', async () => {
  const s1 = story(me), s2 = story(me), live = story(me, { expires: future });
  story(amy); // not mine
  const archive = (await call('GET', '/highlights/archive', me)).body.stories;
  assert.deepEqual(archive.map(s => s.id).sort(), [live, s1, s2].sort());
  assert.equal(archive.find(s => s.id === live).expired, false);
  assert.equal(archive.find(s => s.id === s1).expired, true);

  assert.equal((await call('POST', '/highlights', me, { title: 'x', storyIds: [] })).status, 400);
  assert.equal((await call('POST', '/highlights', me, { title: 'x', storyIds: ['nope'] })).status, 400);
  const created = await call('POST', '/highlights', me, { title: '  Trip   2026  ', storyIds: [s1, s2] });
  assert.equal(created.status, 201);
  assert.equal(created.body.highlight.title, 'Trip 2026');
  assert.equal(created.body.highlight.storyCount, 2);
  assert.equal(created.body.highlight.cover.storyId, s1);
  assert.equal((await call('GET', '/highlights/archive', me)).body.stories.find(s => s.id === s1).highlightCount, 1);

  // a stranger can see the highlight even though both stories expired long ago
  const hid = created.body.highlight.id;
  const view = await call('GET', `/highlights/${hid}`, amy);
  assert.equal(view.status, 200);
  assert.deepEqual(view.body.stories.map(s => s.id), [s1, s2]);
  assert.equal(view.body.author.username, 'me');
  assert.equal(view.body.highlight.isMine, false);
  assert.deepEqual((await call('GET', '/highlights/user/me', amy)).body.highlights.map(h => h.id), [hid]);
});

test('cannot put someone else\'s story in my highlight; only the owner may change or delete it', async () => {
  const theirs = story(amy);
  const mine = story(me);
  const res = await call('POST', '/highlights', me, { title: 'Sneaky', storyIds: [theirs, mine] });
  assert.equal(res.body.highlight.storyCount, 1); // theirs silently dropped
  const hid = res.body.highlight.id;
  assert.equal((await call('POST', '/highlights', me, { title: 'Only theirs', storyIds: [theirs] })).status, 400);
  assert.equal((await call('PATCH', `/highlights/${hid}`, amy, { title: 'Hacked' })).status, 403);
  assert.equal((await call('DELETE', `/highlights/${hid}`, amy)).status, 403);
  assert.equal((await call('PATCH', `/highlights/${hid}`, me, { addStoryIds: [theirs] })).body.highlight.storyCount, 1);
  assert.equal((await call('PATCH', `/highlights/${hid}`, me, { title: '   ' })).status, 400);
  assert.equal((await call('DELETE', `/highlights/${hid}`, me)).status, 200);
  assert.equal((await call('GET', `/highlights/${hid}`, me)).status, 404);
  assert.ok(db.prepare('SELECT 1 FROM stories WHERE id = ?').get(mine)); // the story itself survives
});

test('edit a highlight: rename, add, remove, cover — and it can never end up empty', async () => {
  const a = story(me), b = story(me), c = story(me);
  const hid = (await call('POST', '/highlights', me, { title: 'Edit me', storyIds: [a] })).body.highlight.id;
  let h = (await call('PATCH', `/highlights/${hid}`, me, { title: 'Renamed', addStoryIds: [b, c] })).body.highlight;
  assert.equal(h.title, 'Renamed'); assert.equal(h.storyCount, 3);
  h = (await call('PATCH', `/highlights/${hid}`, me, { coverStoryId: c })).body.highlight;
  assert.equal(h.cover.storyId, c);
  assert.equal((await call('PATCH', `/highlights/${hid}`, me, { coverStoryId: 'zzz' })).status, 400);
  h = (await call('PATCH', `/highlights/${hid}`, me, { removeStoryIds: [c] })).body.highlight; // cover removed -> falls back
  assert.equal(h.storyCount, 2); assert.notEqual(h.cover.storyId, c);
  assert.equal((await call('PATCH', `/highlights/${hid}`, me, { removeStoryIds: [a, b] })).status, 400);
  assert.equal((await call('GET', `/highlights/${hid}`, me)).body.stories.length, 2);
});

test('deleting a story removes it from its highlights', async () => {
  const a = story(me), b = story(me);
  const hid = (await call('POST', '/highlights', me, { title: 'Del', storyIds: [a, b] })).body.highlight.id;
  await call('DELETE', `/stories/${a}`, me);
  assert.deepEqual((await call('GET', `/highlights/${hid}`, me)).body.stories.map(s => s.id), [b]);
  assert.ok(!(await call('GET', '/highlights/archive', me)).body.stories.some(s => s.id === a));
});

test('highlight visibility: story audience, blocks and private accounts are respected', async () => {
  const pub = story(dan), friendsOnly = story(dan, { audience: 'close_friends' }), followersOnly = story(dan, { audience: 'followers' });
  const hid = (await call('POST', '/highlights', dan, { title: 'Mixed', storyIds: [pub, friendsOnly, followersOnly] })).body.highlight.id;
  const ids = async (uid) => (await call('GET', `/highlights/${hid}`, uid)).body.stories?.map(s => s.id);
  assert.deepEqual(await ids(dan), [pub, friendsOnly, followersOnly]);
  assert.deepEqual(await ids(cat), [pub]);                       // stranger: public only
  follow(cat, dan);
  assert.deepEqual(await ids(cat), [pub, followersOnly]);        // follower
  db.prepare('INSERT INTO close_friends (owner_id, friend_id) VALUES (?,?)').run(dan, cat);
  assert.deepEqual(await ids(cat), [pub, friendsOnly, followersOnly]); // close friend
  // blocked in either direction -> gone
  await call('POST', '/users/cat/block', dan);
  assert.equal((await call('GET', `/highlights/${hid}`, cat)).status, 404);
  assert.deepEqual((await call('GET', '/highlights/user/dan', cat)).body.highlights, []);
  await call('DELETE', '/users/cat/block', dan);
  follow(cat, dan); // blocking removed the follow, so follow again
  // private account: only followers (cat follows dan, bob does not)
  db.prepare('UPDATE users SET is_private = 1 WHERE id = ?').run(dan);
  assert.equal((await call('GET', `/highlights/${hid}`, bob)).status, 404);
  assert.equal((await call('GET', `/highlights/${hid}`, cat)).status, 200);
  // a highlight whose stories are all hidden from the viewer is not listed to them at all
  db.prepare('UPDATE users SET is_private = 0 WHERE id = ?').run(dan);
  const hid2 = (await call('POST', '/highlights', dan, { title: 'Secret', storyIds: [friendsOnly] })).body.highlight.id;
  assert.ok(!(await call('GET', '/highlights/user/dan', bob)).body.highlights.some(h => h.id === hid2));
  assert.equal((await call('GET', `/highlights/${hid2}`, bob)).status, 404);
  assert.ok((await call('GET', '/highlights/user/dan', dan)).body.highlights.some(h => h.id === hid2));
});

test('highlight endpoints require sign-in', async () => {
  assert.equal((await call('GET', '/highlights/archive')).status, 401);
  assert.equal((await call('GET', '/highlights/user/me')).status, 401);
  assert.equal((await call('POST', '/highlights', null, { storyIds: ['x'] })).status, 401);
});
