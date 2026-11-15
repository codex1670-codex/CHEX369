// Text AI + Vision AI: Groq's OpenAI-compatible API (https://api.groq.com/openai/v1, Bearer key). Streams SSE.
//   POST {baseUrl}/chat/completions   { model, messages, stream:true, max_tokens }
//   GET  {baseUrl}/models             (model list)
// Messages may carry `images: [base64]` (CHEX's internal shape); they are converted to OpenAI "image_url" parts here.
import { AiError } from '../errors.js';
import { reasoningParams } from '../reasoning.js';

const mapStatus = (status, bodyText = '') => {
  if (status === 401 || status === 403) return new AiError('AUTH', 'auth', { status });
  if (status === 429) return new AiError('RATE_LIMIT', 'rate limited', { status });
  if (status === 404 || /model .*(not found|does not exist|decommissioned)/i.test(bodyText)) return new AiError('MODEL_NOT_FOUND', 'model not found', { status });
  if (status === 402) return new AiError('QUOTA', 'quota', { status });
  return new AiError('UPSTREAM', `upstream ${status}`, { status });
};

const toWire = (messages) => messages.map(({ images, ...m }) => {
  if (!images?.length) return m;
  return {
    ...m,
    content: [
      { type: 'text', text: String(m.content || '') },
      ...images.map((b64) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } })),
    ],
  };
});

export function createGroq(cfg, fetchImpl = fetch) {
  const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` });
  const configured = () => !!cfg.baseUrl && !!cfg.apiKey;

  // Async generator: { type:'token', text } … { type:'done', usage:{promptTokens, completionTokens} }
  async function* streamChat({ model, messages, signal, maxTokens }) {
    if (!configured()) throw new AiError('NOT_CONFIGURED', 'not configured');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new AiError('TIMEOUT', 'timeout')), cfg.timeoutMs);
    const onAbort = () => ctl.abort(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      let res;
      try {
        res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
          method: 'POST', headers: headers(), signal: ctl.signal,
          body: JSON.stringify({ model, messages: toWire(messages), stream: true, stream_options: { include_usage: true }, ...reasoningParams(model), ...(maxTokens ? { max_tokens: maxTokens } : {}) }),
        });
      } catch (e) { throw ctl.signal.reason instanceof AiError ? ctl.signal.reason : (e?.name === 'AbortError' ? e : new AiError('NETWORK', 'network')); }
      if (!res.ok) {
        const retry = Number(res.headers?.get?.('retry-after'));
        const err = mapStatus(res.status, await res.text().catch(() => ''));
        if (Number.isFinite(retry) && retry > 0) err.retryAfterSec = retry;
        throw err;
      }

      const dec = new TextDecoder(); let buf = ''; let usage = { promptTokens: 0, completionTokens: 0 }; let finished = false;
      const handle = function* (line) {
        line = line.trim();
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (!data) return;
        if (data === '[DONE]') { if (!finished) { finished = true; yield { type: 'done', usage }; } return; }
        let j; try { j = JSON.parse(data); } catch { return; }
        if (j.error) throw new AiError(/not found|does not exist/i.test(j.error.message || '') ? 'MODEL_NOT_FOUND' : /rate|limit|quota|too many/i.test(j.error.message || '') ? 'RATE_LIMIT' : 'UPSTREAM', 'upstream error');
        const u = j.usage || j.x_groq?.usage;
        if (u) usage = { promptTokens: u.prompt_tokens || 0, completionTokens: u.completion_tokens || 0 };
        const t = j.choices?.[0]?.delta?.content;       // reasoning fields (if any) are deliberately not shown
        if (t) yield { type: 'token', text: t };
      };
      const body = res.body;
      if (body?.getReader) {
        const reader = body.getReader();
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); yield* handle(line); }
        }
        buf += dec.decode(); if (buf) yield* handle(buf);
      } else {
        for (const line of (await res.text()).split('\n')) yield* handle(line);
      }
      if (!finished) yield { type: 'done', usage };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
  }

  async function chat(args) {
    let text = ''; let usage = { promptTokens: 0, completionTokens: 0 };
    for await (const ev of streamChat(args)) { if (ev.type === 'token') text += ev.text; else if (ev.type === 'done') usage = ev.usage; }
    return { text: text.trim(), usage };
  }

  async function listModels() {
    if (!configured()) throw new AiError('NOT_CONFIGURED', 'not configured');
    const res = await fetchImpl(`${cfg.baseUrl}/models`, { headers: headers() }).catch(() => { throw new AiError('NETWORK', 'network'); });
    if (!res.ok) throw mapStatus(res.status);
    const j = await res.json().catch(() => ({}));
    return (j.data || []).map((m) => m.id).filter(Boolean).sort();
  }

  return { configured, streamChat, chat, listModels, kind: 'groq' };
}
