// Per-chat unread counts in the Messages list.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-unread-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });

const { default: db } = await import('../src/db.js');
const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { default: messagesRouter } = await import('../src/routes/messages.js');
const { ACCESS_SECRET } = await import('../src/middleware/auth.js');

const mk = (n) => { db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run(`id-${n}`, n, `${n}@x.com`, 'x', n); return `id-${n}`; };
const ann = mk('ann'), ben = mk('ben');
db.prepare("INSERT INTO conversations (id, type, direct_key) VALUES ('c1','direct',?)").run([ann, ben].sort().join(':'));
for (const u of [ann, ben]) db.prepare("INSERT INTO conversation_participants (conversation_id, user_id) VALUES ('c1', ?)").run(u);

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
const unreadFor = async (uid) => (await call('GET', '/conversations', uid)).body.conversations.find(c => c.id === 'c1').unreadCount;

test('unread count grows for the receiver only, and clears when the chat is opened', async () => {
  await call('POST', '/send', ben, { conversationId: 'c1', text: 'hi' });
  await call('POST', '/send', ben, { conversationId: 'c1', text: 'there' });
  assert.equal(await unreadFor(ann), 2);
  assert.equal(await unreadFor(ben), 0);
  await call('GET', '/conversations/c1/messages', ann);
  assert.equal(await unreadFor(ann), 0);
});

test('explicit read endpoint clears the count and rejects non-members', async () => {
  await new Promise(r => setTimeout(r, 5));
  await call('POST', '/send', ben, { conversationId: 'c1', text: 'again' });
  assert.equal(await unreadFor(ann), 1);
  assert.equal((await call('POST', '/conversations/c1/read', ann)).status, 200);
  assert.equal(await unreadFor(ann), 0);
  const outsider = mk('cat');
  assert.equal((await call('POST', '/conversations/c1/read', outsider)).status, 403);
});
