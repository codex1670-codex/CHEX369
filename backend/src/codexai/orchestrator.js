// CODEX — the orchestrator. One entry point (`handle`) that routes a request to the right engine, enforces the free-only
// policy and quotas, streams the answer, remembers the conversation (if the person wants), and reports usage.
//
// Free-only rules enforced here (and nowhere bypassed):
//   • every engine call passes `gate()`: enabled → configured → free-model check → per-user / global / neuron limits
//   • provider refusals become plain limitations; there is NO fallback to any other (paid) provider — including Anthropic
//   • CHEX never buys credits; Cloudflare use is capped below the free daily allowance by CHEX's own counter
import { AiError, friendly } from './errors.js';
import { ENGINES, CLOUDFLARE_ENGINES } from './engines.js';
import { routeRequest, memoryProposal } from './router.js';
import { createLimiter } from './limiter.js';
import { validateMemoryText } from './memory/index.js';

const NAME_PROVIDER = { groq: ['text', 'vision'], cloudflare: CLOUDFLARE_ENGINES, pollinations: ['video'] };
const clip = (s, n) => String(s ?? '').trim().slice(0, n);

// Tiny valid inputs for the admin "test connection" button.
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const silentWav = () => { const n = 8000, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; };

// MeloTTS speaks English, Spanish, French, Japanese and Korean. Anything else is reported honestly (the browser can read it aloud for free).
export function ttsLang(text, hint = '') {
  if (/[\u3040-\u30ff]/.test(text)) return { lang: 'jp' };
  if (/[\uac00-\ud7af]/.test(text)) return { lang: 'kr' };
  if (/[\u0900-\u0dff\u0600-\u06ff\u4e00-\u9fff\u0400-\u04ff]/.test(text)) return { unsupported: true };
  const h = String(hint).slice(0, 2).toLowerCase();
  return { lang: ['es', 'fr'].includes(h) ? h : 'en' };
}
const BLOCKED_PROMPT = /\b(child|children|kid|minor|teen(ager)?|underage|schoolgirl|schoolboy|loli\w*)\b[\s\S]{0,60}\b(nude|naked|nsfw|sexual|porn\w*|explicit)\b|\b(nude|naked|nsfw|sexual|porn\w*|explicit)\b[\s\S]{0,60}\b(child|children|kid|minor|teen(ager)?|underage|schoolgirl|schoolboy|loli\w*)\b/i;
export const promptBlocked = (p) => BLOCKED_PROMPT.test(String(p || ''));

