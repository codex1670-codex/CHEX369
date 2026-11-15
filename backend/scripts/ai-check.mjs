// Live connection check for every CODEX AI engine, using YOUR real environment variables.
//   npm run ai:check            → text, vision, image, speech-to-text, text-to-speech, memory
//   npm run ai:check -- --video → also tries the experimental video engine (slow; may use free quota)
// Uses a throw-away database, so it never touches your real data. Each real call counts against the free quotas
// (image ≈ 175 neurons of Cloudflare's 10,000/day). Exit code 1 if any enabled engine fails.
import '../src/loadEnv.js';   // backend/.env (optional)
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chex-ai-check-'));
process.env.NEXA_DB_PATH = path.join(tmp, 'check.db');
const { default: db } = await import('../src/db.js');
const { buildCodexAI } = await import('../src/codexai/index.js');

const withVideo = process.argv.includes('--video');
const stack = buildCodexAI({ db, uploadsRoot: path.join(tmp, 'uploads') });
if (withVideo) stack.settings.set('video', { enabled: true });
const { config, codex } = stack;

const mask = (v) => (v ? `set (${String(v).length} chars)` : 'NOT SET');
console.log('\nCODEX AI — live connection check\n');
console.log(`FREE_ONLY_MODE      ${config.freeOnly ? 'ON ✓' : 'OFF ⚠️'}`);
console.log(`Groq endpoint       ${config.groq.baseUrl}   key ${mask(config.groq.apiKey)}`);
console.log(`  text model        ${config.groq.textModel}`);
console.log(`  vision model      ${config.groq.visionModel}`);
console.log(`Cloudflare account  ${mask(config.cloudflare.accountId)}   token ${mask(config.cloudflare.apiToken)}   daily cap ${config.cloudflare.dailyNeuronCap}/10000 neurons`);
console.log(`MongoDB             ${config.mongo.uri ? 'configured' : 'not set (local database is used)'}\n`);

const engines = ['text', 'vision', 'image', 'stt', 'tts', 'memory', ...(withVideo ? ['video'] : [])];
let failed = 0;
for (const e of engines) {
  const r = await codex.selfTest(e, 'ai-check');
  if (!r.ok) failed++;
  console.log(`${r.ok ? '✅' : '❌'} ${e.padEnd(7)} ${String(r.ms).padStart(6)} ms   ${r.detail}`);
}
if (!withVideo) console.log('⏭  video   skipped (experimental). Run with: npm run ai:check -- --video');
console.log(failed ? `\n${failed} engine(s) need attention. See docs/CODEX_AI.md → Troubleshooting.\n` : '\nAll checked engines are working.\n');
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
