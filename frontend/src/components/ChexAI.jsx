import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import OrbitIcon from '../orbit/OrbitIcon.jsx';

// CHEX AI — the talking assistant. It is the front end of the CODEX AI platform on the server:
//   • chat / coding / explanations ........ Groq (Text AI), streamed word by word
//   • "what is in this picture?" ........... Groq (Vision AI)
//   • "draw / generate an image of …" ...... Cloudflare Workers AI (Image AI)
//   • "make a video of …" .................. Video AI (experimental, admin switches it on)
//   • mic → text / read aloud .............. Cloudflare Speech-to-text and Text-to-speech
// The server decides which engine answers (it is deterministic and free), so the buttons below only *nudge* it.
// Opened from the Orbit / ＋ / ⋯ menu with window.dispatchEvent(new Event('chex:ai-open')). There is no floating bar.

const MODES = [
  { id: 'auto',  label: 'Auto',  hint: 'I decide: chat, image or video' },
  { id: 'chat',  label: 'Chat',  hint: 'Just talk' },
  { id: 'image', label: 'Image', hint: 'Describe a picture to draw' },
  { id: 'video', label: 'Video', hint: 'Describe a short video' },
];
const PLACEHOLDER = { auto: 'Ask anything, or say “draw a red fox”…', chat: 'Ask me anything…', image: 'Describe the image…', video: 'Describe the video…' };
const IDEAS = ['Explain black holes like I’m 12', 'Draw a neon city at night', 'Make a video of waves at sunset', 'Write a polite message declining an invite'];
const HELLO = { id: 'hello', who: 'ai', text: 'Hi, I’m CHEX AI. Talk to me like a person: ask questions, get help with code or homework, or tell me to draw an image or make a video.', media: [] };

let seq = 0; const uid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

function Media({ m }) {
  if (m.kind === 'image') return <a href={m.url} target="_blank" rel="noreferrer" className="cai-media"><img src={m.url} alt={m.prompt || 'Generated image'} loading="lazy" /></a>;
  if (m.kind === 'video') return <div className="cai-media"><video src={m.url} controls playsInline loop preload="metadata" /></div>;
  if (m.kind === 'audio') return <div className="cai-media"><audio src={m.url} controls preload="none" /></div>;
  return null;
}

