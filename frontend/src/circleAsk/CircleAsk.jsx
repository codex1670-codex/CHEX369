import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, inPrivateSpace } from '../api.js';
import { getCodexContext } from '../codexContext.js';
import { useGlobalLongPress } from './useGlobalLongPress.js';
import { selectionFromPath, wholeScreen } from './region.js';
import { captureRegion, collectRegionText } from './capture.js';
import { routeStatus, CONTROLS_ONLY_ROUTES } from './sensitive.js';
import { LANGUAGES, LANGUAGE_NAMES, browserLanguageCode, circleAskEnabled, loadPrefs, savePrefs } from './settings.js';
import './circleAsk.css';

// Circle to Ask — press and hold on an empty part of the screen (or tap ⭕ on the Codex bar), circle something,
// approve a preview, then ask Codex about it. The picture is held in memory only, and is gone when the panel closes.

const ACTIONS = [
  ['explain', 'Explain', '💡'], ['simplify', 'Simplify', '🪄'], ['deep', 'Deep Explain', '🔬'],
  ['translate', 'Translate', '🌐'], ['steps', 'Show Steps', '🪜'], ['take_me_there', 'Take Me There', '🧭'],
];
const ACTION_LABEL = Object.fromEntries(ACTIONS.map(([k, l]) => [k, l]));
const QUICK = ['What is this?', 'Why is this used?', 'How does it work?', 'What happens if I click it?', 'How can I fix this?', 'Give me an example'];

const ERROR_TEXT = {
  NOT_CONFIGURED: "The AI service isn't set up on this server yet, so Codex can't answer. Ask whoever runs CHEX to add the AI key.",
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  IMAGE_TOO_LARGE: 'That area is too big. Circle a smaller part.',
  BLOCKED_SCREEN: 'Circle to Ask is switched off on this private screen.',
};

