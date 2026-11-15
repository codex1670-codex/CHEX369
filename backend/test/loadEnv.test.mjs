import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { parseEnv, loadEnv } = await import('../src/loadEnv.js');

test('parseEnv: KEY=VALUE, comments, quotes, export, blanks', () => {
  assert.deepEqual(parseEnv('# c\n\nA=1\nB = "two words"\nC=\'x\'\nexport D=4 # note\nE=\nbad line\n'), { A: '1', B: 'two words', C: 'x', D: '4', E: '' });
  assert.deepEqual(parseEnv('K=a#b\r\nL=2\r\n'), { K: 'a#b', L: '2' });
});
test('loadEnv: fills missing variables only, never overrides real ones, skips empty values, reports names only', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chex-env-')), '.env');
  fs.writeFileSync(f, 'GROQ_API_KEY=from-file\nCLOUDFLARE_ACCOUNT_ID=acct\nVIDEO_API_KEY=\n');
  const env = { GROQ_API_KEY: 'from-shell' };
  assert.deepEqual(loadEnv(f, env), ['CLOUDFLARE_ACCOUNT_ID']);
  assert.deepEqual(env, { GROQ_API_KEY: 'from-shell', CLOUDFLARE_ACCOUNT_ID: 'acct' });
  assert.deepEqual(loadEnv(path.join(os.tmpdir(), 'does-not-exist.env'), {}), []);
});
