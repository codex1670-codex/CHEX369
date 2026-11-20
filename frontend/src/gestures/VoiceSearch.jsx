import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Voice search: hold the Search icon, say a name or a topic, and the Search page opens with it filled in.
const LANG_KEY = 'chex.voiceSearch.lang';
export const VOICE_LANGS = [
  ['auto', 'Auto'], ['en-IN', 'English (IN)'], ['en-US', 'English (US)'], ['ta-IN', 'தமிழ்'], ['hi-IN', 'हिन्दी'], ['te-IN', 'తెలుగు'],
  ['kn-IN', 'ಕನ್ನಡ'], ['ml-IN', 'മലയാളം'], ['bn-IN', 'বাংলা'], ['ar-SA', 'العربية'], ['es-ES', 'Español'], ['fr-FR', 'Français'],
];
const loadLang = () => { try { return localStorage.getItem(LANG_KEY) || 'auto'; } catch { return 'auto'; } };

const ERRORS = {
  'not-allowed': 'Microphone is blocked. Allow it in your browser or phone settings, then tap the mic.',
  'service-not-allowed': 'Microphone is blocked. Allow it in your browser or phone settings, then tap the mic.',
  'audio-capture': 'No microphone was found on this device.',
  network: 'Voice search needs an internet connection.',
  'language-not-supported': 'That language is not supported for voice here. Pick another one below.',
};

export default function VoiceSearch({ onSearch, onClose }) {
  const Ctor = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const [lang, setLang] = useState(loadLang);
  const [phase, setPhase] = useState('idle');   // idle | listening | heard
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const recRef = useRef(null), doneRef = useRef(false), closeTimer = useRef(null);

  const stop = useCallback(() => { try { recRef.current?.abort(); } catch { /* already stopped */ } recRef.current = null; }, []);

  const start = useCallback(() => {
    setError('');
    if (!Ctor) { setError("This browser can't do voice input (Chrome, Edge and Safari can). Tap Type instead."); return; }
    if (!window.isSecureContext) { setError('The microphone only works on a secure page (https:// or localhost).'); return; }
    stop();
    doneRef.current = false;
    const rec = new Ctor();
    rec.lang = lang !== 'auto' ? lang : (navigator.language || 'en-IN');
    rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onstart = () => { setPhase('listening'); setText(''); };
    rec.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      const t = res[0].transcript.trim();
      setText(t);
      if (res.isFinal && t && !doneRef.current) {
        doneRef.current = true; setPhase('heard');
        try { navigator.vibrate?.(12); } catch { /* no haptics */ }
        closeTimer.current = setTimeout(() => onSearch(t), 450);   // a beat so you can see what it heard
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'aborted') return;
      setPhase('idle');
      setError(e.error === 'no-speech' ? "I didn't hear anything. Tap the mic and speak." : (ERRORS[e.error] || `Voice input stopped (${e.error}). Tap the mic to try again.`));
    };
    rec.onend = () => { if (!doneRef.current) setPhase(p => (p === 'listening' ? 'idle' : p)); };
    recRef.current = rec;
    try { rec.start(); } catch { setPhase('idle'); setError('Could not start the microphone. Tap the mic to try again.'); }
  }, [Ctor, lang, onSearch, stop]);

  // Start listening as soon as the sheet opens (and again if the language is changed).
  useEffect(() => { start(); return () => { stop(); clearTimeout(closeTimer.current); }; }, [lang]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const pickLang = (v) => { try { localStorage.setItem(LANG_KEY, v); } catch { /* not persisted */ } setLang(v); };
  const listening = phase === 'listening';

  return createPortal(
    <div className="vs-back" data-noswipe data-circle-ui role="dialog" aria-label="Voice search" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="vs-card">
        <button type="button" className="vs-x" onClick={onClose} aria-label="Close voice search">✕</button>
        <div className="vs-title">Voice search</div>
        <button type="button" className={`vs-orb${listening ? ' live' : ''}${phase === 'heard' ? ' heard' : ''}`} onClick={() => (listening ? stop() : start())} aria-label={listening ? 'Stop listening' : 'Start listening'}>
          <span className="vs-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
          <span className="vs-mic" aria-hidden="true">{phase === 'heard' ? '✓' : '🎙'}</span>
        </button>
        <div className="vs-say" aria-live="polite">
          {text ? <b>“{text}”</b> : listening ? 'Listening… say a name or a topic' : phase === 'heard' ? '' : 'Tap the mic and speak'}
        </div>
        {error && <div className="vs-err" role="alert">{error}</div>}
        <div className="vs-foot">
          <select value={lang} onChange={e => pickLang(e.target.value)} aria-label="Voice language">
            {VOICE_LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button type="button" className="vs-type" onClick={() => onSearch('')}>⌨ Type instead</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
