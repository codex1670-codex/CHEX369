// Image AI + Audio AI: Cloudflare Workers AI REST API.
//   POST https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/{model}   Authorization: Bearer {token}
//   image: {prompt, steps} → result.image (base64)      stt: {audio:<base64>, language?} → result.text      tts: {prompt, lang} → result.audio (base64 mp3)
import { AiError } from '../errors.js';

const API = 'https://api.cloudflare.com/client/v4/accounts';

const fromHttp = (status, errors = []) => {
  const msg = errors.map((e) => `${e.code ?? ''} ${e.message ?? ''}`).join(' ');
  if (status === 401 || status === 403 || /authentication|permission|invalid.*token/i.test(msg)) return new AiError('AUTH', 'auth', { status });
  if (status === 402 || /neuron|daily.*(limit|allocation)|quota|exceeded your/i.test(msg)) return new AiError('QUOTA', 'quota', { status });
  if (status === 429 || /\b3040\b|capacity|rate.?limit|too many/i.test(msg)) return new AiError('RATE_LIMIT', 'rate limit', { status });
  if (status === 404 || /no such model|model.*not found/i.test(msg)) return new AiError('MODEL_NOT_FOUND', 'model not found', { status });
  if (status === 400) return new AiError('BAD_INPUT', 'The AI engine rejected that input.', { status });
  return new AiError('UPSTREAM', `upstream ${status}`, { status });
};

export function createCloudflare(cfg, fetchImpl = fetch) {
  const configured = () => !!(cfg.accountId && cfg.apiToken);

  async function run(model, input) {
    if (!configured()) throw new AiError('NOT_CONFIGURED', 'not configured');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
    try {
      let res;
      try {
        res = await fetchImpl(`${API}/${encodeURIComponent(cfg.accountId)}/ai/run/${model}`, {
          method: 'POST', signal: ctl.signal,
          headers: { Authorization: `Bearer ${cfg.apiToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
      } catch (e) { throw new AiError(e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', 'network'); }
      const type = String(res.headers?.get?.('content-type') || '');
      if (/^audio\//i.test(type) && res.ok) return { binary: Buffer.from(await res.arrayBuffer()), mime: type.split(';')[0] };
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.success === false) throw fromHttp(res.status, j.errors);
      return { result: j.result ?? j };
    } finally { clearTimeout(timer); }
  }

  const sniffImage = (b) => (b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/jpeg');

  async function generateImage({ model, prompt, steps = 4 }) {
    const { result } = await run(model, { prompt, steps });
    const b64 = typeof result === 'string' ? result : result?.image;
    if (!b64) throw new AiError('UPSTREAM', 'no image returned');
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length < 100) throw new AiError('UPSTREAM', 'empty image');
    return { bytes, mime: sniffImage(bytes) };
  }

  async function transcribe({ model, audioBase64, language }) {
    const { result } = await run(model, { audio: audioBase64, ...(language ? { language } : {}) });
    const text = String(result?.text ?? '').trim();
    return { text, language: result?.transcription_info?.language };
  }

  async function speak({ model, text, lang = 'en' }) {
    const out = await run(model, { prompt: text, lang });
    if (out.binary) return { bytes: out.binary, mime: out.mime || 'audio/mpeg' };
    const b64 = out.result?.audio; if (!b64) throw new AiError('UPSTREAM', 'no audio returned');
    return { bytes: Buffer.from(b64, 'base64'), mime: 'audio/mpeg' };
  }

  return { configured, run, generateImage, transcribe, speak, kind: 'cloudflare' };
}
