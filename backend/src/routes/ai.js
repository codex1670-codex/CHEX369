// /api/ai — the CODEX AI platform for signed-in users: streaming chat, uploads, transcription, history, memory, media.
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { isMaster } from '../admin.js';
import { validateMemoryText } from '../codexai/memory/index.js';

const bad = (res, status, code, message) => res.status(status).json({ error: { code, message } });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024, files: 1 } });
const MEMORY_LIMIT = 50;

export function createAiRouter({ stack, isAdmin = isMaster }) {
  const { codex, memory, media, config } = stack;
  const router = Router();
  router.use(requireAuth);
  const me = (req) => ({ id: req.userId, isAdmin: !!isAdmin(req.userId) });
  // Memory (MongoDB) can be offline: history calls then answer with a clear 503 instead of crashing.
  const mem = (fn) => async (req, res) => { try { await fn(req, res); } catch { bad(res, 503, 'MEMORY_UNAVAILABLE', 'Chat history and memory are unavailable right now. CODEX itself still works.'); } };

  router.get('/status', async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await codex.status(req.userId)); });

  // Pictures and voice recordings are validated by their real content, not their file name.
  router.post('/upload', (req, res) => upload.single('file')(req, res, (err) => {
    if (err) return bad(res, err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, err.code === 'LIMIT_FILE_SIZE' ? 'TOO_LARGE' : 'BAD_UPLOAD', err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large.' : 'The upload failed.');
    if (!req.file) return bad(res, 400, 'NO_FILE', 'Choose a picture or recording to attach.');
    const r = media.saveUpload({ userId: req.userId, bytes: req.file.buffer });
    if (!r.ok) return bad(res, 400, 'BAD_FILE', r.error);
    res.status(201).json({ media: r.media });
  }));

  // Mic button: turn an uploaded recording into text (Speech-to-text engine) so it can be edited before sending.
  router.post('/transcribe', async (req, res) => {
    const { attachmentId, language } = req.body || {};
    const m = typeof attachmentId === 'string' ? media.get(req.userId, attachmentId) : null;
    if (!m || m.kind !== 'audio') return bad(res, 400, 'BAD_INPUT', 'Record something first.');
    try { const text = await codex.runTranscribe({ user: me(req), audio: m, language }); media.remove(req.userId, m.id); res.json({ text }); }
    catch (e) {
      const { friendly } = await import('../codexai/errors.js');
      const code = e?.code || 'UPSTREAM';
      res.status(code === 'LIMIT' || code === 'QUOTA' || code === 'RATE_LIMIT' ? 429 : code === 'NOT_CONFIGURED' || code === 'DISABLED' ? 503 : 502).json({ error: { code, message: friendly(e, { engineLabel: 'Speech-to-text', admin: me(req).isAdmin }) } });
    }
  });

  // The main endpoint. stream:true (default) → Server-Sent Events; stream:false → one JSON reply.
  router.post('/chat', async (req, res) => {
    const wantStream = req.body?.stream !== false;
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctl.abort(); });
    const collected = { text: '', media: [], events: [] };
    let heartbeat;
    const emit = (event, data) => {
      if (event === 'token') collected.text += data.text; if (event === 'media') collected.media.push(data); collected.events.push({ event, ...data });
      if (wantStream && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    if (wantStream) {
      res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders?.();
      heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': keep-alive\n\n'); }, 15_000);
    }
    try { await codex.handle({ user: me(req), body: req.body, emit, signal: ctl.signal }); }
    catch (e) { console.error('[codexai] unexpected', e?.message); emit('error', { code: 'UPSTREAM', message: 'Something went wrong. Please try again.' }); }
    finally { clearInterval(heartbeat); }
    if (wantStream) return res.end();
    const err = collected.events.find((e) => e.event === 'error'); const done = collected.events.find((e) => e.event === 'done') || {};
    res.status(err && !collected.text && !collected.media.length ? 422 : 200).json({ text: collected.text, media: collected.media, conversationId: done.conversationId || null, engine: done.engine, route: collected.events.find((e) => e.event === 'route') || null, error: err ? { code: err.code, message: err.message, limitation: !!err.limitation } : null, command: collected.events.find((e) => e.event === 'command')?.text || null, memoryProposal: collected.events.find((e) => e.event === 'memory_proposal')?.text || null });
  });

  // ---- history ----
  router.get('/conversations', mem(async (req, res) => res.json({ conversations: await memory.listConversations(req.userId) })));
  router.get('/conversations/:id', mem(async (req, res) => { const c = await memory.getConversation(req.userId, req.params.id); if (!c) return bad(res, 404, 'NOT_FOUND', 'Conversation not found.'); res.json(c); }));
  router.patch('/conversations/:id', mem(async (req, res) => { const t = String(req.body?.title || '').trim(); if (!t) return bad(res, 400, 'BAD_INPUT', 'Give it a title.'); res.json({ ok: await memory.renameConversation(req.userId, req.params.id, t) }); }));
  router.delete('/conversations/:id', mem(async (req, res) => { if (!(await memory.deleteConversation(req.userId, req.params.id))) return bad(res, 404, 'NOT_FOUND', 'Conversation not found.'); res.json({ ok: true }); }));

  // ---- long-term memory: only ever saved because the person pressed Save (or typed it in) ----
  router.get('/memory', mem(async (req, res) => res.json({ memories: await memory.listMemories(req.userId), max: MEMORY_LIMIT })));
  router.post('/memory', mem(async (req, res) => {
    const v = validateMemoryText(req.body?.text, config.memory.factChars);
    if (!v.ok) return bad(res, 400, 'BAD_MEMORY', v.error);
    if ((await memory.listMemories(req.userId)).length >= MEMORY_LIMIT) return bad(res, 400, 'MEMORY_FULL', `You can keep up to ${MEMORY_LIMIT} memories. Delete one first.`);
    res.status(201).json({ memory: await memory.addMemory(req.userId, v.text, req.body?.source === 'chat' ? 'chat' : 'user') });
  }));
  router.delete('/memory/:id', mem(async (req, res) => { if (!(await memory.deleteMemory(req.userId, req.params.id))) return bad(res, 404, 'NOT_FOUND', 'Memory not found.'); res.json({ ok: true }); }));
  router.delete('/memory', mem(async (req, res) => res.json({ deleted: await memory.clearMemories(req.userId) })));

  // ---- media history ----
  router.get('/media', (req, res) => res.json({ media: media.list(req.userId, { origin: req.query.origin === 'generated' ? 'generated' : req.query.origin === 'upload' ? 'upload' : undefined }) }));
  router.delete('/media/:id', (req, res) => (media.remove(req.userId, req.params.id) ? res.json({ ok: true }) : bad(res, 404, 'NOT_FOUND', 'File not found.')));

  // "Delete everything CODEX AI knows about me": chats, memories and files.
  router.delete('/data', mem(async (req, res) => { await memory.deleteAll(req.userId); media.removeAll(req.userId); res.json({ ok: true }); }));

  return router;
}
