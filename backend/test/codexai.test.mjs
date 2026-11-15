// CODEX AI — router, providers (exact request shapes), free-only guard rails, quotas, memory (SQLite + MongoDB), media,
// streaming chat, uploads, admin. Providers are stubbed: NO real network or API key is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'codexai-'));
process.env.NEXA_DB_PATH = path.join(TMP, 'db.sqlite');
const { default: db } = await import('../src/db.js');
const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { ACCESS_SECRET } = await import('../src/middleware/auth.js');
const { buildCodexAI } = await import('../src/codexai/index.js');
const { aiConfig } = await import('../src/codexai/config.js');
const { routeRequest, memoryProposal, looksLikeAppCommand } = await import('../src/codexai/router.js');
const { createGroq } = await import('../src/codexai/providers/groq.js');
const { createCloudflare } = await import('../src/codexai/providers/cloudflare.js');
const { createVideo } = await import('../src/codexai/providers/pollinations.js');
const { createMongoMemory } = await import('../src/codexai/memory/mongoStore.js');
const { createMemory, validateMemoryText } = await import('../src/codexai/memory/index.js');
const { createAiRouter } = await import('../src/routes/ai.js');
const { createAiAdminRouter } = await import('../src/routes/aiAdmin.js');
const { sniff } = await import('../src/codexai/media.js');
const { ttsLang, promptBlocked } = await import('../src/codexai/orchestrator.js');

for (const [id, name] of [['u-ann', 'ann'], ['u-bob', 'bob'], ['u-admin', 'admin']]) db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)').run(id, name, `${name}@x.com`, 'x', name);
const tok = (id) => jwt.sign({ sub: id }, ACCESS_SECRET);

// ---------- byte fixtures ----------
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 3)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(500, 5)]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(600, 9)]);
const MP4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(2000, 1)]);

// ---------- a fake internet ----------
const SECRET_GROQ = 'SECRET-GROQ-KEY-xyz';
const SECRET_CF = 'SECRET-CF-TOKEN-abc';
const ENV = { GROQ_API_KEY: SECRET_GROQ, CLOUDFLARE_ACCOUNT_ID: 'acct123', CLOUDFLARE_API_TOKEN: SECRET_CF };
function makeNet() {
  const net = { calls: [], groqChunks: ['Hel', 'lo ', 'there'], groqStatus: 200, cfStatus: 200, cfErrors: null, videoStatus: 200, videoType: 'video/mp4' };
  net.fetch = async (url, init = {}) => {
    const u = String(url); const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    net.calls.push({ url: u, init, body });
    if (u.endsWith('/openai/v1/models')) return new Response(JSON.stringify({ object: 'list', data: [{ id: 'openai/gpt-oss-120b' }, { id: 'qwen/qwen3.8-27b' }] }), { status: 200 });
    if (u.endsWith('/openai/v1/chat/completions')) {
      if (net.groqStatus !== 200) return new Response('{"error":{"message":"nope"}}', { status: net.groqStatus });
      const sse = [...net.groqChunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}`), `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'SECRET THOUGHT' } }] })}`, `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 3 } })}`, 'data: [DONE]'].join('\n\n') + '\n\n';
      const bytes = new TextEncoder().encode(sse); const mid = Math.floor(bytes.length / 2);   // split mid-line to prove buffering
      return new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, mid)); c.enqueue(bytes.slice(mid)); c.close(); } }), { status: 200 });
    }
    if (u.includes('api.cloudflare.com')) {
      if (net.cfStatus !== 200) return new Response(JSON.stringify({ success: false, errors: net.cfErrors || [{ code: 1000, message: 'x' }] }), { status: net.cfStatus });
      if (u.includes('flux-1-schnell')) return new Response(JSON.stringify({ success: true, result: { image: JPEG.toString('base64') } }), { status: 200 });
      if (u.includes('whisper')) return new Response(JSON.stringify({ success: true, result: { text: 'draw a blue boat please' } }), { status: 200 });
      if (u.includes('melotts')) return new Response(JSON.stringify({ success: true, result: { audio: MP3.toString('base64') } }), { status: 200 });
    }
    if (u.includes('gen.pollinations.ai/image/')) return new Response(net.videoStatus === 200 ? MP4 : 'x', { status: net.videoStatus, headers: { 'content-type': net.videoType, 'content-length': String(MP4.length) } });
    return new Response('?', { status: 404 });
  };
  return net;
}

// ---------- a stack + server per scenario ----------
let seq = 0; const servers = [];
async function boot({ env = {}, now, memory, adminIds = ['u-admin'] } = {}) {
  const net = makeNet();
  const uploadsRoot = path.join(TMP, `up${seq++}`);
  const stack = buildCodexAI({ db, uploadsRoot, env: { ...ENV, ...env }, fetchImpl: (u, i) => net.fetch(u, i), now, memory });
  for (const tbl of ['ai_usage', 'ai_settings', 'ai_media', 'ai_conversations', 'ai_messages', 'ai_memories']) db.exec(`DELETE FROM ${tbl}`);   // every scenario starts clean
  const app = express(); app.use(express.json({ limit: '2mb' }));
  app.use('/api/ai', createAiRouter({ stack, isAdmin: (id) => adminIds.includes(id) }));
  app.use('/api/admin/ai', createAiAdminRouter({ stack, isAdmin: (id) => adminIds.includes(id) }));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); }); servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (who, method, p, body) => fetch(`${base}${p}`, { method, headers: { Authorization: `Bearer ${tok(who)}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = async (...a) => { const r = await call(...a); return { status: r.status, body: await r.json().catch(() => null) }; };
  const chat = async (who, body) => {                                   // SSE → [{event, data}]
    const r = await call(who, 'POST', '/api/ai/chat', body); const txt = await r.text();
    return { status: r.status, events: txt.split('\n\n').filter((b) => b.startsWith('event:')).map((b) => ({ event: /^event: (.+)$/m.exec(b)[1], data: JSON.parse(/^data: (.+)$/m.exec(b)[1]) })) };
  };
  const upload = async (who, buf, name = 'f.bin') => { const f = new FormData(); f.append('file', new Blob([buf]), name); const r = await fetch(`${base}/api/ai/upload`, { method: 'POST', headers: { Authorization: `Bearer ${tok(who)}` }, body: f }); return { status: r.status, body: await r.json() }; };
  return { net, stack, call, json, chat, upload, base, uploadsRoot };
}
test.after(() => { for (const s of servers) s.close(); });
const ev = (events, name) => events.filter((e) => e.event === name).map((e) => e.data);
const text = (events) => ev(events, 'token').map((t) => t.text).join('');

