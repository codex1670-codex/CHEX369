// Circle to Ask — device-local settings. Everything here lives in this browser only, like the Floating AI bar.
//
//  • The feature is OFF until the person switches it on in Settings → Circle to Ask.
//  • "Memory" is opt-in: a language/"remember" choice is only saved if the person ticks "Remember my language".
const ON_KEY = 'chex.circleAsk';
const PREFS_KEY = 'chex.circleAsk.prefs';

export const circleAskEnabled = () => { try { return localStorage.getItem(ON_KEY) === 'on'; } catch { return false; } };
export function setCircleAsk(on) {
  try { localStorage.setItem(ON_KEY, on ? 'on' : 'off'); } catch { /* not persisted */ }
  window.dispatchEvent(new Event('chex:circle-ask-changed'));
  return !!on;
}

export const LANGUAGES = [
  ['English', 'en'], ['தமிழ் (Tamil)', 'ta'], ['हिन्दी (Hindi)', 'hi'], ['తెలుగు (Telugu)', 'te'], ['ಕನ್ನಡ (Kannada)', 'kn'],
  ['മലയാളം (Malayalam)', 'ml'], ['বাংলা (Bengali)', 'bn'], ['العربية (Arabic)', 'ar'], ['Español', 'es'], ['Français', 'fr'],
  ['Deutsch', 'de'], ['Português', 'pt'], ['日本語 (Japanese)', 'ja'], ['한국어 (Korean)', 'ko'], ['Русский', 'ru'],
];
// What the model is told to write in (a plain language name works for every model).
export const LANGUAGE_NAMES = { en: 'English', ta: 'Tamil', hi: 'Hindi', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', bn: 'Bengali', ar: 'Arabic', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', ru: 'Russian' };

export function browserLanguageCode(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  const code = String(nav.language || 'en').slice(0, 2).toLowerCase();
  return Object.hasOwn(LANGUAGE_NAMES, code) ? code : 'en';
}

export function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (p && p.remember === true && Object.hasOwn(LANGUAGE_NAMES, p.language)) return { remember: true, language: p.language };
  } catch { /* fall through */ }
  return { remember: false, language: '' };
}
export function savePrefs({ remember, language }) {
  try {
    if (remember && Object.hasOwn(LANGUAGE_NAMES, language)) localStorage.setItem(PREFS_KEY, JSON.stringify({ remember: true, language }));
    else localStorage.removeItem(PREFS_KEY);
  } catch { /* not persisted */ }
  return loadPrefs();
}
export const clearPrefs = () => savePrefs({ remember: false, language: '' });