export function createCodexAI({ config, settings, usage, memory, media, providers, parse, now = () => new Date() }) {
  const limiters = {
    groq: createLimiter(config.groq.concurrency), cloudflare: createLimiter(config.cloudflare.concurrency), pollinations: createLimiter(config.video.concurrency),
  };
  const providerOf = (engine) => ENGINES[engine].provider;
  const impl = (engine) => ({ groq: providers.groq, cloudflare: providers.cloudflare, pollinations: providers.video })[providerOf(engine)];
  const group = (engine) => NAME_PROVIDER[providerOf(engine)];
  const label = (engine) => ENGINES[engine]?.label || 'CODEX';

  // ---------- status ----------
  function engineState(engine, userId) {
    const s = settings.get(engine);
    const configured = !!impl(engine)?.configured();
    const cd = usage.cooldownOf(engine);
    const rem = usage.remaining(engine, userId);
    let state = 'ready'; let message = '';
    if (!s.enabled) { state = 'disabled'; message = `${s.label} is switched off by the admin.`; }
    else if (!configured) { state = 'not_configured'; message = `${s.label} isn't set up on this server yet.`; }
    else if (config.freeOnly && engine === 'video' && !config.video.freeModels.includes(s.model)) { state = 'not_configured'; message = 'Video model is not on the free list.'; }
    else if (cd) { state = 'cooldown'; message = `${s.label} hit its free limit. Trying again after ${new Date(cd.until).toISOString().slice(11, 16)} UTC.`; }
    else if (rem.perUser <= 0) { state = 'limit_reached'; message = `Your free daily limit for ${s.label} is used up. Resets 00:00 UTC.`; }
    else if (rem.global <= 0) { state = 'limit_reached'; message = `${s.label} reached CHEX's shared free limit today. Resets 00:00 UTC.`; }
    else if (CLOUDFLARE_ENGINES.includes(engine) && usage.neuronsToday() >= config.cloudflare.dailyNeuronCap) { state = 'limit_reached'; message = 'Today’s free Cloudflare allowance is used up. Resets 00:00 UTC.'; }
    return { engine, label: s.label, what: ENGINES[engine].what, provider: s.provider, model: s.model, enabled: s.enabled, configured, experimental: s.experimental, state, message, remaining: rem, limits: { perUserDaily: s.perUserDaily, globalDaily: s.globalDaily } };
  }
  async function status(userId) {
    return { freeOnly: config.freeOnly, engines: Object.keys(ENGINES).map((e) => engineState(e, userId)), memory: await memory.status(), notice: 'Free plans are limited and can change; CODEX never uses paid services.' };
  }

  // ---------- gate + execute ----------
  function gate(engine, userId, estUnits = 0) {
    const s = settings.get(engine);
    const fail = (code, message) => { usage.record({ userId, engine, provider: providerOf(engine), model: s.model, status: 'blocked', errorCode: code }); throw new AiError(code, message || code); };
    if (!s.enabled) fail('DISABLED');
    if (!impl(engine)?.configured()) fail('NOT_CONFIGURED');
    if (config.freeOnly && engine === 'video' && !config.video.freeModels.includes(s.model)) fail('PAID_BLOCKED');
    const c = usage.check({ engine, userId, estUnits });
    if (!c.ok) {
      if (c.code === 'DISABLED') fail('DISABLED');
      if (c.code === 'RATE_LIMIT') fail('RATE_LIMIT');
      fail('LIMIT', c.message);
    }
    return s;
  }

  async function exec(engine, userId, { estUnits = 0, run, unitsOf }) {
    const s = gate(engine, userId, estUnits);
    const provider = providerOf(engine); const t0 = Date.now();
    try {
      const out = await limiters[provider].run(() => run(s.model));
      usage.record({ userId, engine, provider, model: s.model, status: 'ok', units: unitsOf ? unitsOf(out) : estUnits, ms: Date.now() - t0 });
      return out;
    } catch (e) {
      const code = e?.code || (e?.name === 'AbortError' ? 'ABORTED' : 'UPSTREAM');
      if (code !== 'ABORTED') usage.record({ userId, engine, provider, model: s.model, status: code === 'BUSY' ? 'blocked' : 'error', ms: Date.now() - t0, errorCode: code });
      // A provider said "slow down" or "that's your free allowance": pause that provider (not forever) and show the limitation.
      if (code === 'QUOTA') for (const g of group(engine)) usage.coolUntilMidnight(g, code);
      else if (code === 'RATE_LIMIT') {
        const minutes = provider === 'groq' ? 2 : provider === 'pollinations' ? 10 : 2;
        for (const g of group(engine)) usage.setCooldown(g, { untilMs: now().getTime() + (e.retryAfterSec ? e.retryAfterSec / 60 : minutes) * 60_000, reason: code });
      }
      if (code === 'AUTH') console.error(`[codexai] ${engine}: provider rejected the API key`);
      else if (!['ABORTED', 'BUSY', 'RATE_LIMIT', 'QUOTA', 'LIMIT'].includes(code)) console.error(`[codexai] ${engine} failed: ${code}`);
      throw e;
    }
  }

  // ---------- engine runners ----------
  const SYSTEM = (memFacts, language) => [
    'You are CODEX, the built-in AI assistant of CHEX, a social app for chatting, sharing, games and learning.',
    'Be accurate, friendly and concise unless asked for detail. Use plain text; short lists and code blocks are fine.',
    language ? `Reply in ${language}.` : "Reply in the user's own language.",
    "You cannot post, message people or change settings from this chat. You cannot save memories yourself: when the user asks you to remember something, the app asks them to confirm. Never ask for passwords, card numbers or one-time codes. If you don't know, say so.",
    memFacts.length ? `Things the user chose to have you remember:\n${memFacts.map((f) => `- ${f}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');

  async function memoryFacts(userId, enabled) {
    if (!enabled) return [];
    try {
      const out = []; let used = 0;
      for (const m of await memory.listMemories(userId)) { if (out.length >= config.memory.maxFacts || used + m.text.length > config.memory.promptChars) break; out.push(m.text); used += m.text.length; }
      return out;
    } catch { return []; }
  }

  async function runChat({ engine, user, text, images, history, language, memEnabled, emit, signal }) {
    const facts = await memoryFacts(user.id, memEnabled);
    const msgs = [{ role: 'system', content: SYSTEM(facts, language) }];
    let budget = 6000;
    for (const h of [...history].reverse()) { if (h.error || !h.text) continue; const t = clip(h.text, 1500); if ((budget -= t.length) < 0) break; msgs.splice(1, 0, { role: h.role === 'assistant' ? 'assistant' : 'user', content: t }); }
    msgs.push({ role: 'user', content: text, ...(images.length ? { images } : {}) });
    let full = '';
    await exec(engine, user.id, {
      unitsOf: (o) => o.tokens,
      run: async (model) => {
        let tokens = 0;
        for await (const ev of providers.groq.streamChat({ model, messages: msgs, signal, maxTokens: 1500 })) {
          if (signal?.aborted) break;
          if (ev.type === 'token') { full += ev.text; emit('token', { text: ev.text }); }
          if (ev.type === 'done') tokens = ev.usage.completionTokens + ev.usage.promptTokens;
        }
        return { tokens };
      },
    });
    if (!full.trim() && !signal?.aborted) throw new AiError('UPSTREAM', 'empty reply');
    return { text: full.trim() };
  }

  async function runImage({ user, prompt, conversationId, emit }) {
    if (!prompt) throw new AiError('BAD_INPUT', 'Tell me what to draw, e.g. "a red fox in the snow".');
    if (promptBlocked(prompt)) throw new AiError('BAD_INPUT', "I can't create that image.");
    const out = await exec('image', user.id, { estUnits: config.cloudflare.neuronsPerImage, run: (model) => providers.cloudflare.generateImage({ model, prompt: clip(prompt, 1000), steps: 4 }) });
    const m = media.save({ userId: user.id, bytes: out.bytes, mime: out.mime, kind: 'image', origin: 'generated', ext: out.mime === 'image/png' ? 'png' : out.mime === 'image/webp' ? 'webp' : 'jpg', prompt, engine: 'image', model: settings.get('image').model, conversationId });
    emit('media', m);
    return { text: `Here is your image: “${clip(prompt, 120)}”.`, media: [m] };
  }

  async function runVideo({ user, prompt, attachments, conversationId, emit }) {
    if (!prompt) throw new AiError('BAD_INPUT', 'Describe the video you want, e.g. "waves rolling onto a beach at sunset".');
    if (promptBlocked(prompt)) throw new AiError('BAD_INPUT', "I can't create that video.");
    const img = attachments.find((a) => a.kind === 'image');
    let imageUrl;
    if (img) {
      if (!config.video.publicBaseUrl) throw new AiError('BAD_INPUT', 'Image-to-video needs the server to have a public web address (PUBLIC_BASE_URL). Text-to-video is still available.');
      imageUrl = `${config.video.publicBaseUrl}${img.url}`;
    }
    const out = await exec('video', user.id, { estUnits: 1, run: (model) => providers.video.generate({ prompt: clip(prompt, 600), model, imageUrl }) });
    const m = media.save({ userId: user.id, bytes: out.bytes, mime: out.mime, kind: 'video', origin: 'generated', ext: 'mp4', prompt, engine: 'video', model: settings.get('video').model, conversationId });
    emit('media', m);
    return { text: `Here is your video: “${clip(prompt, 120)}”. (Experimental free video — results and availability vary.)`, media: [m] };
  }

  async function runSpeak({ user, text, language, conversationId, emit }) {
    const t = clip(text, 1000);
    if (!t) throw new AiError('BAD_INPUT', 'Tell me what to read aloud, e.g. "/speak Hello from CHEX".');
    const l = ttsLang(t, language);
    if (l.unsupported) throw new AiError('BAD_INPUT', 'My voice engine speaks English, Spanish, French, Japanese and Korean. For other languages, use your device’s read-aloud instead.', { fallback: 'browser-speech' });
    const out = await exec('tts', user.id, { estUnits: Math.max(1, Math.ceil((t.length / 900) * 18.63)), run: (model) => providers.cloudflare.speak({ model, text: t, lang: l.lang }) });
    const m = media.save({ userId: user.id, bytes: out.bytes, mime: out.mime, kind: 'audio', origin: 'generated', ext: 'mp3', prompt: t, engine: 'tts', model: settings.get('tts').model, conversationId });
    emit('media', m);
    return { text: 'Here is the audio.', media: [m] };
  }

  async function runTranscribe({ user, audio, language }) {
    const data = media.read(user.id, audio.id); if (!data) throw new AiError('BAD_INPUT', 'That recording is no longer available.');
    const est = Math.ceil(46 * Math.max(0.2, data.bytes.length / 240_000));
    const out = await exec('stt', user.id, { estUnits: est, run: (model) => providers.cloudflare.transcribe({ model, audioBase64: data.bytes.toString('base64'), language: /^[a-z]{2}$/i.test(language || '') ? language.toLowerCase() : undefined }) });
    return out.text;
  }

  // ---------- the request ----------
  const parseBody = (b) => {
    const body = b && typeof b === 'object' ? b : {};
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length > 4000) return { ok: false, error: 'That message is too long (4000 characters max).' };
    const ids = Array.isArray(body.attachmentIds) ? body.attachmentIds.filter((x) => typeof x === 'string').slice(0, 4) : [];
    if (!text && !ids.length) return { ok: false, error: 'Type a message or attach something.' };
    const forced = ['auto', 'chat', 'image', 'video', 'speak'].includes(body.engine) ? body.engine : 'auto';
    return { ok: true, text, ids, forced, conversationId: typeof body.conversationId === 'string' ? body.conversationId : null, save: body.save !== false, language: typeof body.language === 'string' && /^[\p{L} ()-]{2,30}$/u.test(body.language) ? body.language : '' };
  };

  async function handle({ user, body, emit, signal }) {
    const p = parseBody(body);
    if (!p.ok) { emit('error', { code: 'BAD_INPUT', message: p.error }); return; }

    const attachments = [];
    for (const id of p.ids) { const m = media.get(user.id, id); if (!m) { emit('error', { code: 'BAD_INPUT', message: 'One of the attachments is no longer available.' }); return; } attachments.push(m); }

    let warned = false;
    const safe = async (fn, fallback) => { try { return await fn(); } catch { if (!warned) { warned = true; emit('warning', { message: 'Your chat history couldn’t be saved or loaded right now (memory service unavailable). CODEX still works.' }); } return fallback; } };

    let convId = null; let history = [];
    if (p.save) {
      if (p.conversationId) { history = await safe(() => memory.recentMessages(user.id, p.conversationId, 10), []); if (history.length || (await safe(() => memory.getConversation(user.id, p.conversationId), null))) convId = p.conversationId; }
    }

    let text = p.text; let route = routeRequest({ text, attachments, forced: p.forced, parse });
    let engineUsed = route.engine;
    try {
      emit('route', { engine: route.engine, label: route.label, reason: route.reason });

      if (route.engine === 'stt') {
        const audio = attachments.find((a) => a.kind === 'audio');
        const heard = await runTranscribe({ user, audio, language: p.language });
        emit('transcript', { text: heard });
        if (!heard) throw new AiError('BAD_INPUT', 'I couldn’t hear any speech in that recording.');
        text = [heard, text].filter(Boolean).join(' ').trim();
        const rest = attachments.filter((a) => a.kind !== 'audio');
        route = routeRequest({ text, attachments: rest, forced: p.forced, parse });
        emit('route', { engine: route.engine, label: route.label, reason: `I heard: “${clip(heard, 80)}” — ${route.reason}` });
        attachments.splice(0, attachments.length, ...rest, ...attachments.filter((a) => a.kind === 'audio'));
      }
      engineUsed = route.engine;

      // Save the user's message (history is optional: save:false = a temporary chat).
      if (p.save) {
        if (!convId) { const c = await safe(() => memory.createConversation(user.id, { title: clip(text || 'New chat', 40) }), null); convId = c?.id || null; }
        if (convId) await safe(() => memory.appendMessage(user.id, convId, { role: 'user', text: text || '(attachment)', media: attachments.map(({ id, kind, mime, url }) => ({ id, kind, mime, url })) }), null);
      }

      let result = { text: '', media: [] };
      const proposal = !attachments.length ? memoryProposal(text) : null;
      const memEnabled = true;

      if (proposal) {
        const v = validateMemoryText(proposal, config.memory.factChars);
        if (v.ok) { emit('memory_proposal', { text: v.text }); result.text = `I can remember that: “${v.text}”. Tap **Save to memory** below if you want me to.`; }
        else result.text = v.error;
        emit('token', { text: result.text });
        engineUsed = 'memory';
      } else if (route.engine === 'command') {
        emit('command', { text: route.prompt });
        result = null;
      } else if (route.engine === 'text' || route.engine === 'vision') {
        let images = [];
        if (route.engine === 'vision') {
          for (const a of attachments.filter((x) => x.kind === 'image')) { const d = media.read(user.id, a.id); if (d) images.push(d.bytes.toString('base64')); }
          if (!images.length) throw new AiError('BAD_INPUT', 'I couldn’t read that picture.');
        }
        result = await runChat({ engine: route.engine, user, text: route.prompt || text, images, history: convId ? history : [], language: p.language, memEnabled, emit, signal });
      } else if (route.engine === 'image') {
        result = await runImage({ user, prompt: route.prompt, conversationId: convId, emit });
      } else if (route.engine === 'video') {
        result = await runVideo({ user, prompt: route.prompt, attachments, conversationId: convId, emit });
      } else if (route.engine === 'tts') {
        let t = route.prompt;
        if (!t) { const last = [...history].reverse().find((m) => m.role === 'assistant' && !m.error && m.text); t = last?.text || ''; }
        result = await runSpeak({ user, text: t, language: p.language, conversationId: convId, emit });
      }

      if (result && convId && p.save && (result.text || result.media?.length)) {
        await safe(() => memory.appendMessage(user.id, convId, { role: 'assistant', text: result.text, engine: engineUsed, media: (result.media || []).map(({ id, kind, mime, url }) => ({ id, kind, mime, url })) }), null);
      }
      if (ENGINES[engineUsed]) emit('usage', { engine: engineUsed, remaining: usage.remaining(engineUsed, user.id) });
      emit('done', { conversationId: convId, engine: engineUsed });
    } catch (e) {
      if (e?.name === 'AbortError' || signal?.aborted) { emit('done', { conversationId: convId, engine: engineUsed, aborted: true }); return; }
      const message = friendly(e, { engineLabel: label(engineUsed), admin: !!user.isAdmin });
      emit('error', { engine: engineUsed, code: e?.code || 'UPSTREAM', message, limitation: ['LIMIT', 'RATE_LIMIT', 'QUOTA', 'DISABLED', 'NOT_CONFIGURED', 'PAID_BLOCKED', 'BUSY'].includes(e?.code), fallback: e?.fallback });
      if (convId && p.save) await safe(() => memory.appendMessage(user.id, convId, { role: 'assistant', text: message, engine: engineUsed, error: true }), null);
      emit('done', { conversationId: convId, engine: engineUsed, failed: true });
    }
  }

  // ---------- admin: live connection test (counts toward usage like any call) ----------
  async function selfTest(engine, adminId) {
    const t0 = Date.now(); const done = (ok, detail) => ({ engine, ok, ms: Date.now() - t0, detail });
    try {
      if (engine === 'text') { const out = await exec('text', adminId, { run: (model) => providers.groq.chat({ model, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], maxTokens: 200 }) }); return done(!!out.text, out.text ? 'Replied.' : 'Empty reply.'); }
      if (engine === 'vision') { const out = await exec('vision', adminId, { run: (model) => providers.groq.chat({ model, messages: [{ role: 'user', content: 'What is in this image? One word.', images: [PIXEL_PNG] }], maxTokens: 200 }) }); return done(!!out.text, out.text ? 'Replied.' : 'Empty reply.'); }
      if (engine === 'image') { const out = await exec('image', adminId, { estUnits: config.cloudflare.neuronsPerImage, run: (model) => providers.cloudflare.generateImage({ model, prompt: 'a small red circle on white', steps: 4 }) }); return done(out.bytes.length > 100, `${out.bytes.length} bytes`); }
      if (engine === 'stt') { const out = await exec('stt', adminId, { estUnits: 10, run: (model) => providers.cloudflare.transcribe({ model, audioBase64: silentWav().toString('base64') }) }); return done(true, `Transcribed (${out.text.length} chars; silence is expected).`); }
      if (engine === 'tts') { const out = await exec('tts', adminId, { estUnits: 2, run: (model) => providers.cloudflare.speak({ model, text: 'OK', lang: 'en' }) }); return done(out.bytes.length > 100, `${out.bytes.length} bytes`); }
      if (engine === 'video') { const s = settings.get('video'); if (!providers.video.configured()) return done(false, 'Not configured.'); const out = await exec('video', adminId, { estUnits: 1, run: (model) => providers.video.generate({ prompt: 'a calm wave', model }) }); return done(out.bytes.length > 1000, `${out.bytes.length} bytes`); }
      if (engine === 'memory') { const probe = await memory.status(); return done(probe.ok, `${probe.kind}${probe.ok ? '' : ' unreachable'}`); }
      return done(false, 'Unknown engine.');
    } catch (e) { return done(false, friendly(e, { engineLabel: label(engine), admin: true })); }
  }

  return { handle, status, engineState, selfTest, runTranscribe, exec, gate, settings, usage };
}