export default function ChexAI({ currentUser }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([HELLO]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [engines, setEngines] = useState({});        // engine -> { state, message }
  const [speakOn, setSpeakOn] = useState(false);     // read replies aloud with the device's own voice (free)
  const convRef = useRef(null), abortRef = useRef(null), logRef = useRef(null), inputRef = useRef(null), recRef = useRef(null);
  const speakRef = useRef(false); speakRef.current = speakOn;

  // open / close (the menu fires chex:ai-open; Codex's command bar and this panel never show together)
  useEffect(() => {
    const onOpen = (e) => { setOpen(true); const t = e?.detail?.text; if (t) setTimeout(() => send(t), 250); else setTimeout(() => inputRef.current?.focus?.(), 250); };
    const onCodex = () => setOpen(false);
    window.addEventListener('chex:ai-open', onOpen); window.addEventListener('chex:codex-open', onCodex);
    return () => { window.removeEventListener('chex:ai-open', onOpen); window.removeEventListener('chex:codex-open', onCodex); };
  });
  useEffect(() => {
    document.documentElement.classList.toggle('codex-split', open);
    return () => { if (open) document.documentElement.classList.remove('codex-split'); };
  }, [open]);
  useEffect(() => { logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight }); }, [msgs]);
  // which engines are ready (so Image / Video explain themselves instead of failing)
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    api.aiStatus().then(r => { if (live) setEngines(Object.fromEntries((r.engines || []).map(e => [e.engine, e]))); }).catch(() => {});
    return () => { live = false; };
  }, [open]);
  useEffect(() => () => { abortRef.current?.abort(); try { recRef.current?.stop(); } catch { /* not recording */ } window.speechSynthesis?.cancel?.(); }, []);

  const patch = (id, fn) => setMsgs(list => list.map(m => (m.id === id ? { ...m, ...fn(m) } : m)));
  const speak = useCallback((text) => {
    try { if (!window.speechSynthesis || !text) return; window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text.replace(/[*_`#]/g, ''))); } catch { /* no voice */ }
  }, []);

  const send = useCallback(async (raw, forced) => {
    const text = String(raw ?? '').trim();
    if (!text || busy) return;
    const id = uid();
    setMsgs(list => [...list, { id: uid(), who: 'me', text, media: [] }, { id, who: 'ai', text: '', media: [], pending: true, label: '' }]);
    setInput(''); setBusy(true);
    const ctl = new AbortController(); abortRef.current = ctl;
    let handoff = null;
    try {
      await api.aiChat({ text, engine: forced || mode, conversationId: convRef.current, save: true }, (ev, d) => {
        if (ev === 'route') patch(id, () => ({ label: d.label }));
        else if (ev === 'token') patch(id, m => ({ text: m.text + d.text }));
        else if (ev === 'media') patch(id, m => ({ media: [...m.media, d] }));
        else if (ev === 'command') handoff = d.text;
        else if (ev === 'error') patch(id, () => ({ error: true, limitation: !!d.limitation, text: d.message }));
        else if (ev === 'done') { if (d.conversationId) convRef.current = d.conversationId; }
      }, ctl.signal);
    } catch (e) {
      if (e?.name !== 'AbortError') patch(id, () => ({ error: true, text: e?.message || 'Something went wrong. Please try again.' }));
    } finally {
      abortRef.current = null; setBusy(false);
      patch(id, m => ({ pending: false, text: m.text || (m.media.length || handoff ? m.text : '…') }));
      if (handoff) {   // "open reels" and friends are app commands: the command bar (Codex) runs them
        patch(id, () => ({ text: `That’s an app action, so I’m handing it to the command bar: “${handoff}”.` }));
        setTimeout(() => window.dispatchEvent(new CustomEvent('chex:codex-open', { detail: { mode: 'full', run: handoff } })), 500);
      }
      setMsgs(list => { const m = list.find(x => x.id === id); if (m && speakRef.current && !m.error && m.text && !handoff) speak(m.text); return list; });
    }
  }, [busy, mode, speak]);

  const stop = () => abortRef.current?.abort();
  const newChat = () => { stop(); convRef.current = null; setMsgs([HELLO]); setInput(''); };
  const close = () => { stop(); window.speechSynthesis?.cancel?.(); setOpen(false); };

  // mic: record → upload → Cloudflare speech-to-text → text in the box (so it can be fixed before sending)
  const toggleMic = async () => {
    if (recording) { try { recRef.current?.stop(); } catch { /* already stopped */ } return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream); const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop()); setRecording(false);
        try {
          const file = new File([new Blob(chunks, { type: rec.mimeType || 'audio/webm' })], 'voice.webm', { type: rec.mimeType || 'audio/webm' });
          const up = await api.aiUpload(file);
          const r = await api.aiTranscribe(up.media.id);
          if (r.text) { setInput(v => `${v ? `${v} ` : ''}${r.text}`); inputRef.current?.focus?.(); }
          else setMsgs(l => [...l, { id: uid(), who: 'ai', text: 'I couldn’t hear anything in that recording.', media: [], error: true }]);
        } catch (e) { setMsgs(l => [...l, { id: uid(), who: 'ai', text: e?.message || 'The mic isn’t available right now.', media: [], error: true }]); }
      };
      recRef.current = rec; rec.start(); setRecording(true);
      setTimeout(() => { try { if (rec.state === 'recording') rec.stop(); } catch { /* done */ } }, 30_000);
    } catch { setMsgs(l => [...l, { id: uid(), who: 'ai', text: 'Allow microphone access to talk to me.', media: [], error: true }]); }
  };

  if (!open) return null;
  const modeOff = (id) => { const e = engines[id]; return e && ['disabled', 'not_configured'].includes(e.state) ? e.message : ''; };
  const first = (currentUser?.displayName || currentUser?.username || '').split(' ')[0];

  return (
    <div className="glass-card codex-panel cai-panel" role="dialog" aria-label="CHEX AI">
      <div className="codex-panel-header">
        <span className="t cai-title"><OrbitIcon name="codex" size={18} /> CHEX AI</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button type="button" onClick={() => { const n = !speakOn; setSpeakOn(n); if (!n) window.speechSynthesis?.cancel?.(); }} title={speakOn ? 'Spoken replies on' : 'Spoken replies off'} aria-pressed={speakOn} aria-label="Toggle spoken replies" style={{ opacity: speakOn ? 1 : 0.45 }}><OrbitIcon name="volume" size={18} /></button>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('chex:codex-open', { detail: { mode: 'full' } }))} title="Command bar: tell CHEX what to do in the app" aria-label="Open command bar"><OrbitIcon name="lasso" size={18} /></button>
          <button type="button" onClick={newChat} title="New chat" aria-label="New chat"><OrbitIcon name="chat" size={18} /></button>
          <button type="button" onClick={close} aria-label="Close CHEX AI">✕</button>
        </div>
      </div>

      <div className="codex-log cai-log" ref={logRef} aria-live="polite">
        {msgs.map(m => (
          <div key={m.id} className={`codex-msg ${m.who === 'me' ? 'user' : 'codex'} cai-msg${m.error ? ' err' : ''}${m.limitation ? ' lim' : ''}`}>
            <span className="who">{m.who === 'me' ? (first || 'You') : `CHEX AI${m.label && m.label !== 'Text AI' ? ` · ${m.label}` : ''}`}</span>
            {m.text && <span className="cai-text">{m.text}</span>}
            {m.pending && !m.text && !m.media.length && <span className="cai-typing" aria-label="Thinking"><i /><i /><i /></span>}
            {m.pending && !m.text && /^(Image|Video)/.test(m.label || '') && <span className="cai-making">{m.label === 'Video AI' ? 'Making your video… this can take a minute.' : 'Drawing your picture…'}</span>}
            {m.media.map(x => <Media key={x.id} m={x} />)}
            {m.who === 'ai' && !m.pending && m.text && !m.error && m.id !== 'hello' && <button type="button" className="cai-say" onClick={() => speak(m.text)} aria-label="Read this aloud"><OrbitIcon name="volume" size={14} /></button>}
          </div>
        ))}
        {msgs.length === 1 && <div className="cai-ideas">{IDEAS.map(t => <button key={t} type="button" onClick={() => send(t)}>{t}</button>)}</div>}
      </div>

      <div className="cai-modes" role="group" aria-label="What should I do?">
        {MODES.map(x => { const off = modeOff(x.id); return (
          <button key={x.id} type="button" className={mode === x.id ? 'on' : ''} aria-pressed={mode === x.id} disabled={!!off} title={off || x.hint} onClick={() => setMode(x.id)}>{x.label}</button>
        ); })}
      </div>
      <form className="codex-input-row cai-row" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <button type="button" className={`cai-mic${recording ? ' rec' : ''}`} onClick={toggleMic} aria-label={recording ? 'Stop recording' : 'Talk to CHEX AI'} title={recording ? 'Tap to stop' : 'Tap to talk'}><OrbitIcon name="mic" size={18} /></button>
        <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} placeholder={recording ? 'Listening… tap the mic to stop' : PLACEHOLDER[mode]} aria-label="Message CHEX AI" enterKeyHint="send" autoComplete="off" maxLength={4000} />
        {busy
          ? <button type="button" className="codex-send cai-stop" onClick={stop} aria-label="Stop" title="Stop">■</button>
          : <button type="submit" className="codex-send" disabled={!input.trim()} aria-label="Send to CHEX AI" title="Send">➤</button>}
      </form>
    </div>
  );
}
