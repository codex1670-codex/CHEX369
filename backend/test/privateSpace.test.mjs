// Second space: a password-protected second profile. Posts/reels/users are shared with the normal app;
// Messages and Profile stay separate; chats can be moved into it; no games / learn / sticky notes there.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-private-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });

const { default: db } = await import('../src/db.js');
const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { default: privateRouter } = await import('../src/routes/private.js');
const { default: usersRouter } = await import('../src/routes/users.js');
const { default: searchRouter } = await import('../src/routes/search.js');
const { default: messagesRouter } = await import('../src/routes/messages.js');
const { ACCESS_SECRET } = await import('../src/middleware/auth.js');
const { blockShadow } = await import('../src/space.js');

const mk = (n) => { db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run(`id-${n}`, n, `${n}@x.com`, 'x', n); return `id-${n}`; };
const ann = mk('ann'), ben = mk('ben'), cat = mk('cat');
const id = (n) => `id-${n}`;

const app = express(); app.use(express.json());
app.set('io', { to: () => ({ emit: () => {} }) });
app.use(['/games', '/stickies'], blockShadow, (_req, res) => res.json({ ok: true }));
app.use('/private', privateRouter); app.use('/users', usersRouter); app.use('/search', searchRouter); app.use('/messages', messagesRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, url, token, body) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const tok = (uid) => jwt.sign({ sub: uid }, ACCESS_SECRET);
test.after(() => server.close());

let annShadow, annPriv, benShadow, benPriv;
test('set up: needs a real password and username; creates a hidden identity', async () => {
  assert.equal((await call('POST', '/private/setup', tok(ann), { password: '123', username: 'ann.secret' })).status, 400);
  assert.equal((await call('POST', '/private/setup', tok(ann), { password: 'secret1', username: 'ben' })).status, 409);
  const r = await call('POST', '/private/setup', tok(ann), { password: 'secret1', username: 'ann.secret', displayName: 'Ann S' });
  assert.equal(r.status, 201); annShadow = r.body.user.id; annPriv = r.body.token;
  const b = await call('POST', '/private/setup', tok(ben), { password: 'secret2', username: 'ben.secret' });
  benShadow = b.body.user.id; benPriv = b.body.token;
  assert.equal((await call('GET', '/private/status', tok(ann))).body.exists, true);
  assert.equal((await call('GET', '/private/status', tok(cat))).body.exists, false);
});

test('password: wrong is refused, right opens, 5 misses lock it', async () => {
  assert.equal((await call('POST', '/private/enter', tok(cat), { password: 'x' })).status, 404);
  assert.equal((await call('POST', '/private/enter', tok(ann), { password: 'nope' })).status, 401);
  assert.equal((await call('POST', '/private/enter', tok(ann), { password: 'secret1' })).status, 200);
  for (let i = 0; i < 5; i++) await call('POST', '/private/enter', tok(ben), { password: 'bad' });
  assert.equal((await call('POST', '/private/enter', tok(ben), { password: 'secret2' })).status, 429);
});

test('users are shared: profiles, search and follows work across both spaces, each profile keeps its own followers', async () => {
  assert.equal((await call('GET', '/users/ann.secret', tok(ben))).status, 200);
  assert.ok((await call('GET', '/search?q=secret', tok(ben))).body.users.some(u => u.username === 'ann.secret'));
  assert.equal((await call('GET', '/users/ben', annPriv)).status, 200);
  assert.ok((await call('GET', '/search?q=ben', annPriv)).body.users.some(u => u.username === 'ben'));
  assert.equal((await call('POST', '/users/ben/follow', annPriv)).status, 200);
  assert.equal((await call('GET', '/users/ben', tok(cat))).body.user.followerCount, 1);   // the shadow profile follows ben
  assert.equal((await call('GET', '/users/ann', tok(cat))).body.user.followerCount, 0);   // ann's normal profile is untouched
});

test('messaging works between the second space and normal users, and stays out of the normal inbox', async () => {
  const m = await call('POST', '/messages/send', annPriv, { toUsername: 'ben', text: 'hello from the second space' });
  assert.ok(m.status < 300, JSON.stringify(m));
  assert.ok(JSON.stringify((await call('GET', '/messages/requests', tok(ben))).body).includes('hello from the second space'));
  const n = await call('POST', '/messages/send', tok(ben), { toUsername: 'ann.secret', text: 'normal to second space' });
  assert.ok(n.status < 300, JSON.stringify(n));
  // ann's NORMAL inbox never contains the second space's conversations
  assert.equal(JSON.stringify((await call('GET', '/messages/conversations', tok(ann))).body).includes('hello from the second space'), false);
});

