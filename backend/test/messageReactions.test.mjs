// Message reactions: one emoji per person per message, kept after reload, pushed live to the other person.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-react-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });

const { default: db } = await import('../src/db.js');
const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { default: messagesRouter } = await import('../src/routes/messages.js');
const { ACCESS_SECRET } = await import('../src/middleware/auth.js');

const mk = (n) => { db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run(`id-${n}`, n, `${n}@x.com`, 'x', n); return `id-${n}`; };
const ann = mk('ann'), ben = mk('ben'), eve = mk('eve');
db.prepare("INSERT INTO conversations (id, type, direct_key) VALUES ('c1','direct','a:b')").run();
for (const u of [ann, ben]) db.prepare("INSERT INTO conversation_participants (conversation_id, user_id) VALUES ('c1', ?)").run(u);
db.prepare("INSERT INTO messages (id, conversation_id, sender_id, content) VALUES ('m1','c1',?, 'hi')").run(ann);

const emitted = [];
const app = express(); app.use(express.json());
app.set('io', { to: (room) => ({ emit: (ev, payload) => emitted.push({ room, ev, payload }) }) });
app.use('/messages', messagesRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/messages`;
const call = async (method, url, uid, body) => {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: uid }, ACCESS_SECRET)}` };
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
test.after(() => server.close());

test('reacting stores one emoji per person, replaces it, and tells the other person live', async () => {
  let r = await call('POST', '/m1/react', ben, { emoji: '🔥' });
  assert.equal(r.status, 200); assert.deepEqual(r.body.reactions.map(x => x.emoji), ['🔥']);
  r = await call('POST', '/m1/react', ben, { emoji: '😂' });
  assert.deepEqual(r.body.reactions.map(x => x.emoji), ['😂']);               // replaced, not added
  r = await call('POST', '/m1/react', ann, { emoji: '❤️' });
  assert.equal(r.body.reactions.length, 2);
  const live = emitted.filter(e => e.ev === 'message:reaction' && e.room === `user:${ann}`);
  assert.ok(live.length >= 2, 'ann is told when ben reacts');
});

test('reactions are returned with the chat history (survive a reload)', async () => {
  const r = await call('GET', '/conversations/c1/messages', ann);
  const m = r.body.messages.find(x => x.id === 'm1');
  assert.deepEqual(m.reactions.map(x => `${x.user_id}:${x.emoji}`).sort(), [`${ann}:❤️`, `${ben}:😂`].sort());
});

test('removing a reaction updates both sides', async () => {
  emitted.length = 0;
  const r = await call('DELETE', '/m1/react', ben);
  assert.deepEqual(r.body.reactions.map(x => x.user_id), [ann]);
  assert.ok(emitted.some(e => e.ev === 'message:reaction' && e.room === `user:${ann}`));
});

test('people outside the chat cannot react or un-react', async () => {
  assert.equal((await call('POST', '/m1/react', eve, { emoji: '👍' })).status, 403);
  assert.equal((await call('DELETE', '/m1/react', eve)).status, 403);
  assert.equal((await call('POST', '/m1/react', ann, { emoji: '  ' })).status, 400);
});

test('multi-part emoji (skin tone / ZWJ) are not cut off', async () => {
  const e = '👩🏽‍❤️‍👨🏻'; // longer than 8 UTF-16 units
  const r = await call('POST', '/m1/react', ann, { emoji: e });
  assert.equal(r.body.reactions.find(x => x.user_id === ann).emoji, e);
});
