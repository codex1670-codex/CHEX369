// CODEX router: decides which engine should handle a message. Deterministic and free (no model call is spent on routing),
// so it is instant, testable, and cannot be talked into using a paid provider.
//
//   audio attached                → stt   (then the transcript is routed again)
//   image attached + video wish   → video (image-to-video)
//   image attached                → vision
//   "make a video of …"           → video
//   "draw / generate an image …"  → image
//   "read this aloud / say …"     → tts
//   an app command ("open reels") → command (runs on the existing Codex engine)
//   everything else               → text
import { parseCommand as defaultParse } from '../nlu.js';

const CREATE = /\b(make|create|generate|produce|render|draw|paint|design|imagine|sketch|show me|give me|vara|varai|pannu|panni|banao|banado|bana)\b|வரை|உருவாக்கு|बनाओ|बनाइए|बना दो/i;
const IMAGE_NOUN = /\b(image|picture|photo|photograph|illustration|drawing|painting|logo|wallpaper|poster|artwork|sketch|icon|avatar|portrait|thumbnail|banner|cartoon|padam|photo)\b|படம்|तस्वीर|फोटो|चित्र/i;
const VIDEO_NOUN = /\b(video|clip|animation|movie|film|reel)\b|வீடியோ|वीडियो/i;
const ANIMATE = /\b(animate|bring (this|it) to life)\b/i;
const TTS_CMD = /^\s*(?:\/(?:speak|say|tts)\b|(?:please\s+)?(?:speak|say)\s+(?:this\s+|it\s+)?(?:aloud|out\s*loud)\b|(?:please\s+)?read\s+(?:this|it|that|the\s+above|the\s+last\s+(?:answer|message|reply))\s+(?:aloud|out\s*loud)\b|(?:text[-\s]?to[-\s]?speech)\b)/i;
// A question ABOUT videos/images ("how do I make a video call?") is a chat question, not a request to generate one.
const QUESTION = /^\s*(how|why|what|when|where|which|who|can\s+i|could\s+i|is\s+it|are\s+there)\b/i;
const NOT_MEDIA = /\b(video\s+calls?|calls?|player|editor|editing|edit|script|download|watch|reels?)\b/i;
const SLASH = /^\s*\/(imagine|image|draw|video|speak|say|tts|chat|do)\b/i;

// The legacy command parser is eager: "Tell me about owls" parses as send_message and "write a poem about rain" as create_post.
// So only harmless, reversible UI actions are ever auto-routed as commands. Anything that acts on other people
// (message, follow, block, call, post …) needs an explicit "/do …" — and still goes through the existing confirmation flow.
export const SAFE_AUTO_ACTIONS = new Set(['navigate', 'open_app', 'set_theme', 'create_reminder', 'search']);

export function looksLikeAppCommand(text, parse = defaultParse) {
  const t = String(text || '').trim();
  if (!t || t.length > 140 || t.split(/\s+/).length > 14) return false;
  let r; try { r = parse(t); } catch { return false; }
  return r?.kind === 'actions' && r.actions.length > 0 && r.actions.every((a) => SAFE_AUTO_ACTIONS.has(a.name));
}

export const LABELS = { text: 'Text AI', vision: 'Vision AI', image: 'Image AI', video: 'Video AI', stt: 'Speech-to-text', tts: 'Text-to-speech', command: 'App command' };

// forced: 'auto' | 'chat' | 'image' | 'video' | 'speak'   attachments: [{kind:'image'|'audio'|'video'}]
export function routeRequest({ text = '', attachments = [], forced = 'auto', parse = defaultParse } = {}) {
  const t = String(text || '').trim();
  const hasImage = attachments.some((a) => a.kind === 'image');
  const hasAudio = attachments.some((a) => a.kind === 'audio');
  const out = (engine, reason, extra = {}) => ({ engine, reason, label: LABELS[engine], ...extra });

  if (hasAudio) return out('stt', 'You sent a voice recording, so I transcribed it first.');

  const slash = SLASH.exec(t);
  const cmd = slash ? slash[1].toLowerCase() : null;
  const prompt = slash ? t.slice(slash[0].length).trim() : t;

  if (cmd === 'do') return prompt ? out('command', 'You asked me to run an app command (/do).', { prompt }) : out('text', 'Type what to do after /do, e.g. /do open reels.', { prompt: t });
  const f = forced === 'chat' ? 'text' : forced === 'speak' ? 'tts' : ['image', 'video'].includes(forced) ? forced : cmd === 'chat' ? 'text' : ['imagine', 'image', 'draw'].includes(cmd) ? 'image' : cmd === 'video' ? 'video' : ['speak', 'say', 'tts'].includes(cmd) ? 'tts' : null;
  if (f === 'video') return out('video', hasImage ? 'Image-to-video requested.' : 'Video requested.', { prompt });
  if (f === 'image') return out('image', 'Image generation requested.', { prompt });
  if (f === 'tts') return out('tts', 'Text-to-speech requested.', { prompt: prompt.replace(TTS_CMD, '').trim() });
  if (f === 'text') return out(hasImage ? 'vision' : 'text', hasImage ? 'You attached a picture, so I used vision.' : 'Chat requested.', { prompt });

  if (hasImage) {
    if (VIDEO_NOUN.test(t) && (CREATE.test(t) || ANIMATE.test(t)) || ANIMATE.test(t)) return out('video', 'You attached a picture and asked for a video.', { prompt: t });
    return out('vision', 'You attached a picture, so I used vision.', { prompt: t || 'Describe this image in detail.' });
  }
  if (TTS_CMD.test(t)) return out('tts', 'You asked me to read something aloud.', { prompt: t.replace(TTS_CMD, '').trim() });
  if (VIDEO_NOUN.test(t) && CREATE.test(t) && !NOT_MEDIA.test(t) && !QUESTION.test(t)) return out('video', 'That sounds like a video request.', { prompt: t });
  if (IMAGE_NOUN.test(t) && CREATE.test(t) && !QUESTION.test(t) && !/\b(explain|describe|what is|why|how (do|does|to)|analy[sz]e|code|css|html|python)\b/i.test(t)) return out('image', 'That sounds like an image request.', { prompt: t });
  if (/^\s*(draw|paint|sketch|imagine)\b/i.test(t)) return out('image', 'That sounds like an image request.', { prompt: t });
  if (looksLikeAppCommand(t, parse)) return out('command', 'That is an app command, so I ran it with the Codex action engine.', { prompt: t });
  return out('text', 'Answered by the Text AI.', { prompt: t });
}

// "remember that …" → something the PERSON may choose to save. Nothing is saved by this; they must approve it.
const REMEMBER = /^\s*(?:please\s+)?(?:remember|note|save|don'?t forget)(?:\s+that)?\s*[:,-]?\s+(.{3,300})$/is;
export function memoryProposal(text) {
  const m = REMEMBER.exec(String(text || '').trim());
  return m ? m[1].trim().replace(/\s+/g, ' ') : null;
}