test('move a chat to the second space: gone from normal Messages, shown there with the same username and a different display name', async () => {
  db.prepare("INSERT INTO conversations (id, type, direct_key) VALUES ('c-ab', 'direct', ?)").run([ann, ben].sort().join(':'));
  db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)').run('c-ab', ann, 'c-ab', ben);
  db.prepare("INSERT INTO messages (id, conversation_id, sender_id, content) VALUES ('m-1', 'c-ab', ?, 'hi ann from ben')").run(ben);
  const ids = async (t) => (await call('GET', '/messages/conversations', t)).body.conversations.map(c => c.id);
  assert.ok((await ids(tok(ann))).includes('c-ab'));

  assert.equal((await call('POST', '/private/chat/move', tok(cat), { conversationId: 'c-ab', displayName: 'x' })).status, 409);       // no second space yet
  assert.equal((await call('POST', '/private/chat/move', tok(ann), { conversationId: 'c-ab', displayName: '  ' })).status, 400);       // needs a name
  assert.equal((await call('POST', '/private/chat/move', tok(ann), { conversationId: 'c-ab', displayName: 'BEN' })).status, 400);      // must differ from the real display name
  assert.equal((await call('POST', '/private/chat/move', annPriv, { conversationId: 'c-ab', displayName: 'Bestie' })).status, 403);    // moved from the normal side only
  assert.equal((await call('POST', '/private/chat/move', tok(ann), { conversationId: 'c-ab', displayName: 'Bestie' })).status, 200);

  assert.equal((await ids(tok(ann))).includes('c-ab'), false);                  // removed from the normal list
  const list = (await call('GET', '/messages/conversations', annPriv)).body.conversations;
  const moved = list.find(c => c.id === 'c-ab');
  assert.ok(moved, 'shows in the second space');
  assert.equal(moved.inSpace, true);
  const contact = moved.participants.find(p => p.id === id('ben'));
  assert.equal(contact.username, 'ben');                                        // same username
  assert.equal(contact.displayName, 'Bestie');                                  // different display name
  assert.ok(moved.participants.some(p => p.id === annShadow && p.username === 'ann.secret'));   // I am the second-space profile
  assert.equal(moved.participants.some(p => p.id === ann), false);              // the normal profile never appears

  // read + write the moved chat from the second space
  const msgs = await call('GET', '/messages/conversations/c-ab/messages', annPriv);
  assert.equal(msgs.body.messages[0].content, 'hi ann from ben');
  const sent = await call('POST', '/messages/send', annPriv, { conversationId: 'c-ab', text: 'secret reply' });
  assert.equal(sent.status, 201, JSON.stringify(sent));
  assert.equal(sent.body.message.senderId, annShadow);
  const bensView = (await call('GET', '/messages/conversations', tok(ben))).body.conversations.find(c => c.id === 'c-ab');
  assert.equal(bensView.lastMessage.content, 'secret reply');
  // writing to them by username from the second space uses the same moved chat
  assert.equal((await call('POST', '/messages/send', annPriv, { toUsername: 'ben', text: 'again' })).body.message.conversationId, 'c-ab');
  // the normal app cannot write into a moved chat
  assert.equal((await call('POST', '/messages/send', tok(ann), { toUsername: 'ben', text: 'normal' })).status, 409);
  // Ben's reply is not announced to ann's normal notifications
  const before = db.prepare("SELECT COUNT(*) c FROM notifications WHERE recipient_id = ? AND type = 'message'").get(ann).c;
  await call('POST', '/messages/send', tok(ben), { conversationId: 'c-ab', text: 'reply from ben' });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE recipient_id = ? AND type = 'message'").get(ann).c, before);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM notifications WHERE recipient_id = ? AND type = 'message'").get(annShadow).c > 0);

  // rename inside the second space, then move back
  assert.equal((await call('PATCH', '/private/chat/c-ab', annPriv, { displayName: 'ben' })).status, 400);
  assert.equal((await call('PATCH', '/private/chat/c-ab', annPriv, { displayName: 'B.' })).status, 200);
  assert.equal((await call('GET', '/messages/conversations', annPriv)).body.conversations.find(c => c.id === 'c-ab').participants.find(p => p.username === 'ben').displayName, 'B.');
  assert.equal((await call('DELETE', '/private/chat/c-ab', annPriv)).status, 200);
  assert.ok((await ids(tok(ann))).includes('c-ab'));
});

test('the second space has no games, CHEX learn or sticky notes', async () => {
  assert.equal((await call('GET', '/games', annPriv)).status, 403);
  assert.equal((await call('GET', '/stickies', annPriv)).status, 403);
  assert.equal((await call('GET', '/games', tok(ann))).status, 200);
});

test('gallery: only inside the space; saving from the normal side is write-only', async () => {
  assert.equal((await call('GET', '/private/gallery', tok(ann))).status, 403);
  assert.equal((await call('POST', '/private/gallery/save', tok(cat), { url: 'https://example.com/a.jpg' })).status, 409);
  assert.equal((await call('POST', '/private/gallery/save', tok(ann), { url: 'https://example.com/a.jpg', kind: 'image' })).status, 201);
  const g = await call('GET', '/private/gallery', annPriv);
  assert.equal(g.body.items.length, 1);
  assert.equal((await call('GET', '/private/gallery', benPriv)).body.items.length, 0);
  assert.equal((await call('DELETE', `/private/gallery/${g.body.items[0].id}`, benPriv)).status, 404);
  assert.equal((await call('DELETE', `/private/gallery/${g.body.items[0].id}`, annPriv)).status, 200);
});
