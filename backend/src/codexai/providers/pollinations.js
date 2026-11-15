// Video AI (EXPERIMENTAL): Pollinations' unified endpoint. No free text-to-video quota could be verified (sources
// disagree on which models are free), so this is off by default, restricted to an admin-approved free-model list in
// FREE_ONLY_MODE, and every refusal (401/402/403/429) is shown to people as a plain limitation. CHEX never buys credits.
//   GET {base}/image/{prompt}?model=…&seed=…[&image=<public url>]   → video/mp4
import { AiError } from '../errors.js';

export function createVideo(cfg, fetchImpl = fetch) {
  const configured = () => !!cfg.baseUrl; // anonymous use is allowed by the provider (heavily rate-limited); a key lifts that.

  async function generate({ prompt, model, imageUrl, seed }) {
    const q = new URLSearchParams({ model, seed: String(seed ?? Math.floor(Math.random() * 1e9)), nologo: 'true' });
    if (imageUrl) q.set('image', imageUrl);
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
    try {
      let res;
      try {
        res = await fetchImpl(`${cfg.baseUrl}/image/${encodeURIComponent(prompt)}?${q}`, {
          signal: ctl.signal, headers: { Accept: 'video/*', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
        });
      } catch (e) { throw new AiError(e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', 'network'); }
      if (res.status === 401 || res.status === 403) throw new AiError('AUTH', 'auth', { status: res.status });
      if (res.status === 402) throw new AiError('PAID_BLOCKED', 'paid', { status: 402 });
      if (res.status === 429) throw new AiError('RATE_LIMIT', 'rate limit', { status: 429 });
      if (!res.ok) throw new AiError('UPSTREAM', `upstream ${res.status}`, { status: res.status });
      const type = String(res.headers.get('content-type') || '').split(';')[0];
      if (!/^video\//i.test(type)) throw new AiError('UPSTREAM', 'The provider did not return a video (the model may not be free).');
      const len = Number(res.headers.get('content-length') || 0);
      if (len > cfg.maxBytes) throw new AiError('UPSTREAM', 'video too large');
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > cfg.maxBytes || bytes.length < 1000) throw new AiError('UPSTREAM', 'bad video size');
      return { bytes, mime: type };
    } finally { clearTimeout(timer); }
  }
  return { configured, generate, kind: 'pollinations' };
}