// =====================================================================================================================
test('router sends each request to the right engine', () => {
  const r = (text, extra = {}) => routeRequest({ text, ...extra }).engine;
  assert.equal(r('Explain how recursion works'), 'text');
  assert.equal(r('what is photosynthesis?'), 'text');                      // not a Google search
  assert.equal(r('write a python function to reverse a list'), 'text');
  assert.equal(r('draw a red fox in the snow'), 'image');
  assert.equal(r('generate an image of a futuristic city'), 'image');
  assert.equal(r('/imagine neon dragon'), 'image');
  assert.equal(r('create a logo for my cafe'), 'image');
  assert.equal(r('make a video of waves on a beach'), 'video');
  assert.equal(r('/video a rocket launch'), 'video');
  assert.equal(r('read this aloud'), 'tts');
  assert.equal(r('/speak hello world'), 'tts');
  assert.equal(r('explain what an image histogram is'), 'text');           // mentions "image" but isn't a request to make one
  assert.equal(r('how do I make a video call on CHEX'), 'text');
  assert.equal(r('open reels'), 'command');
  for (const chatty of ['Tell me about owls', 'who is the prime minister of India', 'write a poem about rain', 'give me tips to study', 'translate hello to Tamil', 'hi again']) assert.equal(r(chatty), 'text', chatty);   // the old parser would call these send_message / create_post …
  for (const risky of ['hi to rahul', 'block ravi', 'create a post hello', 'follow priya']) assert.notEqual(r(risky), 'command', `${risky} must not auto-run`);
  assert.deepEqual([routeRequest({ text: '/do hi to rahul' }).engine, routeRequest({ text: '/do hi to rahul' }).prompt], ['command', 'hi to rahul']);
  assert.equal(r('dark mode'), 'command');
  assert.equal(r('விளக்கு படம் வரை'), 'image');                              // Tamil: "draw a lamp picture"
  assert.equal(r('hello', { attachments: [{ kind: 'image' }] }), 'vision');
  assert.equal(r('', { attachments: [{ kind: 'image' }] }), 'vision');
  assert.equal(r('make a video from this', { attachments: [{ kind: 'image' }] }), 'video');
  assert.equal(r('', { attachments: [{ kind: 'audio' }] }), 'stt');
  assert.equal(r('open reels', { forced: 'chat' }), 'text');               // the person's explicit choice wins
  assert.equal(r('a cat', { forced: 'image' }), 'image');
  assert.equal(r('hello', { forced: 'speak' }), 'tts');
  assert.equal(routeRequest({ text: '/speak Hello there' }).prompt, 'Hello there');
});
test('"remember …" becomes a proposal, never an automatic save', () => {
  assert.equal(memoryProposal('remember that I like chai'), 'I like chai');
  assert.equal(memoryProposal("Please don't forget: my exam is on Friday"), 'my exam is on Friday');
  assert.equal(memoryProposal('what is memory in CPUs?'), null);
  assert.equal(validateMemoryText('my card is 4111 1111 1111 1111').ok, false);
  assert.equal(validateMemoryText('my otp is 482913').ok, false);
  assert.equal(validateMemoryText('I prefer short answers').ok, true);
  assert.equal(validateMemoryText('x').ok, false);
});
test('helpers: command detection, TTS languages, prompt guard, file sniffing', () => {
  assert.equal(looksLikeAppCommand('explain recursion'), false); assert.equal(looksLikeAppCommand('open reels'), true); assert.equal(looksLikeAppCommand('block ravi'), false);
  assert.deepEqual(ttsLang('Hello'), { lang: 'en' }); assert.deepEqual(ttsLang('hola', 'es'), { lang: 'es' }); assert.deepEqual(ttsLang('こんにちは'), { lang: 'jp' });
  assert.equal(ttsLang('வணக்கம்').unsupported, true); assert.equal(ttsLang('नमस्ते').unsupported, true);
  assert.equal(promptBlocked('a nude child'), true); assert.equal(promptBlocked('a child playing with a kite'), false);
  assert.deepEqual([JPEG, PNG, WEBM, MP3, MP4, Buffer.from('plain text file here')].map((b) => sniff(b)?.mime ?? null), ['image/jpeg', 'image/png', 'audio/webm', 'audio/mpeg', 'video/mp4', null]);
});
test('config: FREE_ONLY_MODE is ON by default and Cloudflare cap can never exceed the free allowance', () => {
  assert.equal(aiConfig({}).freeOnly, true);
  assert.equal(aiConfig({ FREE_ONLY_MODE: 'false' }).freeOnly, false);
  assert.equal(aiConfig({ CF_DAILY_NEURON_CAP: '999999' }).cloudflare.dailyNeuronCap, 10_000);
  assert.equal(aiConfig({}).cloudflare.dailyNeuronCap, 8_000);
  assert.equal(aiConfig({ GROQ_BASE_URL: 'https://api.groq.com/openai/v1/' }).groq.baseUrl, 'https://api.groq.com/openai/v1');
  assert.equal(aiConfig({}).groq.baseUrl, 'https://api.groq.com/openai/v1'); assert.equal(aiConfig({}).groq.concurrency, 4);
  assert.deepEqual([aiConfig({}).groq.textModel, aiConfig({}).groq.visionModel], ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b']);
});

// ---------- providers: exact request shapes ----------
test('Groq provider: OpenAI-compatible /chat/completions, Bearer key, images, SSE across chunk boundaries, hidden reasoning, error mapping', async () => {
  const net = makeNet(); const o = createGroq(aiConfig(ENV).groq, net.fetch);
  const out = await o.chat({ model: 'qwen/qwen3.8-27b', messages: [{ role: 'user', content: 'hi', images: ['QUJD'] }] });
  assert.equal(out.text, 'Hello there'); assert.deepEqual(out.usage, { promptTokens: 11, completionTokens: 3 }); assert.ok(!out.text.includes('SECRET THOUGHT'));
  const c = net.calls[0];
  assert.equal(c.url, 'https://api.groq.com/openai/v1/chat/completions'); assert.equal(c.init.headers.Authorization, `Bearer ${SECRET_GROQ}`);
  assert.deepEqual([c.body.model, c.body.stream], ['qwen/qwen3.8-27b', true]);
  assert.equal(c.body.reasoning_effort, 'none', 'Qwen answers without thinking: fast, no reasoning text');
  await o.chat({ model: 'openai/gpt-oss-120b', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(net.calls.at(-1).body.reasoning_effort, 'low');
  await o.chat({ model: 'some/other-model', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(net.calls.at(-1).body.reasoning_effort, undefined);
  assert.equal(c.body.messages[0].images, undefined, 'internal `images` field is converted, never sent as-is');
  assert.deepEqual(c.body.messages[0].content.map((p) => p.type), ['text', 'image_url']);
  assert.equal(c.body.messages[0].content[1].image_url.url, 'data:image/png;base64,QUJD');
  for (const [status, code] of [[401, 'AUTH'], [403, 'AUTH'], [429, 'RATE_LIMIT'], [404, 'MODEL_NOT_FOUND'], [500, 'UPSTREAM']]) {
    net.groqStatus = status; await assert.rejects(() => o.chat({ model: 'm', messages: [] }), (e) => e.code === code, String(status));
  }
  assert.deepEqual(await createGroq(aiConfig(ENV).groq, makeNet().fetch).listModels(), ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b']);
  assert.equal(createGroq(aiConfig({}).groq, net.fetch).configured(), false, 'no key = not configured');
});
test('Cloudflare provider: /ai/run/{model} shapes for image, speech-to-text, text-to-speech, and error mapping', async () => {
  const net = makeNet(); const cf = createCloudflare(aiConfig(ENV).cloudflare, net.fetch);
  const img = await cf.generateImage({ model: '@cf/black-forest-labs/flux-1-schnell', prompt: 'a fox', steps: 4 });
  assert.equal(img.mime, 'image/jpeg');
  assert.equal(net.calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/acct123/ai/run/@cf/black-forest-labs/flux-1-schnell');
  assert.equal(net.calls[0].init.headers.Authorization, `Bearer ${SECRET_CF}`); assert.deepEqual(net.calls[0].body, { prompt: 'a fox', steps: 4 });
  assert.equal((await cf.transcribe({ model: '@cf/openai/whisper-large-v3-turbo', audioBase64: 'QUJD', language: 'en' })).text, 'draw a blue boat please');
  assert.deepEqual(net.calls[1].body, { audio: 'QUJD', language: 'en' });
  const sp = await cf.speak({ model: '@cf/myshell-ai/melotts', text: 'Hi', lang: 'en' }); assert.equal(sp.mime, 'audio/mpeg'); assert.deepEqual(net.calls[2].body, { prompt: 'Hi', lang: 'en' });
  for (const [status, errors, code] of [[401, null, 'AUTH'], [429, [{ code: 3040, message: 'Capacity temporarily exceeded' }], 'RATE_LIMIT'], [400, [{ code: 5006, message: 'bad' }], 'BAD_INPUT'], [429, [{ code: 4006, message: 'you have used all neurons: daily limit exceeded' }], 'QUOTA'], [500, null, 'UPSTREAM']]) {
    net.cfStatus = status; net.cfErrors = errors; await assert.rejects(() => cf.generateImage({ model: 'x', prompt: 'p' }), (e) => e.code === code, `${status} ${code}`);
  }
  assert.equal(createCloudflare(aiConfig({}).cloudflare, net.fetch).configured(), false);
});
test('Video provider: only returns real video, refusals become limitations', async () => {
  const net = makeNet(); const v = createVideo(aiConfig({ VIDEO_API_KEY: 'vk' }).video, net.fetch);
  const out = await v.generate({ prompt: 'a wave', model: 'grok-video', imageUrl: 'https://x.test/u.png' });
  assert.equal(out.mime, 'video/mp4'); const u = new URL(net.calls[0].url);
  assert.equal(u.pathname, '/image/a%20wave'); assert.equal(u.searchParams.get('model'), 'grok-video'); assert.equal(u.searchParams.get('image'), 'https://x.test/u.png');
  assert.equal(net.calls[0].init.headers.Authorization, 'Bearer vk');
  net.videoType = 'image/jpeg'; await assert.rejects(() => v.generate({ prompt: 'p', model: 'm' }), (e) => e.code === 'UPSTREAM'); net.videoType = 'video/mp4';
  for (const [s, code] of [[402, 'PAID_BLOCKED'], [429, 'RATE_LIMIT'], [401, 'AUTH']]) { net.videoStatus = s; await assert.rejects(() => v.generate({ prompt: 'p', model: 'm' }), (e) => e.code === code); }
});

// ---------- the platform, end to end ----------
test('status: every engine reported, and no secret ever reaches the browser', async () => {
  const { json } = await boot();
  const { status, body } = await json('u-ann', 'GET', '/api/ai/status');
  assert.equal(status, 200); assert.equal(body.freeOnly, true);
  assert.deepEqual(body.engines.map((e) => e.engine), ['text', 'vision', 'image', 'video', 'stt', 'tts']);
  assert.equal(body.engines.find((e) => e.engine === 'text').state, 'ready');
  assert.equal(body.engines.find((e) => e.engine === 'video').state, 'disabled');      // experimental → off until an admin enables it
  assert.equal(body.memory.kind, 'sqlite');
  assert.ok(!JSON.stringify(body).includes(SECRET_GROQ) && !JSON.stringify(body).includes(SECRET_CF));
  assert.equal((await boot({ env: { GROQ_API_KEY: '', CLOUDFLARE_API_TOKEN: '' } }).then((b) => b.json('u-ann', 'GET', '/api/ai/status'))).body.engines[0].state, 'not_configured');
  const unauth = await fetch(`${(await boot()).base}/api/ai/status`); assert.equal(unauth.status, 401);
});

test('text chat streams tokens, saves history, and sends the key only to Groq', async () => {
  const { chat, net, json } = await boot();
  const { events } = await chat('u-ann', { text: 'Explain recursion in one line' });
  assert.deepEqual(events.map((e) => e.event).filter((e, i, a) => a.indexOf(e) === i), ['route', 'token', 'usage', 'done']);
  assert.equal(ev(events, 'route')[0].engine, 'text'); assert.equal(text(events), 'Hello there');
  assert.ok(events.filter((e) => e.event === 'token').length >= 3, 'streamed in pieces');
  const up = net.calls.find((c) => c.url.endsWith('/chat/completions'));
  assert.equal(up.body.model, 'openai/gpt-oss-120b'); assert.match(up.body.messages[0].content, /You are CODEX/); assert.equal(up.body.messages.at(-1).content, 'Explain recursion in one line');
  assert.ok(net.calls.every((c) => !/anthropic/i.test(c.url)), 'never touches a paid fallback');
  const convId = ev(events, 'done')[0].conversationId; assert.ok(convId);
  const conv = (await json('u-ann', 'GET', `/api/ai/conversations/${convId}`)).body;
  assert.deepEqual(conv.messages.map((m) => [m.role, m.text]), [['user', 'Explain recursion in one line'], ['assistant', 'Hello there']]);
  // follow-up carries history
  await chat('u-ann', { text: 'and in two lines?', conversationId: convId });
  const second = net.calls.filter((c) => c.url.endsWith('/chat/completions')).at(-1).body.messages;
  assert.deepEqual(second.slice(1, 3).map((m) => m.content), ['Explain recursion in one line', 'Hello there']);
  assert.equal((await json('u-ann', 'GET', '/api/ai/conversations')).body.conversations.length >= 1, true);
});
test('stream:false returns one JSON answer; save:false keeps no history', async () => {
  const { json, call } = await boot();
  const r = await json('u-ann', 'POST', '/api/ai/chat', { text: 'hi', stream: false, save: false });
  assert.equal(r.status, 200); assert.equal(r.body.text, 'Hello there'); assert.equal(r.body.conversationId, null); assert.equal(r.body.route.engine, 'text');
  const before = (await json('u-bob', 'GET', '/api/ai/conversations')).body.conversations.length;
  await call('u-bob', 'POST', '/api/ai/chat', { text: 'temporary', stream: false, save: false });
  assert.equal((await json('u-bob', 'GET', '/api/ai/conversations')).body.conversations.length, before);
  assert.equal((await json('u-ann', 'POST', '/api/ai/chat', { stream: false })).body.error.code, 'BAD_INPUT');
});
test('app commands are handed to the existing Codex engine, not the AI', async () => {
  const { chat, net } = await boot();
  const { events } = await chat('u-ann', { text: 'open reels' });
  assert.deepEqual(ev(events, 'command'), [{ text: 'open reels' }]); assert.equal(net.calls.filter((c) => c.url.endsWith('/chat/completions')).length, 0);
});

test('image generation: Cloudflare call, saved file, usage counted in neurons', async () => {
  const { chat, net, stack, json, uploadsRoot } = await boot();
  const { events } = await chat('u-ann', { text: 'draw a red fox in the snow' });
  assert.equal(ev(events, 'route')[0].engine, 'image');
  const m = ev(events, 'media')[0]; assert.equal(m.kind, 'image'); assert.match(m.url, /^\/uploads\/ai\/u-ann\/.+\.jpg$/);
  assert.ok(fs.statSync(path.join(uploadsRoot, m.url.replace('/uploads/', ''))).size > 100, 'the generated file really exists on disk');
  assert.equal(net.calls.find((c) => c.url.includes('flux')).body.prompt, 'draw a red fox in the snow');
  assert.equal(stack.usage.neuronsToday() >= 175, true);
  assert.equal((await json('u-ann', 'GET', '/api/ai/media?origin=generated')).body.media.some((x) => x.id === m.id), true);
  assert.equal((await json('u-ann', 'DELETE', `/api/ai/media/${m.id}`)).status, 200);
  assert.equal((await json('u-bob', 'DELETE', `/api/ai/media/${m.id}`)).status, 404);
  const blocked = await chat('u-ann', { text: 'generate an image of a nude child' }); assert.equal(ev(blocked.events, 'error')[0].code, 'BAD_INPUT');
});

test('uploads are validated by content; vision reads an attached picture', async () => {
  const { upload, chat, net } = await boot();
  assert.equal((await upload('u-ann', Buffer.from('just some text, not a picture at all'))).status, 400);
  const up = await upload('u-ann', PNG, 'evil.txt'); assert.equal(up.status, 201); assert.equal(up.body.media.mime, 'image/png');
  const { events } = await chat('u-ann', { text: 'What is this?', attachmentIds: [up.body.media.id] });
  assert.equal(ev(events, 'route')[0].engine, 'vision');
  const body = net.calls.find((c) => c.url.endsWith('/chat/completions')).body;
  assert.equal(body.model, 'qwen/qwen3.8-27b'); assert.equal(body.messages.at(-1).content.find((x) => x.type === 'image_url').image_url.url, `data:image/png;base64,${PNG.toString('base64')}`);
  assert.equal(ev((await chat('u-bob', { text: 'x', attachmentIds: [up.body.media.id] })).events, 'error')[0].code, 'BAD_INPUT', "can't use someone else's file");
});

test('audio: a voice message is transcribed then routed; the mic endpoint returns text; text-to-speech makes audio', async () => {
  const { upload, chat, json, call, net } = await boot();
  const rec = await upload('u-ann', WEBM); assert.equal(rec.body.media.kind, 'audio');
  const { events } = await chat('u-ann', { attachmentIds: [rec.body.media.id] });
  assert.equal(ev(events, 'transcript')[0].text, 'draw a blue boat please');
  assert.deepEqual(ev(events, 'route').map((r) => r.engine), ['stt', 'image']);                      // heard it, then routed the transcript
  assert.equal(net.calls.find((c) => c.url.includes('whisper')).body.audio, WEBM.toString('base64'));
  const rec2 = await upload('u-ann', WEBM); const t = await json('u-ann', 'POST', '/api/ai/transcribe', { attachmentId: rec2.body.media.id });
  assert.equal(t.body.text, 'draw a blue boat please');
  assert.equal((await json('u-ann', 'GET', '/api/ai/media?origin=upload')).body.media.some((m) => m.id === rec2.body.media.id), false, 'mic recording is discarded after transcription');
  const sp = await chat('u-ann', { text: '/speak Hello from CHEX' }); const a = ev(sp.events, 'media')[0]; assert.equal(a.kind, 'audio');
  assert.equal(net.calls.find((c) => c.url.includes('melotts')).body.prompt, 'Hello from CHEX');
  const ta = await chat('u-ann', { text: '/speak வணக்கம் நண்பா' }); const err = ev(ta.events, 'error')[0];
  assert.equal(err.fallback, 'browser-speech'); assert.match(err.message, /English, Spanish, French, Japanese and Korean/);
  void call;
});

test('memory: proposals are never saved automatically; only approved facts reach the AI; secrets are refused; isolation per user', async () => {
  const { chat, json, net } = await boot();
  const before = net.calls.length;
  const { events } = await chat('u-ann', { text: 'remember that I prefer short answers' });
  assert.deepEqual(ev(events, 'memory_proposal'), [{ text: 'I prefer short answers' }]);
  assert.equal(net.calls.length, before, 'no AI call is spent on a memory command');
  assert.equal((await json('u-ann', 'GET', '/api/ai/memory')).body.memories.length, 0, 'nothing saved until the person approves');
  assert.equal((await json('u-ann', 'POST', '/api/ai/memory', { text: 'I prefer short answers', source: 'chat' })).status, 201);
  assert.equal((await json('u-ann', 'POST', '/api/ai/memory', { text: 'my password is hunter2 and card 4111 1111 1111 1111' })).status, 400);
  await chat('u-ann', { text: 'Tell me about owls' });
  assert.match(net.calls.filter((c) => c.url.endsWith('/chat/completions')).at(-1).body.messages[0].content, /I prefer short answers/);
  await chat('u-bob', { text: 'Tell me about owls' });
  assert.doesNotMatch(net.calls.filter((c) => c.url.endsWith('/chat/completions')).at(-1).body.messages[0].content, /short answers/);
  const id = (await json('u-ann', 'GET', '/api/ai/memory')).body.memories[0].id;
  assert.equal((await json('u-bob', 'DELETE', `/api/ai/memory/${id}`)).status, 404);
  assert.equal((await json('u-ann', 'DELETE', `/api/ai/memory/${id}`)).status, 200);
  const conv = (await json('u-ann', 'GET', '/api/ai/conversations')).body.conversations[0];
  assert.equal((await json('u-bob', 'GET', `/api/ai/conversations/${conv.id}`)).status, 404, "nobody reads another person's chats");
  assert.equal((await json('u-ann', 'DELETE', '/api/ai/data')).status, 200);
  assert.equal((await json('u-ann', 'GET', '/api/ai/conversations')).body.conversations.length, 0);
});

// ---------- FREE-ONLY guard rails ----------
test('quotas: per-user daily limit, resets on the next UTC day, and the provider is not called once the limit is reached', async () => {
  let clock = new Date('2026-11-15T10:00:00Z');
  const { chat, net, stack } = await boot({ now: () => clock });
  stack.settings.set('text', { perUserDaily: 2 });
  await chat('u-ann', { text: 'one', save: false }); await chat('u-ann', { text: 'two', save: false });
  const calls = net.calls.length;
  const r = await chat('u-ann', { text: 'three', save: false }); const e = ev(r.events, 'error')[0];
  assert.equal(e.limitation, true); assert.match(e.message, /free daily limit for Text AI \(2 a day\).*00:00 UTC/); assert.equal(net.calls.length, calls);
  assert.equal(ev((await chat('u-bob', { text: 'bob can still chat', save: false })).events, 'error').length, 0, 'limits are per person');
  clock = new Date('2026-11-16T00:00:01Z');
  assert.equal(ev((await chat('u-ann', { text: 'new day', save: false })).events, 'error').length, 0);
});
test('Cloudflare neuron cap: CHEX stops itself below the free daily allowance and says why', async () => {
  const { chat, net, stack } = await boot({ env: { CF_DAILY_NEURON_CAP: '300', CF_NEURONS_PER_IMAGE: '175' } });
  stack.settings.set('image', { perUserDaily: 50, globalDaily: 50 });
  assert.equal(ev((await chat('u-ann', { text: 'draw a cat', save: false })).events, 'media').length, 1);
  const calls = net.calls.length;
  const r = await chat('u-ann', { text: 'draw a dog', save: false }); const e = ev(r.events, 'error')[0];
  assert.match(e.message, /free Cloudflare allowance .* used up \(175 of 300 neurons\).*00:00 UTC/); assert.equal(net.calls.length, calls);
  assert.equal(ev((await chat('u-ann', { text: '/speak hi', save: false })).events, 'media').length, 1, 'cheap engines keep working while the budget allows');
});
test('provider "slow down" answers pause that provider, show a plain limitation, and can be cleared by the admin', async () => {
  const { chat, net, json } = await boot();
  net.groqStatus = 429;
  const e1 = ev((await chat('u-ann', { text: 'hi', save: false })).events, 'error')[0]; assert.equal(e1.code, 'RATE_LIMIT'); assert.match(e1.message, /free usage limit.*not unlimited/);
  const calls = net.calls.length; net.groqStatus = 200;
  const e2 = ev((await chat('u-ann', { text: 'hi again', save: false })).events, 'error')[0]; assert.equal(e2.limitation, true); assert.equal(net.calls.length, calls, 'paused: upstream is not hammered');
  assert.equal(ev((await chat('u-ann', { text: 'x', save: false, engine: 'chat' })).events, 'error').length, 1);
  assert.equal((await json('u-admin', 'POST', '/api/admin/ai/engines/text/reset', {})).status, 200);
  assert.equal(ev((await chat('u-ann', { text: 'works again', save: false })).events, 'error').length, 0);
});
test('a failing Text AI shows an error — it never silently switches to another (paid) provider', async () => {
  const { chat, net } = await boot();
  net.groqStatus = 500;
  const r = await chat('u-ann', { text: 'hello' }); assert.equal(ev(r.events, 'error')[0].code, 'UPSTREAM');
  assert.ok(net.calls.every((c) => /api\.groq\.com/.test(c.url)));
});
test('invalid keys are explained to admins, hidden from everyone else', async () => {
  const { chat, net } = await boot({ adminIds: ['u-admin'] });
  net.groqStatus = 401;
  assert.match(ev((await chat('u-ann', { text: 'hi', save: false })).events, 'error')[0].message, /unavailable right now/);
  const { net: net2, chat: chat2 } = await boot({ adminIds: ['u-admin'] }); net2.groqStatus = 401;
  assert.match(ev((await chat2('u-admin', { text: 'hi', save: false })).events, 'error')[0].message, /rejected the API key/);
});
test('video is experimental: off by default; FREE_ONLY allows only the approved free model; works when enabled', async () => {
  const a = await boot(); assert.match(ev((await a.chat('u-ann', { text: 'make a video of a calm sea', save: false })).events, 'error')[0].message, /switched off by the admin/);
  const b = await boot({ env: { VIDEO_MODEL: 'veo' } }); b.stack.settings.set('video', { enabled: true });
  assert.match(ev((await b.chat('u-ann', { text: 'make a video of a calm sea', save: false })).events, 'error')[0].message, /paid plan.*free-only mode/);
  assert.equal(b.net.calls.filter((c) => c.url.includes('pollinations')).length, 0);
  assert.equal(b.stack.settings.set('video', { model: 'veo' }).ok, false);
  const c = await boot(); c.stack.settings.set('video', { enabled: true });
  const r = await c.chat('u-ann', { text: 'make a video of a calm sea', save: false }); assert.equal(ev(r.events, 'media')[0].kind, 'video');
  const up = await c.upload('u-ann', PNG); const i2v = await c.chat('u-ann', { text: 'animate this', attachmentIds: [up.body.media.id], save: false });
  assert.match(ev(i2v.events, 'error')[0].message, /PUBLIC_BASE_URL/);
  const d = await boot({ env: { PUBLIC_BASE_URL: 'https://chex.example' } }); d.stack.settings.set('video', { enabled: true });
  const up2 = await d.upload('u-ann', PNG); await d.chat('u-ann', { text: 'animate this', attachmentIds: [up2.body.media.id], save: false });
  assert.match(new URL(d.net.calls.find((x) => x.url.includes('pollinations')).url).searchParams.get('image'), /^https:\/\/chex\.example\/uploads\/ai\/u-ann\//);
});
test('engines not configured / disabled give plain limitations and make no network calls', async () => {
  const { chat, net, stack } = await boot({ env: { GROQ_API_KEY: '', CLOUDFLARE_ACCOUNT_ID: '' } });
  assert.match(ev((await chat('u-ann', { text: 'hello', save: false })).events, 'error')[0].message, /isn't set up on this server yet/);
  assert.match(ev((await chat('u-ann', { text: 'draw a cat', save: false })).events, 'error')[0].message, /isn't set up/);
  assert.equal(net.calls.length, 0);
  stack.settings.set('tts', { enabled: false });
  assert.match(ev((await chat('u-ann', { text: '/speak hi', save: false })).events, 'error')[0].message, /switched off/);
});
test('with GROQ_CONCURRENCY=1, extra requests queue instead of failing', async () => {
  const { chat, net } = await boot({ env: { GROQ_CONCURRENCY: '1' } });
  let active = 0, peak = 0; const orig = net.fetch;
  net.fetch = async (u, i) => {
    if (!String(u).endsWith('/chat/completions')) return orig(u, i);
    active++; peak = Math.max(peak, active); const r = await orig(u, i);
    await new Promise((res) => setTimeout(res, 30));          // hold the "connection" a moment
    const body = await r.text(); active--; return new Response(body, { status: r.status });
  };
  const results = await Promise.all([1, 2, 3].map((n) => chat('u-ann', { text: `question ${n}`, save: false })));
  assert.equal(results.every((r) => ev(r.events, 'error').length === 0 && text(r.events) === 'Hello there'), true);
  assert.equal(peak, 1, 'never more than one request in flight at the provider');
});
test('a down MongoDB never breaks chat: CODEX answers and warns that history is not saved', async () => {
  const dead = { kind: 'mongodb', status: async () => ({ kind: 'mongodb', ok: false }) };
  const stub = new Proxy(dead, { get: (t, k) => (k in t ? t[k] : async () => { throw new Error('Mongo down'); }) });
  const { chat, json } = await boot({ memory: stub });
  const { events } = await chat('u-ann', { text: 'hello' });
  assert.equal(text(events), 'Hello there'); assert.match(ev(events, 'warning')[0].message, /history couldn’t be saved/);
  assert.equal((await json('u-ann', 'GET', '/api/ai/conversations')).status, 503);
});

// ---------- MongoDB memory (against a faithful in-memory fake of the driver calls we use) ----------
function fakeMongoDb() {
  const cols = {};
  const match = (d, f) => Object.entries(f).every(([k, v]) => d[k] === v);
  const col = (name) => cols[name] ||= (() => { const docs = [];
    return {
      docs, createIndex: async () => 'ok', insertOne: async (d) => { docs.push({ ...d }); return { insertedId: d._id }; },
      findOne: async (f) => docs.find((d) => match(d, f)) || null,
      find: (f) => { let r = docs.filter((d) => match(d, f)); const c = { sort: (s) => { const [[k, dir]] = Object.entries(s); r = [...r].sort((a, b) => (a[k] < b[k] ? -dir : a[k] > b[k] ? dir : 0)); return c; }, limit: (n) => { r = r.slice(0, n); return c; }, toArray: async () => r }; return c; },
      updateOne: async (f, u) => { const d = docs.find((x) => match(x, f)); if (d) Object.assign(d, u.$set); return { matchedCount: d ? 1 : 0 }; },
      deleteOne: async (f) => { const i = docs.findIndex((x) => match(x, f)); if (i >= 0) docs.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
      deleteMany: async (f) => { let n = 0; for (let i = docs.length - 1; i >= 0; i--) if (match(docs[i], f)) { docs.splice(i, 1); n++; } return { deletedCount: n }; },
    }; })();
  return { collection: col, cols };
}
test('MongoDB memory store: conversations, messages and approved memories, isolated per user', async () => {
  const fake = fakeMongoDb(); const m = createMongoMemory(fake);
  assert.deepEqual(await m.status(), { kind: 'mongodb', ok: true });
  const c = await m.createConversation('u1', { title: 'Hello' });
  await m.appendMessage('u1', c.id, { role: 'user', text: 'hi' }); await m.appendMessage('u1', c.id, { role: 'assistant', text: 'hello', engine: 'text', media: [{ id: 'm1' }] });
  assert.equal(await m.appendMessage('u2', c.id, { role: 'user', text: 'intruder' }), null, 'cannot write into someone else’s chat');
  const got = await m.getConversation('u1', c.id); assert.deepEqual(got.messages.map((x) => x.text), ['hi', 'hello']); assert.equal(got.messages[1].media[0].id, 'm1');
  assert.equal(await m.getConversation('u2', c.id), null); assert.equal((await m.recentMessages('u1', c.id, 1)).length, 1);
  assert.equal((await m.listConversations('u1')).length, 1); assert.equal((await m.listConversations('u2')).length, 0);
  assert.equal(await m.renameConversation('u1', c.id, 'Renamed'), true); assert.equal((await m.listConversations('u1'))[0].title, 'Renamed');
  const mem = await m.addMemory('u1', 'likes chai', 'user'); assert.equal((await m.listMemories('u1')).length, 1);
  assert.equal(await m.deleteMemory('u2', mem.id), false); assert.equal(await m.deleteMemory('u1', mem.id), true);
  assert.equal(await m.deleteConversation('u2', c.id), false); assert.equal(await m.deleteConversation('u1', c.id), true); assert.equal(fake.cols.codex_messages.docs.length, 0);
  await m.addMemory('u1', 'a', 'user'); await m.deleteAll('u1'); assert.equal((await m.listMemories('u1')).length, 0);
});
test('with MONGODB_URI set, the platform uses MongoDB for history and memory', async () => {
  const fake = fakeMongoDb();
  const memory = createMemory({ db, config: aiConfig({ MONGODB_URI: 'mongodb://example' }), mongoDbFactory: async () => ({ db: fake }) });
  const { chat, json } = await boot({ memory });
  assert.equal((await json('u-ann', 'GET', '/api/ai/status')).body.memory.kind, 'mongodb');
  const { events } = await chat('u-ann', { text: 'hello mongo' });
  assert.equal(fake.cols.codex_messages.docs.length, 2); assert.equal(text(events), 'Hello there');
  await json('u-ann', 'POST', '/api/ai/memory', { text: 'I live in Vaniyambadi' }); assert.equal(fake.cols.codex_memories.docs.length, 1);
});

// ---------- admin ----------
test('admin dashboard: master only, shows provider/model/usage state without secrets, validates edits, runs live tests', async () => {
  const { json, chat, net } = await boot();
  assert.equal((await json('u-ann', 'GET', '/api/admin/ai/overview')).status, 403);
  assert.equal((await json('u-ann', 'PUT', '/api/admin/ai/engines/text', { enabled: false })).status, 403);
  await chat('u-ann', { text: 'draw a cat', save: false });
  const o = (await json('u-admin', 'GET', '/api/admin/ai/overview')).body;
  assert.equal(o.freeOnly, true); assert.equal(o.providers.cloudflare.chexDailyCap, 8000); assert.ok(o.providers.cloudflare.neuronsUsedToday >= 175);
  assert.deepEqual([o.providers.groq.keySet, o.providers.cloudflare.tokenSet], [true, true]);
  assert.ok(!JSON.stringify(o).includes(SECRET_GROQ) && !JSON.stringify(o).includes(SECRET_CF));
  assert.equal(o.engines.find((e) => e.engine === 'image').usageToday.requests >= 1, true); assert.equal(o.usage.topUsers[0].username, 'ann');
  assert.equal((await json('u-admin', 'PUT', '/api/admin/ai/engines/text', { model: 'openai/gpt-oss-20b', perUserDaily: 7 })).body.engine.model, 'openai/gpt-oss-20b');
  await chat('u-ann', { text: 'hi', save: false }); assert.equal(net.calls.filter((c) => c.url.endsWith('/chat/completions')).at(-1).body.model, 'openai/gpt-oss-20b');
  for (const bad of [{ model: 'rm -rf /' }, { perUserDaily: -1 }, { perUserDaily: 1.5 }, { enabled: 'yes' }]) assert.equal((await json('u-admin', 'PUT', '/api/admin/ai/engines/text', bad)).status, 400);
  assert.equal((await json('u-admin', 'PUT', '/api/admin/ai/engines/nope', { enabled: true })).status, 404);
  for (const e of ['text', 'vision', 'image', 'stt', 'tts', 'memory']) { const t = (await json('u-admin', 'POST', `/api/admin/ai/engines/${e}/test`, {})).body; assert.equal(t.ok, true, `${e}: ${t.detail}`); }
  assert.deepEqual((await json('u-admin', 'GET', '/api/admin/ai/groq-models')).body.models, ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b']);
  net.groqStatus = 401; const failing = (await json('u-admin', 'POST', '/api/admin/ai/engines/text/test', {})).body; assert.equal(failing.ok, false); assert.match(failing.detail, /rejected the API key/);
});
