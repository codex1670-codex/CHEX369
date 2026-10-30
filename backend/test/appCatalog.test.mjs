// App catalog: seeded on boot, resolves names/aliases, and gives the phone what it needs
// to open the installed app (with a Google fallback when it isn't installed).
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-app-catalog-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });

const { default: db } = await import('../src/db.js');
const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { default: appsRouter } = await import('../src/routes/apps.js');
const { APP_CATALOG, findApp, launchInfo } = await import('../src/appCatalog.js');
const { ACCESS_SECRET } = await import('../src/middleware/auth.js');

db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run('u1', 'me', 'me@x.com', 'x', 'me');
const app = express();
app.use(express.json());
app.use('/apps', appsRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (body) => (await fetch(`${base}/apps/resolve`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: 'u1' }, ACCESS_SECRET)}` }, body: JSON.stringify(body),
})).json();
test.after(() => server.close());

test('catalog is seeded with 100+ apps and ids/packages are unique', () => {
  assert.ok(APP_CATALOG.length >= 100);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM app_registry').get().n, APP_CATALOG.length);
  assert.equal(new Set(APP_CATALOG.map(a => a.id)).size, APP_CATALOG.length);
  const pk = APP_CATALOG.map(a => a.android).filter(Boolean);
  assert.equal(new Set(pk).size, pk.length);
});

test('names, aliases and typos resolve to the right app', () => {
  for (const [q, id] of [['whatsapp', 'whatsapp'], ['WA', 'whatsapp'], ['insta', 'instagram'], ['yt', 'youtube'], ['gpay', 'google-pay'],
    ['hotstar', 'hotstar'], ['ff max', 'free-fire-max'], ['maps', 'maps'], ['whatsapp business', 'whatsapp-business']]) {
    assert.equal(findApp(db, q)?.id, id, q);
  }
  assert.equal(findApp(db, 'zzzz-not-an-app'), null);
});

test('resolve gives launch info: package, scheme, web url, google fallback', async () => {
  const r = await post({ query: 'whatsapp' });
  assert.equal(r.launchable, true);
  assert.equal(r.launch.android, 'com.whatsapp');
  assert.equal(r.launch.ios, 'whatsapp://');
  assert.match(r.launch.fallbackUrl, /^https:\/\/www\.google\.com\/search\?q=WhatsApp/);
});

test('"open youtube and search X" carries the search url and a google fallback for X', async () => {
  const r = await post({ query: 'youtube', searchFor: 'ai tutorials' });
  assert.equal(r.launch.searchUrl, 'https://www.youtube.com/results?search_query=ai%20tutorials');
  assert.match(r.launch.fallbackUrl, /YouTube%20ai%20tutorials/);
});

test('games with no website are still launchable (installed app, else Google)', async () => {
  const r = await post({ query: 'free fire' });
  assert.equal(r.launchable, true);
  assert.equal(r.launch.android, 'com.dts.freefireth');
  assert.equal(r.launch.webUrl, null);
});

test('an app that is not in the catalog falls back to Google', async () => {
  const r = await post({ query: 'my obscure app' });
  assert.equal(r.launchable, true);
  assert.equal(r.launch.android, null);
  assert.match(r.launch.fallbackUrl, /google\.com\/search\?q=my%20obscure%20app/);
});

test('launchInfo ignores a search when the app has no search url', () => {
  const l = launchInfo(findApp(db, 'whatsapp'), 'hello');
  assert.equal(l.searchUrl, null);
});
