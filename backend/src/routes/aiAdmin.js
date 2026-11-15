// /api/admin/ai — master-account dashboard for the AI providers: status, models, limits, usage, live connection tests.
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isMaster } from '../admin.js';
import { ENGINES, ENGINE_KEYS } from '../codexai/engines.js';
import { CF_FREE_DAILY_NEURONS } from '../codexai/config.js';

const bad = (res, status, code, message) => res.status(status).json({ error: { code, message } });

export function createAiAdminRouter({ stack, isAdmin = isMaster }) {
  const { codex, settings, usage, providers, memory, config } = stack;
  const router = Router();
  router.use(requireAuth, (req, res, next) => (isAdmin(req.userId) ? next() : bad(res, 403, 'FORBIDDEN', 'This area is only for the master account.')));

  router.get('/overview', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const st = await codex.status(req.userId);
    const sum = usage.summary();
    const byEngine = Object.fromEntries(sum.today.map((r) => [r.engine, r]));
    res.json({
      freeOnly: config.freeOnly,
      // Booleans only — secret values are never sent to any browser.
      providers: {
        groq: { host: config.groq.baseUrl, configured: providers.groq.configured(), keySet: !!config.groq.apiKey, concurrency: config.groq.concurrency, note: 'Free tier: per-minute and per-day request/token limits apply (see console.groq.com → Limits).' },
        cloudflare: { configured: providers.cloudflare.configured(), accountSet: !!config.cloudflare.accountId, tokenSet: !!config.cloudflare.apiToken, freeNeuronsPerDay: CF_FREE_DAILY_NEURONS, chexDailyCap: config.cloudflare.dailyNeuronCap, neuronsUsedToday: Math.round(sum.neuronsToday), note: 'Free allocation resets 00:00 UTC. Keep the account on the Workers Free plan.' },
        video: { configured: providers.video.configured(), keySet: !!config.video.apiKey, freeModels: config.video.freeModels, experimental: true, note: 'No free text-to-video quota could be verified; availability varies.' },
        memory: st.memory,
      },
      engines: st.engines.map((e) => ({ ...e, usageToday: byEngine[e.engine] || { requests: 0, ok: 0, errors: 0, blocked: 0, units: 0 }, cooldownUntil: usage.cooldownOf(e.engine)?.until || null })),
      usage: { day: sum.day, week: sum.week, topUsers: sum.topUsers, recentErrors: sum.errors },
    });
  });

  router.put('/engines/:engine', (req, res) => {
    if (!ENGINE_KEYS.includes(req.params.engine)) return bad(res, 404, 'NOT_FOUND', 'Unknown engine.');
    const { enabled, model, perUserDaily, globalDaily } = req.body || {};
    const r = settings.set(req.params.engine, { enabled, model, perUserDaily, globalDaily });
    if (!r.ok) return bad(res, 400, 'BAD_INPUT', r.error);
    res.json({ engine: codex.engineState(req.params.engine, req.userId) });
  });

  router.post('/engines/:engine/test', async (req, res) => {
    if (!ENGINE_KEYS.includes(req.params.engine) && req.params.engine !== 'memory') return bad(res, 404, 'NOT_FOUND', 'Unknown engine.');
    res.json(await codex.selfTest(req.params.engine, req.userId));
  });
  router.post('/engines/:engine/reset', (req, res) => { if (!ENGINES[req.params.engine]) return bad(res, 404, 'NOT_FOUND', 'Unknown engine.'); usage.clearCooldown(req.params.engine); res.json({ ok: true }); });

  router.get('/groq-models', async (_req, res) => {
    try { res.json({ models: await providers.groq.listModels() }); }
    catch { bad(res, 502, 'UPSTREAM', 'Could not load the model list from Groq.'); }
  });

  return router;
}
