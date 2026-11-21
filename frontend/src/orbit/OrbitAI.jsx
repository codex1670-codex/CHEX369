import { useCallback, useEffect, useRef, useState } from 'react';
import OrbitIcon from './OrbitIcon.jsx';
import { CHAT_RE } from './OrbitAIBar.jsx';

// CHEX Orbit AI — the assistant inside Orbit, with a living orb.
//   idle      → the orb breathes and slowly swirls
//   listening → rings pulse out, a waveform dances, your words appear live
//   thinking  → the orb spins up while Orbit hands over to the assistant
// Speak or type. Questions / writing / images go to the CHEX AI chat; commands ("open reels", "message Priya") go to the
// Codex agent, which can use every page. Voice uses the browser's own speech recognition (Chrome, Edge, Safari).
const IDEAS = ['Open Reels', 'Message someone', 'Search for a person', 'Draw a neon city', 'Explain black holes', 'Make a video of waves'];
const ERR = {
  'not-allowed': 'Microphone is blocked. Allow it in your browser settings, then tap the orb.',
  'service-not-allowed': 'Microphone is blocked. Allow it in your browser settings, then tap the orb.',
  'audio-capture': 'No microphone was found on this device.',
  network: 'Voice needs an internet connection.',
};

export default function OrbitAI({ onClose, onRun, autoListen = false }) {
  const Ctor = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const [phase, setPhase] = useState('idle');       // idle | listening | thinking
  const [heard, setHeard] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const recRef = useRef(null), doneRef = useRef(false);

  const stop = useCallback(() => { try { recRef.current?.abort(); } catch { /* already stopped */ } recRef.current = null; }, []);
  const run = useCallback((raw) => {
    const t = String(raw || '').trim(); if (!t) return;
    stop(); setPhase('thinking'); setHeard(t);
    setTimeout(() => onRun(CHAT_RE.test(t) ? 'ask' : 'do', t), 650);   // a beat of "thinking" so the animation lands
  }, [onRun, stop]);

  const listen = useCallback(() => {
    setError('');
    if (!Ctor) { setError('This browser can’t do voice input (Chrome, Edge and Safari can). Type below instead.'); return; }
    if (!window.isSecureContext) { setError('The microphone only works on a secure page (https:// or localhost).'); return; }
    stop(); doneRef.current = false;
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-IN'; rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onstart = () => { setPhase('listening'); setHeard(''); };
    rec.onresult = (e) => {
      let said = '', final = false;
      for (let i = e.resultIndex; i < e.results.length; i++) { said += e.results[i][0].transcript; if (e.results[i].isFinal) final = true; }
      setHeard(said);
      if (final && !doneRef.current) { doneRef.current = true; run(said); }
    };
    rec.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') setError(ERR[e.error] || 'Voice input stopped. Tap the orb to try again.'); setPhase('idle'); };
    rec.onend = () => setPhase(p => (p === 'listening' ? 'idle' : p));
    recRef.current = rec;
    try { rec.start(); } catch { setPhase('idle'); }
  }, [Ctor, run, stop]);

  useEffect(() => { if (autoListen) listen(); return stop; /* eslint-disable-next-line */ }, []);
  const toggle = () => (phase === 'listening' ? (stop(), setPhase('idle')) : listen());

  const status = phase === 'listening' ? (heard ? 'Listening…' : 'Listening — go ahead and speak') : phase === 'thinking' ? 'On it…' : 'Tap the orb and speak, or type below';

  return (
    <div className="ob-cu-back ob-ai-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className={`ob-cu ob-ai ${phase}`} role="dialog" aria-label="CHEX Orbit AI" data-testid="orbit-ai">
        <button type="button" className="ob-chip ob-x ob-ai-x" onClick={onClose} aria-label="Close CHEX Orbit AI" autoFocus><OrbitIcon name="close" size={18} /></button>

        <div className={`ob-ai-stage ${phase}`}>
          <i className="ob-ai-halo" aria-hidden="true" />
          <i className="ob-ai-ring r1" aria-hidden="true" /><i className="ob-ai-ring r2" aria-hidden="true" /><i className="ob-ai-ring r3" aria-hidden="true" />
          <button type="button" className="ob-ai-orb" onClick={toggle} aria-label={phase === 'listening' ? 'Stop listening' : 'Speak to CHEX Orbit AI'} aria-pressed={phase === 'listening'}>
            <i className="ob-ai-swirl" aria-hidden="true" /><i className="ob-ai-gloss" aria-hidden="true" />
            {phase === 'listening'
              ? <span className="ob-ai-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span>
              : <span className="ob-ai-glyph"><OrbitIcon name={phase === 'thinking' ? 'codex' : 'mic'} size={34} /></span>}
          </button>
        </div>

        <h2 className="ob-ai-title">CHEX Orbit AI</h2>
        <p className="ob-ai-status" aria-live="polite">{status}</p>
        <p className={`ob-ai-heard${heard ? ' on' : ''}`} aria-live="polite">{heard ? `“${heard}”` : ' '}</p>
        {error && <p className="ob-ai-error" role="alert">{error}</p>}

        <form className="oai-row" onSubmit={(e) => { e.preventDefault(); const v = text; setText(''); run(v); }}>
          <input className="oai-in" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask anything, or say what to open or do…" aria-label="Ask CHEX Orbit AI" enterKeyHint="send" />
          <button type="submit" className="oai-go" disabled={!text.trim() || phase === 'thinking'} aria-label="Send"><OrbitIcon name="open" size={18} /></button>
        </form>
        <div className="oai-chips ob-ai-chips">
          {IDEAS.map((label) => <button key={label} type="button" className="oai-chip soft" onClick={() => run(label)}>{label}</button>)}
        </div>
      </section>
    </div>
  );
}
