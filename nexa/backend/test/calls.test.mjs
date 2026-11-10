// Call signalling: invite/accept/cancel reach the right people, and only people inside a call can relay signals.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-calls-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });
const { default: db } = await import('../src/db.js');
const { registerCallHandlers } = await import('../src/callEngine.js');

const mk = (n) => { db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run(`id-${n}`, n, `${n}@x.com`, 'x', n); return `id-${n}`; };
const ann = mk('ann'), ben = mk('ben'), eve = mk('eve');
db.prepare("INSERT INTO conversations (id, type, direct_key) VALUES ('c1','direct','a:b')").run();
for (const u of [ann, ben]) db.prepare("INSERT INTO conversation_participants (conversation_id, user_id) VALUES ('c1', ?)").run(u);
db.prepare("INSERT INTO conversations (id, type, direct_key) VALUES ('self','direct','a:a')").run();
db.prepare("INSERT INTO conversation_participants (conversation_id, user_id) VALUES ('self', ?)").run(ann);

const sent = []; // { room, ev, payload }
const io = { to: (room) => ({ emit: (ev, payload) => sent.push({ room, ev, payload }) }) };
const makeSocket = (userId) => {
  const handlers = {}; const rooms = new Set(); const own = [];
  const socket = {
    userId, rooms, on: (ev, fn) => { handlers[ev] = fn; }, emit: (ev, payload) => own.push({ ev, payload }),
    join: (r) => rooms.add(r), to: (room) => ({ emit: (ev, payload) => sent.push({ room, ev, payload, from: userId }) }),
  };
  registerCallHandlers(io, socket);
  return { socket, fire: (ev, payload) => handlers[ev](payload), own };
};
const A = makeSocket(ann), B = makeSocket(ben), E = makeSocket(eve);

test('inviting rings the other person and tells the caller who is being called', () => {
  A.fire('call:invite', { conversationId: 'c1', type: 'video' });
  const incoming = sent.find(s => s.ev === 'call:incoming');
  assert.equal(incoming.room, `user:${ben}`);
  assert.equal(incoming.payload.type, 'video');
  const ringing = A.own.find(o => o.ev === 'call:ringing').payload;
  assert.equal(ringing.peers[0].username, 'ben');
  A.callId = ringing.callId;
});

test('you cannot call from a chat with only yourself, or into a chat you are not in', () => {
  A.own.length = 0;
  A.fire('call:invite', { conversationId: 'self', type: 'voice' });
  assert.match(A.own[0].payload.message, /someone else/);
  E.fire('call:invite', { conversationId: 'c1', type: 'voice' });
  assert.match(E.own[0].payload.message, /not part/);
});

test('only people inside the call can relay signals; accepting joins the room', () => {
  sent.length = 0;
  B.fire('call:signal', { callId: A.callId, data: { kind: 'offer' } });            // ben has not accepted yet
  assert.equal(sent.filter(s => s.ev === 'call:signal').length, 0);
  B.fire('call:accept', { callId: A.callId });
  assert.ok(sent.some(s => s.ev === 'call:accepted'));
  A.fire('call:signal', { callId: A.callId, data: { kind: 'offer' } });
  assert.equal(sent.filter(s => s.ev === 'call:signal').length, 1);
  E.fire('call:signal', { callId: A.callId, data: { kind: 'ice' } });              // outsider is ignored
  assert.equal(sent.filter(s => s.ev === 'call:signal').length, 1);
});

test('hanging up (or cancelling before an answer) tells the other person on their own room', () => {
  sent.length = 0;
  A.fire('call:end', { callId: A.callId });
  assert.ok(sent.some(s => s.ev === 'call:ended' && s.room === `user:${ben}`));
  A.own.length = 0; sent.length = 0;
  A.fire('call:invite', { conversationId: 'c1', type: 'voice' });
  const id = A.own.find(o => o.ev === 'call:ringing').payload.callId;
  A.fire('call:end', { callId: id });                                               // cancelled while ringing
  assert.ok(sent.some(s => s.ev === 'call:ended' && s.room === `user:${ben}`), 'callee ring screen closes');
  const row = db.prepare('SELECT status FROM calls WHERE id = ?').get(id);
  assert.equal(row.status, 'ended');
});
