// Codex: "search <userid>" opens the profile, "search reel [words]" opens Reels / the best matching reel,
// and questions ("what is…", "enna…", any language) come back as a Google link.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-codex-search-${process.pid}.db`);
delete process.env.ANTHROPIC_API_KEY;            // offline understanding only
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });

const { default: db } = await import('../src/db.js');
const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { default: codexRouter } = await import('../src/routes/codex.js');
const { ACCESS_SECRET } = await import('../src/middleware/auth.js');

const mk = (n) => { db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run(`id-${n}`, n, `${n}@x.com`, 'x', n); return `id-${n}`; };
const ann = mk('ann'), rahul = mk('rahul'), priya = mk('priya'), blocked = mk('blocky');
db.prepare('INSERT INTO reels (id, user_id, video_url, caption) VALUES (?,?,?,?)').run('reel-cats', rahul, 'https://x.test/cats.mp4', 'my cats are funny');
db.prepare('INSERT INTO reels (id, user_id, video_url, caption) VALUES (?,?,?,?)').run('reel-dogs', priya, 'https://x.test/dogs.mp4', 'dogs at the beach');
db.prepare('INSERT INTO reels (id, user_id, video_url, caption) VALUES (?,?,?,?)').run('reel-hidden', blocked, 'https://x.test/h.mp4', 'secret cats club');
db.prepare('INSERT INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').run(ann, blocked);

const app = express(); app.use(express.json());
app.set('io', { to: () => ({ emit() {} }) });
app.use('/codex', codexRouter);
const server = app.listen(0);
const root = `http://127.0.0.1:${server.address().port}`;
const say = async (text, uid = ann) => {
  const r = await fetch(`${root}/codex/act`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: uid }, ACCESS_SECRET)}` }, body: JSON.stringify({ text, context: {} }) });
  return r.json();
};
test.after(() => server.close());

test('search <userid> opens that profile (case-insensitive, with or without @)', async () => {
  for (const t of ['search rahul', 'search RAHUL', 'search @rahul', 'find rahul', 'rahul ah thedu']) {
    const r = await say(t);
    assert.equal(r.handled, true, t);
    assert.deepEqual({ screen: r.navigate.screen, username: r.navigate.username }, { screen: 'profile', username: 'rahul' }, t);
  }
});

test('search for a name that is not an exact userid still shows the Search screen', async () => {
  const r = await say('search rah');
  assert.equal(r.navigate.screen, 'search');
  assert.equal(r.navigate.query, 'rah');
  const tag = await say('search #travel');
  assert.equal(tag.navigate.screen, 'search');
});

test('search <your nickname for someone> opens their profile', async () => {
  await say('save priya as bestie');
  const r = await say('search bestie');
  assert.equal(r.navigate.screen, 'profile');
  assert.equal(r.navigate.username, 'priya');
});

test('search reel opens Reels; search reel <words> plays the best matching reel', async () => {
  const bare = await say('search reel');
  assert.equal(bare.navigate.screen, 'reels');
  const cats = await say('search reel cats');
  assert.deepEqual({ screen: cats.navigate.screen, reelId: cats.navigate.reelId }, { screen: 'reels', reelId: 'reel-cats' });   // not the blocked user's "secret cats club"
  const none = await say('search reels zebra');
  assert.equal(none.navigate.screen, 'search');
  assert.equal(none.navigate.scope, 'reels');
});

test('questions come back as a Google link, in any language', async () => {
  for (const t of ['what is gravity', 'python enna', 'kya hai AI', 'என்ன பைதான்', 'qué es la gravedad']) {
    const r = await say(t);
    assert.equal(r.handled, true, t);
    assert.ok(r.openUrl.startsWith('https://www.google.com/search?q='), `${t} -> ${r.openUrl}`);
    assert.equal(r.openApp, null);
    assert.equal(decodeURIComponent(r.openUrl.split('q=')[1]), t);
  }
});

test('open <something that is not an app> falls back to Google', async () => {
  const r = await say('open gravity');
  assert.ok(r.openUrl.startsWith('https://www.google.com/search?q='), r.openUrl);
});

test('commands that contain a question word still run as commands', async () => {
  const r = await say('message priya: what is up');
  assert.match(r.message, /Sent to @priya|message request/i);
});
