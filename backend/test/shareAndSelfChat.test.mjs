// Self chat ("message yourself") and sharing a post / reel into a chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-share-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });

const { default: db } = await import('../src/db.js');
const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { default: messagesRouter } = await import('../src/routes/messages.js');
const { ACCESS_SECRET } = await import('../src/middleware/auth.js');

const mk = (n) => { db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run(`id-${n}`, n, `${n}@x.com`, 'x', n); return `id-${n}`; };
const ann = mk('ann'), ben = mk('ben'), cat = mk('cat');
db.prepare("INSERT INTO conversations (id, type, direct_key) VALUES ('c1','direct',?)").run([ann, ben].sort().join(':'));
for (const u of [ann, ben]) db.prepare("INSERT INTO conversation_participants (conversation_id, user_id) VALUES ('c1', ?)").run(u);
db.prepare("INSERT INTO reels (id, user_id, video_url, caption) VALUES ('r1', ?, '/uploads/x.mp4', 'hello')").run(ann);
db.prepare("INSERT INTO posts (id, user_id, caption) VALUES ('p1', ?, 'a post')").run(ann);
db.prepare("INSERT INTO posts (id, user_id, caption, audience) VALUES ('p2', ?, 'followers only', 'followers')").run(ann);

const app = express(); app.use(express.json());
app.set('io', { to: () => ({ emit: () => {} }) });
app.use('/messages', messagesRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/messages`;
const call = async (method, url, uid, body) => {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: uid }, ACCESS_SECRET)}` };
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
test.after(() => server.close());

test('self chat is created once and you can message yourself', async () => {
  const a = await call('POST', '/self', ann);
  const b = await call('POST', '/self', ann);
  assert.equal(a.status, 200);
  assert.equal(a.body.conversation.id, b.body.conversation.id);
  assert.deepEqual(a.body.conversation.participants.map(p => p.id), [ann]);
  const sent = await call('POST', '/send', ann, { conversationId: a.body.conversation.id, text: 'note to self' });
  assert.equal(sent.status, 201);
  const byName = await call('POST', '/send', ann, { toUsername: 'ann', text: 'again' });
  assert.equal(byName.status, 201);
  assert.equal(byName.body.message.conversationId, a.body.conversation.id);
  const list = await call('GET', '/conversations', ann);
  assert.ok(list.body.conversations.some(c => c.id === a.body.conversation.id));
  assert.equal((await call('GET', '/conversations', ben)).body.conversations.some(c => c.id === a.body.conversation.id), false);
});

test('sharing a reel delivers a card message to an existing chat', async () => {
  const r = await call('POST', '/share', ben, { kind: 'reel', id: 'r1', toUsernames: ['ann'] });
  assert.equal(r.status, 200);
  assert.equal(r.body.results[0].status, 'sent');
  const msgs = await call('GET', '/conversations/c1/messages', ann);
  const m = msgs.body.messages.find(x => x.share);
  assert.deepEqual(m.share, { kind: 'reel', id: 'r1' });
});

test('sharing to someone you have not chatted with becomes a message request; you can share to yourself', async () => {
  const r = await call('POST', '/share', ann, { kind: 'post', id: 'p1', toUsernames: ['cat', 'ann'] });
  assert.deepEqual(r.body.results.map(x => x.status), ['message_request', 'sent']);
});

test('cannot share what you cannot see, or with nobody', async () => {
  assert.equal((await call('POST', '/share', cat, { kind: 'post', id: 'p2', toUsernames: ['ann'] })).status, 404);
  assert.equal((await call('POST', '/share', ann, { kind: 'reel', id: 'nope', toUsernames: ['ben'] })).status, 404);
  assert.equal((await call('POST', '/share', ann, { kind: 'reel', id: 'r1', toUsernames: [] })).status, 400);
  assert.equal((await call('POST', '/share', ann, { kind: 'bad', id: 'r1', toUsernames: ['ben'] })).status, 400);
});
