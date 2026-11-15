// Admin overrides (enabled / model / limits) stored in ai_settings. Defaults come from engines.js + config.js.
import { ENGINES, ENGINE_KEYS } from './engines.js';

export function createSettings({ db, config }) {
  const defaultModel = (engine) => ({
    text: config.groq.textModel, vision: config.groq.visionModel, image: config.cloudflare.imageModel,
    stt: config.cloudflare.sttModel, tts: config.cloudflare.ttsModel, video: config.video.model,
  }[engine]);
  // Groq model ids never contain ":"; a saved Ollama-style name (e.g. "gpt-oss:20b") from before the switch is ignored.
  const usableModel = (engine, m) => (m && !((engine === 'text' || engine === 'vision') && m.includes(':')) ? m : '');
  const read = (engine) => { try { return JSON.parse(db.prepare('SELECT value FROM ai_settings WHERE key = ?').get(`engine:${engine}`)?.value || '{}'); } catch { return {}; } };

  const get = (engine) => {
    const e = ENGINES[engine]; if (!e) return null;
    const o = read(engine);
    return {
      engine, label: e.label, provider: e.provider, experimental: !!e.experimental,
      enabled: typeof o.enabled === 'boolean' ? o.enabled : e.defaultEnabled !== false,
      model: usableModel(engine, o.model) || defaultModel(engine),
      perUserDaily: Number.isFinite(o.perUserDaily) ? o.perUserDaily : e.perUserDaily,
      globalDaily: Number.isFinite(o.globalDaily) ? o.globalDaily : e.globalDaily,
    };
  };
  const all = () => ENGINE_KEYS.map(get);

  // Returns { ok, error? }. Rules keep the admin inside the free-only policy.
  const set = (engine, patch) => {
    if (!ENGINES[engine]) return { ok: false, error: 'Unknown engine.' };
    const cur = read(engine); const next = { ...cur };
    if (patch.enabled !== undefined) { if (typeof patch.enabled !== 'boolean') return { ok: false, error: 'enabled must be true or false.' }; next.enabled = patch.enabled; }
    if (patch.model !== undefined) {
      if (typeof patch.model !== 'string' || !/^[\w.:/@+-]{1,100}$/.test(patch.model)) return { ok: false, error: 'That model name is not valid.' };
      if (engine === 'video' && config.freeOnly && !config.video.freeModels.includes(patch.model)) return { ok: false, error: `FREE_ONLY_MODE is on: video model must be one of ${config.video.freeModels.join(', ')} (set VIDEO_FREE_MODELS to change that list).` };
      next.model = patch.model;
    }
    for (const k of ['perUserDaily', 'globalDaily']) {
      if (patch[k] !== undefined) { const n = Number(patch[k]); if (!Number.isInteger(n) || n < 0 || n > 100_000) return { ok: false, error: `${k} must be a whole number from 0 to 100000.` }; next[k] = n; }
    }
    db.prepare("INSERT INTO ai_settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(`engine:${engine}`, JSON.stringify(next));
    return { ok: true };
  };
  return { get, all, set };
}