const viewport = () => ({ w: window.innerWidth || 0, h: window.innerHeight || 0 });
const pathD = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${Math.round(p.x)} ${Math.round(p.y)}`).join(' ');

export default function CircleAsk({ navigate, route }) {
  const [enabled, setEnabled] = useState(circleAskEnabled());
  const [phase, setPhase] = useState('idle'); // idle | select | permission | capturing | preview | panel
  const [path, setPath] = useState([]);
  const [rect, setRect] = useState(null);
  const [shot, setShot] = useState(null);         // { image|null, text, controls, hidden, reason? } — memory only
  const [useImage, setUseImage] = useState(true);
  const [skipAsk, setSkipAsk] = useState(false);  // "don't ask me to capture again" — this visit only, never saved
  const [turns, setTurns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [prefs, setPrefs] = useState(loadPrefs());
  const [lang, setLang] = useState(() => loadPrefs().language || browserLanguageCode());
  const [note, setNote] = useState('');
  const drawing = useRef(null);
  const overlayRef = useRef(null);
  const session = useRef(0);
  const status = routeStatus(route, inPrivateSpace());

  useEffect(() => {
    const sync = () => setEnabled(circleAskEnabled());
    window.addEventListener('chex:circle-ask-changed', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('chex:circle-ask-changed', sync); window.removeEventListener('storage', sync); };
  }, []);

  useEffect(() => { if (!note) return undefined; const t = setTimeout(() => setNote(''), 3500); return () => clearTimeout(t); }, [note]);

  const reset = useCallback(() => {
    session.current += 1;               // anything still in flight is ignored
    setPhase('idle'); setPath([]); setRect(null); setShot(null); setTurns([]); setBusy(false); setQuestion(''); drawing.current = null;
  }, []);

  const start = useCallback(() => {
    if (!circleAskEnabled()) { setNote('Turn on Circle to Ask in Settings first.'); return; }
    if (routeStatus(route, inPrivateSpace()) === 'blocked') { setNote('Circle to Ask is switched off on private screens.'); return; }
    session.current += 1;
    setShot(null); setTurns([]); setRect(null); setPath([]); setPhase('select');
  }, [route]);

  useGlobalLongPress(start, { enabled: enabled && phase === 'idle' && status !== 'blocked' });
  useEffect(() => { window.addEventListener('chex:circle-ask-start', start); return () => window.removeEventListener('chex:circle-ask-start', start); }, [start]);
  // A change of page ends any open session (the thing that was circled is gone).
  useEffect(() => { reset(); }, [route, reset]);
  useEffect(() => {
    if (phase === 'idle') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') reset(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, reset]);

  // While circling, the page underneath must not scroll (the circled area is measured in screen position).
  useEffect(() => {
    const el = overlayRef.current;
    if (phase !== 'select' || !el) return undefined;
    const stop = (e) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, [phase]);

  // ---- 1. circle it ----
  const pt = (e) => ({ x: e.clientX, y: e.clientY });
  const onDown = (e) => {
    if (e.button !== undefined && e.button > 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawing.current = [pt(e)]; setPath([pt(e)]);
  };
  const onMove = (e) => { if (drawing.current) { drawing.current.push(pt(e)); setPath([...drawing.current]); } };
  const onUp = () => {
    const pts = drawing.current; drawing.current = null;
    if (!pts) return;
    const sel = selectionFromPath(pts, viewport());
    if (!sel) { setPath([]); setNote('Draw a circle around what you need help with.'); return; }
    chooseArea(sel);
  };
  const chooseArea = (sel) => { setRect(sel); setPath([]); if (skipAsk) capture(true, sel); else setPhase('permission'); };

  // ---- 2. capture (with permission) ----
  const capture = async (allowPicture, sel = rect) => {
    const mine = ++session.current;
    setPhase('capturing');
    let result;
    if (allowPicture && status === 'full') result = await captureRegion(sel, { route });
    else result = { ...collectRegionText(sel, { route }), image: null };
    if (session.current !== mine) return;
    if (!result.image && !result.text) { setNote('Nothing readable in that area. Try circling something else.'); setPath([]); setPhase('select'); return; }
    setShot(result); setUseImage(!!result.image); setPhase('preview');
  };

  // ---- 3. ask ----
  const buildContext = () => {
    const c = getCodexContext(); const p = c.page || {};
    const quiet = CONTROLS_ONLY_ROUTES.has(route);           // chat screens: don't even send the page headings (conversation names)
    return { screen: route || c.screen, title: quiet ? '' : p.title, headings: quiet ? [] : p.headings, activeTabs: quiet ? [] : p.activeTabs, device: p.device };
  };

  const ask = async (mode, text, current = turns, snap = shot, withImage = useImage) => {
    const mine = session.current;
    const label = mode === 'ask' ? text : ACTION_LABEL[mode];
    setTurns([...current, { role: 'user', text: label }]);
    setBusy(true);
    const history = current.filter((t) => !t.error).slice(-6).map((t) => ({ role: t.role, text: t.role === 'user' ? t.text : t.answer || '' }));
    const sendImage = withImage && snap?.image;
    try {
      const res = await api.circleAsk({
        mode, question: mode === 'ask' ? text : undefined,
        language: mode === 'translate' || prefs.remember ? LANGUAGE_NAMES[lang] : undefined,
        locale: navigator.language || 'en',
        regionText: snap?.text || '',
        context: buildContext(),
        history,
        ...(sendImage ? { consent: true, image: { mediaType: snap.image.mediaType, data: snap.image.data } } : {}),
      });
      if (session.current !== mine) return;
      setTurns((t) => [...t, { role: 'assistant', mode, answer: res.answer, steps: res.steps || [], navigate: res.navigate, followUps: res.followUps || [], usedImage: !!res.usedImage }]);
    } catch (err) {
      if (session.current !== mine) return;
      setTurns((t) => [...t, { role: 'assistant', error: true, answer: ERROR_TEXT[err.code] || err.message || 'Something went wrong. Please try again.' }]);
    } finally { if (session.current === mine) setBusy(false); }
  };

  const send = () => { setPhase('panel'); ask('explain', '', [], shot, useImage && !!shot?.image); };
  const submitQuestion = (e) => { e.preventDefault(); const q = question.trim(); if (!q || busy) return; setQuestion(''); ask('ask', q); };
  const rememberLang = (remember, language) => { const p = savePrefs({ remember, language }); setPrefs(p); };
  const takeMeThere = (turnIndex) => { const n = turns[turnIndex]?.navigate; if (!n) return; reset(); navigate?.(n.screen); };
  const dismissNav = (i) => setTurns((t) => t.map((x, k) => (k === i ? { ...x, navigate: null } : x)));
  const dropPicture = () => { setUseImage(false); setShot((s) => (s ? { ...s, image: null } : s)); setNote('Picture deleted. Codex will use the text only.'); };

  const lastAssistant = useMemo(() => { for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === 'assistant') return i; return -1; }, [turns]);
  const vp = viewport();
  const hole = rect && (phase === 'permission' || phase === 'capturing' || phase === 'preview' || phase === 'panel') ? rect : null;

  return (
    <>
      {note && <div className="circle-toast glass-card" role="status" data-circle-ui>{note}</div>}

      {phase === 'select' && (
        <div className="circle-overlay" ref={overlayRef} role="application" aria-label="Draw a circle around what you need help with" data-circle-ui data-noswipe onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drawing.current = null; setPath([]); }} onContextMenu={(e) => e.preventDefault()}>
          <svg className="circle-svg" width={vp.w} height={vp.h} aria-hidden="true">{path.length > 1 && <path d={pathD(path)} className="circle-stroke" />}</svg>
          <div className="circle-banner glass-card" onPointerDown={(e) => e.stopPropagation()}>
            <b>⭕ Circle what you need help with</b>
            <span>Draw around it with your finger or mouse.</span>
            <div className="circle-row">
              <button type="button" className="btn-ghost circle-small" onClick={() => chooseArea(wholeScreen(viewport()))}>Whole screen</button>
              <button type="button" className="btn-ghost circle-small" onClick={reset}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {hole && <div className="circle-hole" data-circle-ui style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} aria-hidden="true" />}

      {phase === 'permission' && (
        <div className="circle-sheet glass-card" role="dialog" aria-modal="true" aria-label="Let Codex look at this area?" data-circle-ui data-noswipe>
          <h3>Let Codex look at this area?</h3>
          {status === 'full' ? (
            <p>Only the circled area is captured — nothing else on your screen and nothing from other apps. Passwords, card details and private messages are blacked out first. <b>Nothing is sent until you approve a preview.</b></p>
          ) : (
            <p>On this screen Codex can only read <b>button and heading labels</b> — never pictures or message content. You will see exactly what it reads before anything is sent.</p>
          )}
          <label className="circle-check"><input type="checkbox" checked={skipAsk} onChange={(e) => setSkipAsk(e.target.checked)} /> Don't ask me to capture again until I close CHEX</label>
          <div className="circle-row">
            {status === 'full' && <button type="button" className="btn-primary circle-small" onClick={() => capture(true)}>Capture &amp; preview</button>}
            <button type="button" className={status === 'full' ? 'btn-ghost circle-small' : 'btn-primary circle-small'} onClick={() => capture(false)}>{status === 'full' ? 'Text only' : 'Read labels'}</button>
            <button type="button" className="btn-ghost circle-small" onClick={reset}>Cancel</button>
          </div>
        </div>
      )}

      {phase === 'capturing' && <div className="circle-sheet glass-card" role="status" data-circle-ui><span className="loading-dot" /> Capturing the circled area…</div>}

      {phase === 'preview' && shot && (
        <div className="circle-sheet glass-card" role="dialog" aria-modal="true" aria-label="Preview before sending" data-circle-ui data-noswipe>
          <h3>Send this to Codex?</h3>
          {shot.image ? <img className="circle-thumb" src={shot.image.previewUrl} alt="The circled area that will be sent" /> : <p className="circle-dim">{shot.reason === 'capture-failed' ? "The picture couldn't be captured here, so Codex will read the text only." : 'Only text will be sent.'}</p>}
          {shot.hidden > 0 && <p className="circle-dim">🔒 {shot.hidden} private item{shot.hidden === 1 ? '' : 's'} hidden</p>}
          <details><summary>Text Codex will read</summary><p className="circle-text">{shot.text || '(nothing)'}</p></details>
          {shot.image && <label className="circle-check"><input type="checkbox" checked={useImage} onChange={(e) => setUseImage(e.target.checked)} /> Include the picture (uncheck to send text only)</label>}
          <p className="circle-dim">Held in memory only. Deleted when you close this.</p>
          <div className="circle-row">
            <button type="button" className="btn-primary circle-small" onClick={send}>Send to Codex</button>
            <button type="button" className="btn-ghost circle-small" onClick={() => { setShot(null); setPath([]); setRect(null); setPhase('select'); }}>Retake</button>
            <button type="button" className="btn-ghost circle-small" onClick={reset}>Cancel</button>
          </div>
        </div>
      )}

      {phase === 'panel' && (
        <div className="circle-panel glass-card" role="dialog" aria-label="Circle to Ask" data-circle-ui data-noswipe>
          <div className="circle-head">
            {shot?.image ? <img src={shot.image.previewUrl} alt="" className="circle-mini" /> : <span className="circle-mini circle-mini-ph">📝</span>}
            <div className="circle-title"><b>Circle to Ask</b><span>{shot?.image && useImage ? '🔒 Using the picture you approved' : '🔒 Text only'}</span></div>
            {shot?.image && <button type="button" className="circle-icon" onClick={dropPicture} aria-label="Delete the picture" title="Delete the picture">🗑</button>}
            <button type="button" className="circle-icon" onClick={reset} aria-label="Close and delete everything" title="Close">✕</button>
          </div>

          <div className="circle-chips" role="group" aria-label="Help type">
            {ACTIONS.map(([k, label, icon]) => <button key={k} type="button" className="circle-chip" disabled={busy} onClick={() => ask(k, '')}>{icon} {label}</button>)}
          </div>
          <div className="circle-lang">
            <label>Language <select value={lang} onChange={(e) => { setLang(e.target.value); if (prefs.remember) rememberLang(true, e.target.value); }} aria-label="Language">{LANGUAGES.map(([n, c]) => <option key={c} value={c}>{n}</option>)}</select></label>
            <label className="circle-check"><input type="checkbox" checked={prefs.remember} onChange={(e) => rememberLang(e.target.checked, lang)} /> Remember my language on this device</label>
          </div>

          <div className="circle-log" aria-live="polite">
            {turns.map((t, i) => t.role === 'user' ? (
              <div key={i} className="circle-msg me">{t.text}</div>
            ) : (
              <div key={i} className={`circle-msg codex${t.error ? ' err' : ''}`}>
                <div>{t.answer}</div>
                {t.steps?.length > 0 && <ol className="circle-steps">{t.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>}
                {t.navigate && (
                  <div className="circle-nav">
                    <span>🧭 Take you to <b>{t.navigate.label}</b>?{t.navigate.reason ? ` ${t.navigate.reason}` : ''}</span>
                    <div className="circle-row">
                      <button type="button" className="btn-primary circle-small" onClick={() => takeMeThere(i)}>Take me there</button>
                      <button type="button" className="btn-ghost circle-small" onClick={() => dismissNav(i)}>Not now</button>
                    </div>
                  </div>
                )}
                {i === lastAssistant && !t.error && t.followUps?.length > 0 && <div className="circle-chips">{t.followUps.map((f) => <button key={f} type="button" className="circle-chip soft" disabled={busy} onClick={() => ask('ask', f)}>{f}</button>)}</div>}
              </div>
            ))}
            {busy && <div className="circle-msg codex"><span className="loading-dot" /></div>}
          </div>

          <div className="circle-chips quick" role="group" aria-label="Quick questions">
            {QUICK.map((q) => <button key={q} type="button" className="circle-chip soft" disabled={busy} onClick={() => ask('ask', q)}>{q}</button>)}
          </div>
          <form className="circle-ask" onSubmit={submitQuestion}>
            <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask anything about this…" aria-label="Ask about the circled area" maxLength={400} autoComplete="off" />
            <button type="submit" className="codex-send" disabled={busy || !question.trim()} aria-label="Send question">➤</button>
          </form>
        </div>
      )}
    </>
  );
}
