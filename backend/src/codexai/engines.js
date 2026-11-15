// The seven building blocks of CODEX AI and their safe free-plan defaults.
// Per-user and global limits are CHEX's own guard rails (admin-editable); they are not provider promises.
export const ENGINES = {
  text:   { label: 'Text AI',        provider: 'groq',         what: 'chat, reasoning, coding, explanations', perUserDaily: 100, globalDaily: 800 },
  vision: { label: 'Vision AI',      provider: 'groq',         what: 'images, screenshots, documents',        perUserDaily: 30,  globalDaily: 200 },
  image:  { label: 'Image AI',       provider: 'cloudflare',   what: 'text-to-image',                         perUserDaily: 8,   globalDaily: 40 },
  video:  { label: 'Video AI',       provider: 'pollinations', what: 'text-to-video / image-to-video (experimental)', perUserDaily: 2, globalDaily: 6, experimental: true, defaultEnabled: false },
  stt:    { label: 'Speech-to-text', provider: 'cloudflare',   what: 'voice to text',                         perUserDaily: 30,  globalDaily: 150 },
  tts:    { label: 'Text-to-speech', provider: 'cloudflare',   what: 'text to voice',                         perUserDaily: 30,  globalDaily: 150 },
};
export const ENGINE_KEYS = Object.keys(ENGINES);
export const CLOUDFLARE_ENGINES = ENGINE_KEYS.filter((k) => ENGINES[k].provider === 'cloudflare');
