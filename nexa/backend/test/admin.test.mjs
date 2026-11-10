// The permanent master account "sanjiv": two-password login, reports -> DM, admin delete, gifts, unlimited coins.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-admin-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });
process.env.PORT = '0';

const { default: db } = await import('../src/db.js');
const { default: express } = await import('express');
const admin = await import('../src/admin.js');
const { default: authRoutes } = await import('../src/routes/auth.js');
const { default: adminRoutes } = await import('../src/routes/admin.js');
const { default: reportRoutes } = await import('../src/routes/reports.js');
const { default: coinRoutes } = await import('../src/routes/coins.js');
const { default: postRoutes } = await import('../src/routes/posts.js');
const { default: messageRoutes } = await import('../src/routes/messages.js');

admin.seedMasterAccount();
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api/auth', authRoutes); app.use('/api/admin', adminRoutes); app.use('/api/reports', reportRoutes);
app.use('/api/coins', coinRoutes); app.use('/api/posts', postRoutes); app.use('/api/messages', messageRoutes);
const server = http.createServer(app).listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
test.after(() => server.close());

const call = async (method, url, { token, body, ip } = {}) => {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ip ? { 'X-Forwarded-For': ip } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const signup = async (name) => (await call('POST', '/auth/signup', { body: { username: name, email: `${name}@x.com`, password: 'password123' } })).data;
const masterLogin = async (body, ip = '9.9.9.9') => call('POST', '/auth/login', { body: { identifier: 'sanjiv', ...body }, ip });

test('the master account exists, is unique and nobody can sign up as sanjiv', async () => {
  assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE role='master'").get().c, 1);
  const r = await call('POST', '/auth/signup', { body: { username: 'sanjiv', email: 'evil@x.com', password: 'password123' } });
  assert.equal(r.status, 409);
});

const fullMasterLogin = async (ip) => { const r = await masterLogin({ password: 'sanjiv369' }, ip); return step2(r.data.challenge, 'codecode', ip); };
const step1 = (password, ip) => masterLogin({ password }, ip);
const step2 = (challenge, password2, ip) => call('POST', '/auth/login/verify', { body: { challenge, password2 }, ip });

test('login is two steps; a wrong password at either step is refused with the same generic error', async () => {
  const bad1 = await step1('wrong', '1.1.1.1');
  assert.equal(bad1.status, 401); assert.equal(bad1.data.error.code, 'INVALID_CREDENTIALS');
  assert.equal((await step1('codecode', '1.1.1.3')).status, 401); // swapped passwords
  const s1 = await step1('sanjiv369', '1.1.1.4');
  assert.equal(s1.status, 200); assert.equal(s1.data.requiresPassword2, true); assert.ok(s1.data.challenge); assert.equal(s1.data.accessToken, undefined);
  // password 2 can't be sent in one go: step 1 ignores it
  const oneShot = await masterLogin({ password: 'sanjiv369', password2: 'codecode' }, '1.1.1.6');
  assert.equal(oneShot.data.accessToken, undefined);
  assert.equal((await step2(s1.data.challenge, 'wrong', '1.1.1.4')).status, 401);
  assert.equal((await step2('forged', 'codecode', '1.1.1.4')).status, 401);
  assert.equal((await step2(s1.data.challenge, 'codecode', '8.8.8.8')).status, 401); // challenge is bound to the IP
  const ok = await step2(s1.data.challenge, 'codecode', '1.1.1.4');
  assert.equal(ok.status, 200); assert.ok(ok.data.accessToken); assert.equal(ok.data.user.isAdmin, true);
});

test('five wrong tries lock that IP, even for the right passwords', async () => {
  for (let i = 0; i < 5; i++) await step1('nope', '2.2.2.2');
  assert.equal((await step1('sanjiv369', '2.2.2.2')).status, 429);
  assert.equal((await step1('sanjiv369', '2.2.2.3')).status, 200);
});

test('the system reports account can never log in', async () => {
  const bot = db.prepare("SELECT username FROM users WHERE role='system'").get();
  assert.ok(bot);
  assert.equal((await call('POST', '/auth/login', { body: { identifier: bot.username, password: 'anything' } })).status, 401);
});

test('master cannot be deactivated, deleted or given 2FA; normal users cannot reach /admin', async () => {
  const m = (await fullMasterLogin('3.3.3.3')).data;
  for (const p of ['/auth/deactivate', '/auth/delete-account', '/auth/2fa/setup']) assert.equal((await call('POST', p, { token: m.accessToken, body: { password: 'sanjiv369', confirm: 'DELETE' } })).status, 403);
  const u = await signup('mallory');
  assert.equal((await call('GET', '/admin/overview', { token: u.accessToken })).status, 403);
  assert.equal((await call('GET', '/admin/overview')).status, 401);
  assert.equal((await call('DELETE', `/admin/users/${m.user.id}`, { token: m.accessToken })).status, 403);
  assert.equal((await call('GET', '/reports', { token: u.accessToken })).status, 403);
});

test('a report lands in sanjiv\'s DM, and sanjiv can delete the post, the reel and the user', async () => {
  const m = (await fullMasterLogin('4.4.4.4')).data;
  const bad = await signup('badguy'), rep = await signup('reporter');
  const post = (await call('POST', '/posts', { token: bad.accessToken, body: { caption: 'spam spam' } })).data.post;
  db.prepare("INSERT INTO reels (id, user_id, video_url, caption) VALUES ('reel1', ?, '/uploads/x.mp4', 'bad reel')").run(bad.user.id);
  assert.equal((await call('POST', '/reports', { token: rep.accessToken, body: { targetType: 'post', targetId: post.id, reason: 'spam' } })).status, 201);
  assert.equal((await call('POST', '/reports', { token: rep.accessToken, body: { targetType: 'reel', targetId: 'reel1', reason: 'bad' } })).status, 201);

  const convos = (await call('GET', '/messages/conversations', { token: m.accessToken })).data.conversations;
  const inbox = convos.find(c => c.participants.some(p => p.username.startsWith('chex.reports')));
  assert.ok(inbox, 'reports conversation exists in sanjiv\'s inbox');
  assert.ok(inbox.unreadCount >= 2);
  const msgs = (await call('GET', `/messages/conversations/${inbox.id}/messages`, { token: m.accessToken })).data.messages;
  assert.ok(msgs.some(x => x.content.includes('@reporter') && x.content.includes('spam spam')));

  const q = (await call('GET', '/admin/reports', { token: m.accessToken })).data.reports;
  assert.equal(q.length, 2);
  assert.equal((await call('DELETE', `/admin/content/post/${post.id}`, { token: m.accessToken })).status, 200);
  assert.equal(db.prepare('SELECT deleted_at d FROM posts WHERE id=?').get(post.id).d !== null, true);
  assert.equal((await call('POST', `/admin/reports/${q.find(r => r.target.type === 'reel').id}/resolve`, { token: m.accessToken, body: { status: 'actioned', removeContent: true } })).status, 200);
  assert.ok(db.prepare("SELECT deleted_at d FROM reels WHERE id='reel1'").get().d);
  assert.equal((await call('DELETE', `/admin/users/${bad.user.id}`, { token: m.accessToken })).status, 200);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE id=?').get(bad.user.id), undefined);
  assert.equal(db.pragma('foreign_key_check').length, 0);
});

test('gifts: coins, premium frames + themes; master has unlimited coins', async () => {
  const m = (await fullMasterLogin('5.5.5.5')).data;
  const u = await signup('lucky');
  assert.equal((await call('POST', '/admin/gift/coins', { token: m.accessToken, body: { username: 'lucky', amount: 100 } })).data.balance, 100);
  assert.equal((await call('POST', '/admin/gift/coins', { token: m.accessToken, body: { username: 'lucky', amount: -5 } })).status, 400);
  assert.equal((await call('POST', '/admin/gift/item', { token: m.accessToken, body: { username: 'lucky', itemId: 'premium-frames', frame: 'galaxy' } })).status, 200);
  assert.equal((await call('POST', '/admin/gift/item', { token: m.accessToken, body: { username: 'lucky', itemId: 'premium-themes' } })).status, 200);
  const w = (await call('GET', '/coins/me', { token: u.accessToken })).data;
  assert.deepEqual(w.unlocked.sort(), ['premium-frames', 'premium-themes']);
  assert.equal(w.frame, 'galaxy'); assert.equal(w.balance, 100); assert.equal(w.unlimited, false);
  const mw = (await call('GET', '/coins/me', { token: m.accessToken })).data;
  assert.equal(mw.unlimited, true); assert.equal(mw.unlocked.length, 2); assert.ok(mw.balance > 1e12);
  assert.equal((await call('POST', '/admin/gift/coins', { token: u.accessToken, body: { username: 'lucky', amount: 1e6 } })).status, 403);
});

test('users can gift coins, themes, frames and languages to each other (paid by the sender)', async () => {
  const a = await signup('giver'), b = await signup('getter');
  const give = (body, tok = a.accessToken) => call('POST', '/coins/gift', { token: tok, body: { username: 'getter', ...body } });
  const bal = async (u) => (await call('GET', '/coins/me', { token: u.accessToken })).data;
  db.prepare("INSERT INTO coin_ledger (user_id, amount, reason, ref) VALUES (?, 5000, 'seed', 'seed-giver')").run(a.user.id);

  assert.equal((await give({ type: 'coins', amount: 50 })).status, 200);
  assert.equal((await bal(a)).balance, 4950); assert.equal((await bal(b)).balance, 50);
  assert.equal((await give({ type: 'coins', amount: 451 })).status, 429);          // daily cap 500
  assert.equal((await give({ type: 'coins', amount: 0 })).status, 400);

  assert.equal((await give({ type: 'premium-themes' })).status, 200);               // costs 1000
  assert.equal((await give({ type: 'premium-themes' })).status, 409);               // already owned
  assert.equal((await give({ type: 'premium-frames' })).status, 200);               // costs 2000
  assert.deepEqual((await bal(b)).unlocked.sort(), ['premium-frames', 'premium-themes']);
  assert.equal((await bal(a)).balance, 4950 - 1000 - 2000);

  assert.equal((await give({ type: 'language', lang: 'es' })).status, 409);         // no first language yet
  db.prepare("INSERT INTO learn_langs (user_id, lang, kind) VALUES (?, 'fr', 'first')").run(b.user.id);
  assert.equal((await give({ type: 'language', lang: 'es' })).status, 200);         // costs 100
  assert.equal((await give({ type: 'language', lang: 'es' })).status, 409);
  assert.deepEqual(db.prepare('SELECT lang FROM learn_langs WHERE user_id=? ORDER BY lang').all(b.user.id).map(r => r.lang), ['es', 'fr']);
  assert.equal((await bal(a)).balance, 1850);

  const poor = await signup('brokie');
  assert.equal((await give({ type: 'coins', amount: 10 }, poor.accessToken)).status, 402);
  assert.equal((await call('POST', '/coins/gift', { token: a.accessToken, body: { username: 'giver', type: 'coins', amount: 5 } })).status, 400); // self
  assert.equal((await call('POST', '/coins/gift', { token: a.accessToken, body: { username: 'sanjiv', type: 'coins', amount: 5 } })).status, 404); // master/system can't receive
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id) VALUES (?, ?)").run(b.user.id, a.user.id);
  assert.equal((await give({ type: 'coins', amount: 1 })).status, 403);              // blocked
});
