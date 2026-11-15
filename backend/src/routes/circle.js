// POST /api/codex/circle — "Circle to Ask".
//
// The browser sends ONE user-approved, already-masked crop of the screen (or text only), plus what the person
// wants (Explain / Simplify / Deep / Translate / Steps / Take me there / a free question). We scrub it again,
// ask the vision model, and answer. Nothing is written to the database or disk, and the picture is never echoed.
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { redact, cleanContext } from '../circle/redact.js';
import { retrieve } from '../circle/knowledge.js';
import { MODES, buildSystem, buildUserText, parseModelReply } from '../circle/prompt.js';
import { askVision as defaultAsk, isConfigured as defaultConfigured } from '../circle/provider.js';

export const BLOCKED_SCREENS = new Set(['mylife', 'private', 'auth', 'login', 'signup']);
const MAX_IMAGE_B64 = 1_400_000;                       // ≈ 1 MB of picture; the app sends ≈ 150–400 KB
const MEDIA = { 'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' };

const bad = (res, status, code, message) => res.status(status).json({ error: { code, message } });

export function createCircleRouter({ ask = defaultAsk, configured = defaultConfigured, env = process.env } = {}) {
  const router = Router();

  router.get('/status', requireAuth, (_req, res) => res.json({ configured: configured(env), modes: Object.keys(MODES) }));

  router.post('/', requireAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const b = req.body && typeof req.body === 'object' ? req.body : {};

    const mode = b.mode === undefined ? 'explain' : String(b.mode);
    if (!Object.hasOwn(MODES, mode)) return bad(res, 400, 'BAD_MODE', 'Unknown help type.');
    const question = redact(b.question, 500).text;
    if (mode === 'ask' && !question) return bad(res, 400, 'NO_QUESTION', 'Type a question about the circled area.');

    const locale = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(String(b.locale || '')) ? String(b.locale) : 'en';
    const language = typeof b.language === 'string' && /^[\p{L} ()-]{2,40}$/u.test(b.language.trim()) ? b.language.trim() : '';

    const context = cleanContext(b.context);
    if (BLOCKED_SCREENS.has(context.screen)) return bad(res, 403, 'BLOCKED_SCREEN', 'Circle to Ask is switched off on this private screen.');

    // The picture: only with explicit consent, only a real small JPEG/PNG/WebP.
    let image = null;
    if (b.image !== undefined && b.image !== null) {
      if (b.consent !== true) return bad(res, 400, 'NO_CONSENT', 'The person must approve sharing the selected area first.');
      const { mediaType, data } = b.image || {};
      if (!Object.hasOwn(MEDIA, mediaType) || typeof data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(data)) return bad(res, 400, 'BAD_IMAGE', 'That picture could not be read.');
      if (data.length > MAX_IMAGE_B64) return bad(res, 413, 'IMAGE_TOO_LARGE', 'The selected area is too large. Circle a smaller part.');
      if (!MEDIA[mediaType](Buffer.from(data.slice(0, 32), 'base64'))) return bad(res, 400, 'BAD_IMAGE', 'That picture could not be read.');
      image = { mediaType, data };
    }
    const { text: regionText, count: textHidden } = redact(b.regionText, 1500);
    if (!image && !regionText) return bad(res, 400, 'NOTHING_SELECTED', 'Nothing readable was selected. Try circling something else.');

    if (!configured(env)) return bad(res, 503, 'NOT_CONFIGURED', 'The AI service is not set up on this server yet.');

    const history = (Array.isArray(b.history) ? b.history : []).slice(-6)
      .map((h) => ({ role: h?.role === 'assistant' ? 'assistant' : 'user', text: redact(h?.text, 600).text })).filter((h) => h.text);

    try {
      const raw = await ask({
        system: buildSystem({ mode, language, locale, hasImage: !!image, knowledge: retrieve(`${question} ${regionText}`, context.screen) }),
        userText: buildUserText({ mode, question, regionText, context }),
        image, history, maxTokens: mode === 'deep' ? 1000 : 700,
      }, env);
      const out = parseModelReply(raw);
      if (!out.answer && !out.steps.length) return bad(res, 502, 'EMPTY_ANSWER', 'Codex could not make sense of that area. Try circling it again.');
      return res.json({ ...out, mode, usedImage: !!image, hiddenItems: textHidden });
    } catch (err) {
      console.error('[circle] provider failed:', err.message);       // message only — never the prompt or the picture
      return bad(res, 502, 'PROVIDER_ERROR', 'The AI service could not answer right now. Please try again.');
    }
  });

  return router;
}

export default createCircleRouter();
