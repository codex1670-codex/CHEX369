// Circle to Ask — the "Brain" + "Vision" layer, behind one small interface so the model can be swapped by config.
//
//   Default: GROQ (open-weight vision models) through its OpenAI-compatible API.
//     GROQ_API_KEY        required — sent as a Bearer token (console.groq.com → API Keys)
//     GROQ_BASE_URL       default https://api.groq.com/openai/v1
//     GROQ_VISION_MODEL   default qwen/qwen3.8-27b   (any Groq vision-capable model; Groq retires models, so check console.groq.com/docs/deprecations)
//   CIRCLE_PROVIDER=openai      any other OpenAI-compatible server (CIRCLE_BASE_URL / CIRCLE_MODEL / CIRCLE_API_KEY)
//   CIRCLE_PROVIDER=anthropic   Anthropic instead (ANTHROPIC_API_KEY, model CIRCLE_MODEL or ANTHROPIC_MODEL)
//
// Nothing here stores the image. It is forwarded once, in memory, and dropped.

import { reasoningParams } from '../codexai/reasoning.js';

export function providerConfig(env = process.env) {
  const kind = String(env.CIRCLE_PROVIDER || 'groq').toLowerCase();
  if (kind === 'anthropic') {
    return { kind: 'anthropic', model: env.CIRCLE_MODEL || env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001', apiKey: env.ANTHROPIC_API_KEY || '' };
  }
  if (kind === 'openai') {
    return { kind: 'openai', baseUrl: String(env.CIRCLE_BASE_URL || '').replace(/\/+$/, ''), model: env.CIRCLE_MODEL || '', apiKey: env.CIRCLE_API_KEY || '' };
  }
  return {
    kind: 'openai', groq: true,
    baseUrl: String(env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
    model: env.GROQ_VISION_MODEL || env.CIRCLE_MODEL || 'qwen/qwen3.8-27b',
    apiKey: env.GROQ_API_KEY || '',
  };
}

export function isConfigured(env = process.env) {
  const c = providerConfig(env);
  if (c.groq) return !!c.apiKey;   // Groq always needs a key
  return c.kind === 'openai' ? !!(c.baseUrl && c.model) : !!c.apiKey;
}

// `image` is optional: { mediaType, data(base64) }. `history` is [{role:'user'|'assistant', text}].
export async function askVision({ system, userText, image, history = [], maxTokens = 700 }, env = process.env, fetchImpl = fetch) {
  const c = providerConfig(env);
  const prior = history.map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', text: String(h.text || '') }));

  if (c.kind === 'openai') {
    const userContent = [];
    if (image) userContent.push({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } });
    userContent.push({ type: 'text', text: userText });
    const res = await fetchImpl(`${c.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) },
      body: JSON.stringify({
        model: c.model, max_tokens: maxTokens, temperature: 0.3, ...(c.groq ? reasoningParams(c.model) : {}),
        messages: [{ role: 'system', content: system }, ...prior.map((p) => ({ role: p.role, content: p.text })), { role: 'user', content: userContent }],
      }),
    });
    if (!res.ok) {
      // Only Groq's short machine-readable error code/type is added (e.g. model_not_found, invalid_api_key) — never its message or the prompt.
      let why = ''; try { const j = await res.json(); why = [j?.error?.code, j?.error?.type].filter((x) => typeof x === 'string' && /^[\w.-]{1,60}$/.test(x)).join(' / '); } catch { /* ignore */ }
      throw new Error(`Vision provider error ${res.status}${why ? ` (${why})` : ''}`);
    }
    const data = await res.json();
    return String(data.choices?.[0]?.message?.content || '').trim();
  }

  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
  content.push({ type: 'text', text: userText });
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: c.model, max_tokens: maxTokens, system,
      messages: [...prior.map((p) => ({ role: p.role, content: p.text })), { role: 'user', content }],
    }),
  });
  if (!res.ok) throw new Error(`Vision provider error ${res.status}`);   // never include the body: it can echo the prompt
  const data = await res.json();
  return String(data.content?.find((b) => b.type === 'text')?.text || '').trim();
}
