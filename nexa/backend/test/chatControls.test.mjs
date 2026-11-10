// Chat controls (delete chat / mute / block / restrict), delete-for-me, group chat management, post delete.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-chatctl-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });

const { default: db } = await import('../src/db.js');
const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { default: messagesRouter } = await import('../src/routes/messages.js');
const { default: usersRouter } = await import('../src/routes/users.js');
const { default: postsRouter } = await import('../src/routes/posts.js');
const { ACCESS_SECRET } = await import('../src/middleware/auth.js');

const mk = (n) => { db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run(`id-${n}`, n, `${n}@x.com`, 'x', n); return `id-${n}`; };
const ann = mk('ann'), ben = mk('ben'), cat = mk('cat'), dan = mk('dan');
const direct = (id, a, b) => {
  db.prepare("INSERT INTO conversations (id, type, direct_key) VALUES (?,'direct',?)").run(id, [a, b].sort().join(':'));
  for (const u of [a, b]) db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(id, u);
};
direct('c1', ann, ben);

const emitted = [];
const app = express(); app.use(express.json());
app.set('io', { to: (room) => ({ emit: (ev, payload) => emitted.push({ room, ev, payload }) }) });
app.use('/messages', messagesRouter);
app.use('/users', usersRouter);
app.use('/posts', postsRouter);
const server = app.listen(0);
const root = `http://127.0.0.1:${server.address().port}`;
const call = async (method, url, uid, body) => {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: uid }, ACCESS_SECRET)}` };
  const r = await fetch(root + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const msgs = async (uid, cid) => (await call('GET', `/messages/conversations/${cid}/messages`, uid)).body.messages;
const convo = async (uid, cid) => (await call('GET', '/messages/conversations', uid)).body.conversations.find(c => c.id === cid);
test.after(() => server.close());

test('delete chat clears it for me only, and it returns when someone writes again', async () => {
  await call('POST', '/messages/send', ann, { conversationId: 'c1', text: 'hi ben' });
  await call('POST', '/messages/send', ben, { conversationId: 'c1', text: 'hi ann' });
  assert.equal((await msgs(ann, 'c1')).length, 2);

  const del = await call('POST', '/messages/conversations/c1/delete', ann);
  assert.equal(del.status, 200); assert.equal(del.body.left, false);
  assert.equal(await convo(ann, 'c1'), undefined, 'hidden from my list');
  assert.equal((await msgs(ann, 'c1')).length, 0, 'old messages hidden for me');
  assert.equal((await msgs(ben, 'c1')).length, 2, 'ben keeps everything');
  assert.ok(await convo(ben, 'c1'));

  await new Promise(r => setTimeout(r, 5));
  await call('POST', '/messages/send', ben, { conversationId: 'c1', text: 'are you there?' });
  assert.ok(await convo(ann, 'c1'), 'chat comes back on a new message');
  const after = await msgs(ann, 'c1');
  assert.deepEqual(after.map(m => m.content), ['are you there?']);
});

test('mute is private to me and silences alerts but still delivers', async () => {
  assert.equal((await call('POST', '/messages/conversations/c1/mute', ann)).body.muted, true);
  assert.equal((await convo(ann, 'c1')).muted, true);
  assert.equal((await convo(ben, 'c1')).muted, false);
  const before = db.prepare("SELECT COUNT(*) c FROM notifications WHERE recipient_id = ? AND type = 'message'").get(ann).c;
  const sent = await call('POST', '/messages/send', ben, { conversationId: 'c1', text: 'quiet one' });
  assert.equal(sent.status, 201);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE recipient_id = ? AND type = 'message'").get(ann).c, before, 'no alert while muted');
  assert.ok(emitted.some(e => e.room === `user:${ann}` && e.ev === 'message:new' && e.payload.content === 'quiet one'), 'still delivered live');
  await call('DELETE', '/messages/conversations/c1/mute', ann);
  await call('POST', '/messages/send', ben, { conversationId: 'c1', text: 'loud again' });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE recipient_id = ? AND type = 'message'").get(ann).c, before + 1);
});

test('restricting someone silences their chat alerts; the chat reports the flag', async () => {
  await call('POST', '/users/ben/restrict', ann);
  assert.equal((await convo(ann, 'c1')).restricted, true);
  assert.equal((await convo(ben, 'c1')).restricted, false);
  const before = db.prepare("SELECT COUNT(*) c FROM notifications WHERE recipient_id = ? AND type = 'message'").get(ann).c;
  await call('POST', '/messages/send', ben, { conversationId: 'c1', text: 'psst' });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE recipient_id = ? AND type = 'message'").get(ann).c, before);
  await call('DELETE', '/users/ben/restrict', ann);
});

test('blocking closes an existing chat in both directions and is reflected in the list', async () => {
  await call('POST', '/users/ben/block', ann);
  assert.equal((await convo(ann, 'c1')).blocked, true);
  const fromBen = await call('POST', '/messages/send', ben, { conversationId: 'c1', text: 'let me in' });
  assert.equal(fromBen.status, 403);
  const fromAnn = await call('POST', '/messages/send', ann, { conversationId: 'c1', text: 'hello?' });
  assert.equal(fromAnn.status, 403);
  await call('DELETE', '/users/ben/block', ann);
  assert.equal((await call('POST', '/messages/send', ben, { conversationId: 'c1', text: 'back' })).status, 201);
});

test('delete for me hides one message from me only; unsend still removes it for everyone', async () => {
  const sent = (await call('POST', '/messages/send', ben, { conversationId: 'c1', text: 'secret-ish' })).body.message;
  assert.equal((await call('POST', `/messages/${sent.id}/hide`, ann)).status, 200);
  assert.equal((await msgs(ann, 'c1')).some(m => m.id === sent.id), false);
  assert.equal((await msgs(ben, 'c1')).some(m => m.id === sent.id), true);
  assert.equal((await call('POST', `/messages/${sent.id}/hide`, cat)).status, 403, 'outsiders cannot hide');
  assert.equal((await call('DELETE', `/messages/${sent.id}`, ann)).status, 403, 'only the sender can unsend');
  assert.equal((await call('DELETE', `/messages/${sent.id}`, ben)).status, 200);
  assert.equal((await msgs(ben, 'c1')).some(m => m.id === sent.id), false);
});

test('group chat: create, name shows up, rename, add, remove, leave, admin handover', async () => {
  const bad = await call('POST', '/messages/conversations/group', ann, { name: 'x', usernames: ['ben'] });
  assert.equal(bad.status, 400);
  const created = await call('POST', '/messages/conversations/group', ann, { name: 'Weekend plans', usernames: ['ben', 'cat'] });
  assert.equal(created.status, 201);
  const g = created.body.conversation;
  assert.equal(g.type, 'group'); assert.equal(g.name, 'Weekend plans'); assert.equal(g.participants.length, 3);
  assert.equal(g.myRole, 'admin');
  assert.equal((await convo(ben, g.id)).myRole, 'member');

  const hello = await call('POST', '/messages/send', ben, { conversationId: g.id, text: 'hey all' });
  assert.equal(hello.status, 201);
  assert.equal((await msgs(cat, g.id))[0].senderId, ben);

  assert.equal((await call('PATCH', `/messages/conversations/${g.id}`, ben, { name: 'nope' })).status, 403, 'members cannot rename');
  assert.equal((await call('PATCH', `/messages/conversations/${g.id}`, ann, { name: 'Trip 🌴' })).body.conversation.name, 'Trip 🌴');
  assert.equal((await call('PATCH', `/messages/conversations/${g.id}`, ann, { name: '  ' })).status, 400);

  assert.equal((await call('POST', `/messages/conversations/${g.id}/members`, ben, { usernames: ['dan'] })).status, 403);
  const added = await call('POST', `/messages/conversations/${g.id}/members`, ann, { usernames: ['dan'] });
  assert.equal(added.body.conversation.participants.length, 4);
  assert.ok(emitted.some(e => e.room === `user:${dan}` && e.ev === 'conversation:changed'), 'new member is told live');

  assert.equal((await call('DELETE', `/messages/conversations/${g.id}/members/cat`, ben)).status, 403);
  const removed = await call('DELETE', `/messages/conversations/${g.id}/members/cat`, ann);
  assert.equal(removed.body.conversation.participants.length, 3);
  assert.equal(await convo(cat, g.id), undefined, 'removed person no longer sees it');

  const left = await call('POST', `/messages/conversations/${g.id}/delete`, ann); // admin leaves
  assert.equal(left.body.left, true);
  assert.equal(await convo(ann, g.id), undefined);
  const rest = await convo(ben, g.id);
  assert.equal(rest.participants.length, 2);
  assert.ok(rest.participants.some(p => p.role === 'admin'), 'someone was promoted to admin');
});

test('group rules: blocked people cannot be added, self in list is ignored', async () => {
  await call('POST', '/users/dan/block', ann);
  assert.equal((await call('POST', '/messages/conversations/group', ann, { usernames: ['ben', 'dan'] })).status, 403);
  await call('DELETE', '/users/dan/block', ann);
  const ok = await call('POST', '/messages/conversations/group', ann, { usernames: ['ann', 'ben', 'cat'] });
  assert.equal(ok.status, 201); assert.equal(ok.body.conversation.participants.length, 3);
});

test('delete my own post: gone for everyone, saved copies removed, others cannot delete it, twice is 404', async () => {
  db.prepare("INSERT INTO posts (id, user_id, caption) VALUES ('pd1', ?, 'bye')").run(ann);
  db.prepare("INSERT INTO saved_posts (user_id, post_id) VALUES (?, 'pd1')").run(ben);
  assert.equal((await call('DELETE', '/posts/pd1', ben)).status, 403);
  assert.equal((await call('GET', '/posts/pd1', ben)).status, 200);
  assert.equal((await call('DELETE', '/posts/pd1', ann)).status, 200);
  assert.equal((await call('GET', '/posts/pd1', ben)).status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM saved_posts WHERE post_id = 'pd1'").get().c, 0);
  assert.equal((await call('DELETE', '/posts/pd1', ann)).status, 404);
});
