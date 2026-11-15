// CHEX Simulation: 3D posts = a PNG cut-out + sanitised look settings, shown back on every post DTO.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-model3d-test-${process.pid}.db`);
process.env.NEXA_UPLOADS_DIR = path.join(os.tmpdir(), `nexa-model3d-uploads-${process.pid}`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });

const { default: db } = await import('../src/db.js');
const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { default: postsRouter } = await import('../src/routes/posts.js');
const { ACCESS_SECRET } = await import('../src/middleware/auth.js');
const { sanitizeModel3d } = await import('../src/uploads.js');

db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run('u1', 'ann', 'ann@x.com', 'x', 'Ann');
const app = express(); app.use(express.json()); app.use('/posts', postsRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/posts`;
const auth = { Authorization: `Bearer ${jwt.sign({ sub: 'u1' }, ACCESS_SECRET)}` };
test.after(() => server.close());

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');
const upload = async (fields, { type = 'image/png', name = 'chex-3d.png', bytes = PNG } = {}) => {
  const form = new FormData();
  form.append('media', new Blob([bytes], { type }), name);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const r = await fetch(`${base}/upload`, { method: 'POST', headers: auth, body: form });
  return { status: r.status, body: await r.json() };
};

test('sanitiser clamps numbers, whitelists finish, rejects bad colours and junk', () => {
  const m = sanitizeModel3d({ depth: 50, twist: -500, finish: 'lava', tint: 'url(x)', bg: '#ABCDEF', clay: 'yes', spin: false, evil: '<script>' });
  assert.equal(m.depth, 1.2); assert.equal(m.twist, -180); assert.equal(m.finish, 'matte');
  assert.equal(m.tint, '#ffffff'); assert.equal(m.bg, '#abcdef'); assert.equal(m.clay, false); assert.equal(m.spin, false);
  assert.equal('evil' in m, false);
  assert.equal(sanitizeModel3d('not json'), null); assert.equal(sanitizeModel3d([1]), null); assert.equal(sanitizeModel3d(''), null);
  assert.equal(sanitizeModel3d('x'.repeat(3000)), null);
});

test('a 3D post stores its settings and returns them on create and on read', async () => {
  const r = await upload({ caption: 'my mug', model3d: JSON.stringify({ depth: 0.8, finish: 'metal', tint: '#ff0000', tintAmount: 0.5 }) });
  assert.equal(r.status, 201);
  const m = r.body.post.model3d;
  assert.equal(m.depth, 0.8); assert.equal(m.finish, 'metal'); assert.equal(m.tint, '#ff0000');
  assert.equal(r.body.post.mediaType, 'image');
  const g = await (await fetch(`${base}/${r.body.post.id}`)).json();
  assert.deepEqual(g.post.model3d, m);
});

test('ordinary photo posts have no 3D settings, and bad settings are dropped not stored', async () => {
  let r = await upload({ caption: 'plain' });
  assert.equal(r.body.post.model3d, null);
  r = await upload({ caption: 'junk', model3d: '{{{' });
  assert.equal(r.status, 201); assert.equal(r.body.post.model3d, null);
});

test('replacing the picture of a 3D post turns it back into a normal photo post', async () => {
  const r = await upload({ model3d: '{}' });
  assert.ok(r.body.post.model3d);
  const form = new FormData(); form.append('media', new Blob([PNG], { type: 'image/png' }), 'x.png');
  const rep = await (await fetch(`${base}/${r.body.post.id}/media`, { method: 'POST', headers: auth, body: form })).json();
  assert.equal(rep.post.model3d, null);
});
