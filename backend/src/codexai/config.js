// CODEX AI configuration, read from environment variables only. Secrets never leave the server.
const bool = (v, d) => (v === undefined || v === '' ? d : !/^(false|0|no|off)$/i.test(String(v)));
const int = (v, d, min = 0, max = 1e9) => { const n = Number(v); return Number.isFinite(n) && v !== '' && v !== undefined ? Math.min(max, Math.max(min, Math.floor(n))) : d; };
const list = (v, d) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : d);

export const CF_FREE_DAILY_NEURONS = 10_000;   // Cloudflare Workers AI free allocation (resets 00:00 UTC)

export function aiConfig(env = process.env) {
  const freeOnly = bool(env.FREE_ONLY_MODE, true);                    // FREE_ONLY_MODE = true by default
  return {
    freeOnly,
    groq: {
      baseUrl: String(env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),   // OpenAI-compatible endpoint
      apiKey: env.GROQ_API_KEY || '',
      textModel: env.GROQ_TEXT_MODEL || env.GROQ_MODEL || 'openai/gpt-oss-120b',
      visionModel: env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b',
      concurrency: int(env.GROQ_CONCURRENCY, 4, 1, 20),                 // Groq's free tier is limited per minute/day, not one-at-a-time
      timeoutMs: int(env.GROQ_TIMEOUT_MS, 60_000, 5_000, 600_000),
    },
    cloudflare: {
      accountId: env.CLOUDFLARE_ACCOUNT_ID || '',
      apiToken: env.CLOUDFLARE_API_TOKEN || '',
      imageModel: env.CF_IMAGE_MODEL || '@cf/black-forest-labs/flux-1-schnell',
      sttModel: env.CF_STT_MODEL || '@cf/openai/whisper-large-v3-turbo',
      ttsModel: env.CF_TTS_MODEL || '@cf/myshell-ai/melotts',
      // Our OWN daily guard, below Cloudflare's 10,000 free neurons, so CHEX can never push an account over the free line.
      dailyNeuronCap: Math.min(int(env.CF_DAILY_NEURON_CAP, 8_000, 0, 1e9), freeOnly ? CF_FREE_DAILY_NEURONS : 1e9),
      neuronsPerImage: int(env.CF_NEURONS_PER_IMAGE, 175, 1, 100_000),  // conservative: 1024×1024, 4 steps
      concurrency: int(env.CF_CONCURRENCY, 3, 1, 20),
      timeoutMs: int(env.CF_TIMEOUT_MS, 60_000, 5_000, 300_000),
    },
    video: {
      provider: 'pollinations',
      baseUrl: String(env.VIDEO_BASE_URL || 'https://gen.pollinations.ai').replace(/\/+$/, ''),
      apiKey: env.VIDEO_API_KEY || env.POLLINATIONS_API_KEY || '',
      model: env.VIDEO_MODEL || 'grok-video',
      // In FREE_ONLY mode a model must be on this list. Ships with ONE entry because provider free/paid lists change.
      freeModels: list(env.VIDEO_FREE_MODELS, ['grok-video']),
      publicBaseUrl: String(env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''), // needed for image-to-video (the provider must fetch the picture)
      concurrency: int(env.VIDEO_CONCURRENCY, 1, 1, 5),
      timeoutMs: int(env.VIDEO_TIMEOUT_MS, 180_000, 10_000, 600_000),
      maxBytes: 30 * 1024 * 1024,
    },
    mongo: { uri: env.MONGODB_URI || '', db: env.MONGODB_DB || 'chex' },
    memory: { maxFacts: 50, factChars: 300, promptChars: 1500 },
  };
}
