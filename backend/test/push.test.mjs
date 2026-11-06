// Phone notifications: only recent unread items are pushed, messages go out at high urgency, a subscription that can
// never work again (made with other server keys, or uninstalled) is removed, and a temporary failure keeps it.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-push-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });
process.env.PORT = '0';

const { default: db } = await import('../src/db.js');
const { default: webpush } = await import('web-push');
const push = await import('../src/push.js');

const user = (name) => { db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run(`id-${name}`, name, `${name}@x.com`, 'x', name); return `id-${name}`; };
const sub = (uid, n) => db.prepare('INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES (?,?,?,?)').run(`https://push.example/${uid}/${n}`, uid, 'k', 'a');
const note = (to, from, type, ageMs = 0) => db.prepare('INSERT INTO notifications (id, recipient_id, actor_id, type, created_at) VALUES (?,?,?,?,?)')
  .run(`n-${Math.random()}`, to, from, type, new Date(Date.now() - ageMs).toISOString());
const subCount = (uid) => db.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id = ?').get(uid).n;

let sent = [];
const stub = (fn) => { webpush.sendNotification = async (s, payload, opts) => { sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload), opts }); return fn(s); }; };

test('push: a new message is sent at high urgency; old unread items are not re-sent', async () => {
  const me = user('pa'), friend = user('pb');
  sub(me, 1); sent = []; stub(() => ({}));
  note(me, friend, 'like', 60 * 60 * 1000);                 // an hour old: skipped (server may have restarted since)
  await push.sendPushToUser(me);
  assert.equal(sent.length, 0);
  note(me, friend, 'message');
  await push.sendPushToUser(me);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].opts.urgency, 'high');
  assert.equal(sent[0].payload.url, '/?open=messages');
  await push.sendPushToUser(me);                            // same item is never pushed twice
  assert.equal(sent.length, 1);
});

test('push: a subscription the push service rejects for good is removed; a temporary failure keeps it', async () => {
  const me = user('pc'), friend = user('pd');
  sub(me, 1); sub(me, 2);
  stub((s) => { if (s.endpoint.endsWith('/1')) throw Object.assign(new Error('forbidden'), { statusCode: 403 }); if (s.endpoint.endsWith('/2')) throw Object.assign(new Error('busy'), { statusCode: 503 }); });
  note(me, friend, 'follow');
  await push.sendPushToUser(me);
  const left = db.prepare('SELECT endpoint FROM push_subscriptions WHERE user_id = ?').all(me).map(r => r.endpoint);
  assert.deepEqual(left, [`https://push.example/${me}/2`]);   // 403 (other server keys) → removed; 503 → kept for the retry
});

test('push: an incoming call rings at high urgency with a 45 s lifetime; the test notification reports how many phones got it', async () => {
  const me = user('pe'); sub(me, 1); sub(me, 2);
  sent = []; stub(() => ({}));
  await push.sendCallPush(me, { username: 'caller', display_name: 'Caller' }, 'video');
  assert.equal(sent.length, 2);
  assert.deepEqual([sent[0].opts.TTL, sent[0].opts.urgency, sent[0].payload.call], [45, 'high', true]);
  assert.match(sent[0].payload.body, /video call/);
  assert.equal(await push.sendTestPush(me), 2);
  assert.equal(await push.sendTestPush(user('pf')), 0);       // nobody registered
});
