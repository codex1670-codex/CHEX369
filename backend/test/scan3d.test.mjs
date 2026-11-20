// CHEX 3D Scanning Studio API: ownership, validation, confirmation rules, provider honesty, publishing.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-scan3d-test-${process.pid}.db`);
process.env.NEXA_UPLOADS_DIR = path.join(os.tmpdir(), `nexa-scan3d-uploads-${process.pid}`);
process.env.NEXA_SCAN_DIR = path.join(os.tmpdir(), `nexa-scan3d-private-${process.pid}`);
process.env.COLMAP_BIN = '/nonexistent/colmap';          // force "provider not installed"
delete process.env.MESHY_API_KEY; delete process.env.TRIPO_API_KEY;
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });

const { default: db } = await import('../src/db.js');
const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { default: scanRouter } = await import('../src/routes/scan3d.js');
const { default: postsRouter } = await import('../src/routes/posts.js');
const { ACCESS_SECRET } = await import('../src/middleware/auth.js');

for (const [id, n] of [['u1', 'ann'], ['u2', 'bob']]) db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run(id, n, `${n}@x.com`, 'x', n);
// The Studio is a premium unlock: u1 and u2 own it; u3 does not.
db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run('u3', 'cat', 'cat@x.com', 'x', 'cat');
for (const u of ['u1', 'u2']) db.prepare('INSERT INTO coin_unlocks (user_id, item_id, price) VALUES (?,?,0)').run(u, 'scan-studio');
const app = express(); app.use(express.json({ limit: '2mb' })); app.use('/scan3d', scanRouter); app.use('/posts', postsRouter);
const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
const as = (u) => ({ Authorization: `Bearer ${jwt.sign({ sub: u }, ACCESS_SECRET)}` });
test.after(() => server.close());
const json = (u, method, url, body) => fetch(base + url, { method, headers: { ...as(u), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

function glb() {
  let j = Buffer.from('{"asset":{"version":"2.0"}}'); while (j.length % 4) j = Buffer.concat([j, Buffer.from(' ')]);
  const h = Buffer.alloc(12); h.write('glTF', 0, 'latin1'); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + j.length, 8);
  const c = Buffer.alloc(8); c.writeUInt32LE(j.length, 0); c.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([h, c, j]);
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');
const form = (name, buf, fname, type) => { const f = new FormData(); f.append(name, new Blob([buf], { type }), fname); return f; };

test('the studio is locked until it is unlocked with coins', async () => {
  const r = await json('u3', 'GET', '/scan3d/projects'); assert.equal(r.status, 403); assert.equal((await r.json()).error.code, 'STUDIO_LOCKED');
  assert.equal((await json('u3', 'POST', '/scan3d/projects', { name: 'x' })).status, 403);
});

test('requires sign-in', async () => { assert.equal((await fetch(`${base}/scan3d/projects`)).status, 401); });

test('capabilities are honest when no provider is installed', async () => {
  const c = await (await json('u1', 'GET', '/scan3d/capabilities')).json();
  assert.equal(c.providers.photogrammetry.available, false); assert.equal(c.providers.singleImage.available, false);
  assert.equal(c.stages.length, 9);
});

let pid;
test('project lifecycle, autosave state and ownership', async () => {
  const r = await json('u1', 'POST', '/scan3d/projects', { name: '  Chair <b>scan</b> ' }); assert.equal(r.status, 201);
  const { project } = await r.json(); pid = project.id; assert.ok(project.name.startsWith('Chair') && !project.name.includes('<'));
  const save = await json('u1', 'PATCH', `/scan3d/projects/${pid}`, { state: { parts: [{ id: 'a' }], variants: [] } }); assert.equal(save.status, 200);
  assert.deepEqual((await (await json('u1', 'GET', `/scan3d/projects/${pid}`)).json()).project.state.parts, [{ id: 'a' }]);
  assert.equal((await json('u2', 'GET', `/scan3d/projects/${pid}`)).status, 404);            // another user can't see it
  assert.equal((await json('u2', 'PATCH', `/scan3d/projects/${pid}`, { name: 'x' })).status, 404);
  assert.equal((await json('u1', 'PATCH', `/scan3d/projects/${pid}`, { state: 'not json{' })).status, 400);
  assert.equal((await json('u1', 'PATCH', `/scan3d/projects/${pid}`, { state: { big: 'x'.repeat(1.2 * 1024 * 1024) } })).status, 400);
});

test('model upload validates GLB, locks the original, and is owner-only', async () => {
  const bad = await fetch(`${base}/scan3d/projects/${pid}/model`, { method: 'PUT', headers: as('u1'), body: form('model', Buffer.from('not a glb at all'), 'x.glb', 'model/gltf-binary') });
  assert.equal(bad.status, 400); assert.equal((await bad.json()).error.code, 'INVALID_MODEL');
  const stranger = await fetch(`${base}/scan3d/projects/${pid}/model?slot=original`, { method: 'PUT', headers: as('u2'), body: form('model', glb(), 'o.glb', 'model/gltf-binary') });
  assert.equal(stranger.status, 404);
  const ok = await fetch(`${base}/scan3d/projects/${pid}/model?slot=original`, { method: 'PUT', headers: as('u1'), body: form('model', glb(), 'o.glb', 'model/gltf-binary') });
  assert.equal(ok.status, 200); const p = (await ok.json()).project; assert.ok(p.hasOriginal && p.hasModel);
  const again = await fetch(`${base}/scan3d/projects/${pid}/model?slot=original`, { method: 'PUT', headers: as('u1'), body: form('model', glb(), 'o.glb', 'model/gltf-binary') });
  assert.equal(again.status, 409);                                                                 // original is never overwritten
  const dl = await json('u1', 'GET', `/scan3d/projects/${pid}/model`); assert.equal(dl.headers.get('content-type'), 'model/gltf-binary'); assert.equal(Buffer.from(await dl.arrayBuffer()).subarray(0, 4).toString(), 'glTF');
  assert.equal((await json('u2', 'GET', `/scan3d/projects/${pid}/model`)).status, 404);
});

test('jobs are refused with a clear message when the provider is missing', async () => {
  const f = new FormData(); f.append('projectId', pid); f.append('engine', 'photogrammetry');
  for (let i = 0; i < 9; i++) f.append('images', new Blob([PNG], { type: 'image/png' }), `${i}.png`);
  const r = await fetch(`${base}/scan3d/jobs`, { method: 'POST', headers: as('u1'), body: f });
  assert.equal(r.status, 503); assert.match((await r.json()).error.message, /COLMAP/);
  const s = new FormData(); s.append('projectId', pid); s.append('engine', 'single-image'); s.append('images', new Blob([PNG], { type: 'image/png' }), 'a.png');
  assert.equal((await fetch(`${base}/scan3d/jobs`, { method: 'POST', headers: as('u1'), body: s })).status, 503);
});

test('publishing needs the confirmation flag and an owned project with a model', async () => {
  const mk = (extra) => { const f = form('media', PNG, 'thumb.png', 'image/png'); f.append('caption', 'my chair'); Object.entries(extra).forEach(([k, v]) => f.append(k, v)); return f; };
  const noConfirm = await fetch(`${base}/posts/upload`, { method: 'POST', headers: as('u1'), body: mk({ modelProjectId: pid }) });
  assert.equal(noConfirm.status, 400); assert.equal((await noConfirm.json()).error.code, 'CONFIRM_REQUIRED');
  const notMine = await fetch(`${base}/posts/upload`, { method: 'POST', headers: as('u2'), body: mk({ modelProjectId: pid, confirmPublish: 'true' }) });
  assert.equal(notMine.status, 404);
  const ok = await fetch(`${base}/posts/upload`, { method: 'POST', headers: as('u1'), body: mk({ modelProjectId: pid, confirmPublish: 'true' }) });
  assert.equal(ok.status, 201); const { post } = await ok.json();
  assert.match(post.modelAsset, /^\/uploads\/models\/[0-9a-f-]+\.glb$/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM posts WHERE model_asset IS NOT NULL').get().c, 1);
});

test('duplicate copies files; delete needs ?confirm=1 and removes data', async () => {
  const d = await json('u1', 'POST', `/scan3d/projects/${pid}/duplicate`); assert.equal(d.status, 201); const copy = (await d.json()).project;
  assert.ok(copy.hasModel); assert.equal((await json('u1', 'GET', `/scan3d/projects/${copy.id}/model`)).status, 200);
  assert.equal((await json('u1', 'DELETE', `/scan3d/projects/${copy.id}`)).status, 400);
  assert.equal((await json('u2', 'DELETE', `/scan3d/projects/${copy.id}?confirm=1`)).status, 404);
  assert.equal((await json('u1', 'DELETE', `/scan3d/projects/${copy.id}?confirm=1`)).status, 200);
  assert.equal((await json('u1', 'GET', `/scan3d/projects/${copy.id}`)).status, 404);
});
