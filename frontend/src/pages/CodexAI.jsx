import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { getCodexContext } from '../codexContext.js';
import { applyTheme } from '../theme.js';
import './codexai.css';

// CODEX AI — one interface for Text, Vision, Image, Video, Audio and Memory. The server (CODEX) decides which engine
// answers; this page shows which one it picked, streams the answer, previews media, and states limits plainly.

const MODES = [['auto', '✨ Auto'], ['chat', '💬 Chat'], ['image', '🎨 Image'], ['video', '🎬 Video'], ['speak', '🔊 Speak']];
const TABS = [['chat', 'Chat'], ['history', 'History'], ['memory', 'Memory'], ['gallery', 'Gallery'], ['limits', 'Limits']];
const STATE_TEXT = { ready: 'Ready', disabled: 'Off', not_configured: 'Not set up', cooldown: 'Paused', limit_reached: 'Limit reached' };
const ENGINE_ICON = { text: '💬', vision: '👁️', image: '🎨', video: '🎬', stt: '🎤', tts: '🔊', memory: '🧠', command: '⚡' };
const MAX_REC_SECONDS = 60;
let uid = 0; const nextId = (p) => `${p}${Date.now().toString(36)}${uid++}`;

// Splits ```code``` fences so coding answers render as code blocks. Everything else is plain text (React escapes it).
function Rich({ text }) {
  const parts = String(text || '').split(/```/);
  return parts.map((p, i) => (i % 2 ? <pre key={i} className="cai-code"><code>{p.replace(/^[a-z0-9+#-]*\n/i, '')}</code></pre> : p ? <span key={i} className="cai-plain">{p}</span> : null));
}

function MediaView({ m }) {
  if (m.kind === 'image') return <a href={m.url} target="_blank" rel="noreferrer"><img className="cai-img" src={m.url} alt={m.prompt || 'Image'} loading="lazy" /></a>;
  if (m.kind === 'audio') return <audio className="cai-audio" src={m.url} controls preload="none" />;
  if (m.kind === 'video') return <video className="cai-video" src={m.url} controls preload="metadata" playsInline />;
  return null;
}

export default function CodexAI({ onBack, navigate }) {
  const [tab, setTab] = useState('chat');
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('auto');
  const [attachments, setAttachments] = useState([]);
  const [temporary, setTemporary] = useState(false);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState('');
  const [conversations, setConversations] = useState(null);
  const [memories, setMemories] = useState(null);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [gallery, setGallery] = useState(null);
  const abortRef = useRef(null); const recRef = useRef(null); const logRef = useRef(null); const fileRef = useRef(null); const recTimer = useRef(null);

  const say = (m) => { setNotice(m); if (m) setTimeout(() => setNotice((cur) => (cur === m ? '' : cur)), 6000); };
  const loadStatus = useCallback(() => api.aiStatus().then(setStatus).catch(() => {}), []);
  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => () => { abortRef.current?.abort(); clearTimeout(recTimer.current); recRef.current?.stream?.getTracks?.().forEach((t) => t.stop()); }, []);
  useEffect(() => { logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight }); }, [messages]);

  const patch = (id, fn) => setMessages((ms) => ms.map((x) => (x.id === id ? fn(x) : x)));

  // ---------- app commands: handed to the existing Codex action engine (with its confirmations) ----------
  const showCommandResult = (id, res) => {
    if (res.needsConfirmation) return patch(id, (x) => ({ ...x, text: res.message, pending: { kind: 'confirm', pendingAction: res.pendingAction, remaining: res.remainingActions || [] } }));
    if (res.needsDisambiguation) return patch(id, (x) => ({ ...x, text: res.message, pending: { kind: 'pick', pendingAction: res.pendingAction, remaining: res.remainingActions || [], candidates: res.candidates || [] } }));
    if (res.needsPreview) return patch(id, (x) => ({ ...x, text: res.message, pending: { kind: 'plan', plan: res.pendingPlan } }));
    patch(id, (x) => ({ ...x, text: res.message || (res.handled === false ? 'I couldn’t run that as an app command.' : 'Done.'), pending: null }));
    if (res.navigate) navigate?.(res.navigate.screen, res.navigate);
    if (res.openUrl) window.open(res.openUrl, '_blank', 'noopener');
    if (res.setTheme) applyTheme(res.setTheme, true);
    if (res.stickyChanged) window.dispatchEvent(new Event('chex:stickies-changed'));
  };
  const runCommand = async (text, id) => {
    patch(id, (x) => ({ ...x, text: 'Running that app command…' }));
    try { showCommandResult(id, await api.codexAct(text, getCodexContext(), [])); }
    catch (e) { patch(id, (x) => ({ ...x, text: e.message, error: true })); }
  };
  const answerPending = async (id, p, choice) => {
    patch(id, (x) => ({ ...x, pending: null, text: 'Working on it…' }));
    try {
      let res;
      if (choice === 'no') return patch(id, (x) => ({ ...x, text: 'Cancelled.' }));
      if (p.kind === 'confirm') res = await api.codexConfirm(p.pendingAction, p.remaining, getCodexContext());
      else if (p.kind === 'plan') res = await api.codexConfirmPlan(p.plan, getCodexContext());
      else res = await api.codexResolve({ name: p.pendingAction.name, input: { ...p.pendingAction.input, username: choice } }, p.remaining, getCodexContext());
      showCommandResult(id, res);
    } catch (e) { patch(id, (x) => ({ ...x, text: e.message, error: true })); }
  };

  // ---------- chat ----------
  const send = async (override) => {
    const text = (override ?? input).trim();
    if ((!text && !attachments.length) || sending) return;
    const ctl = new AbortController(); abortRef.current = ctl;
    const sent = attachments; const aiId = nextId('a');
    setMessages((m) => [...m, { id: nextId('u'), role: 'user', text, media: sent }, { id: aiId, role: 'assistant', text: '', media: [], streaming: true, speakText: text.replace(/^\s*\/(speak|say|tts)\s*/i, '') }]);
    setInput(''); setAttachments([]); setSending(true); setNotice('');
    try {
      await api.aiChat({ text, engine: mode, attachmentIds: sent.map((a) => a.id), conversationId, save: !temporary }, (ev, d) => {
        if (ev === 'route') patch(aiId, (x) => ({ ...x, route: d, engine: d.engine }));
        else if (ev === 'token') patch(aiId, (x) => ({ ...x, text: x.text + d.text }));
        else if (ev === 'transcript') patch(aiId, (x) => ({ ...x, transcript: d.text }));
        else if (ev === 'media') patch(aiId, (x) => ({ ...x, media: [...x.media, d] }));
        else if (ev === 'memory_proposal') patch(aiId, (x) => ({ ...x, proposal: d.text }));
        else if (ev === 'command') runCommand(d.text, aiId);
        else if (ev === 'warning') say(d.message);
        else if (ev === 'error') patch(aiId, (x) => ({ ...x, text: x.text || d.message, error: true, limitation: d.limitation, fallback: d.fallback }));
        else if (ev === 'done' && d.conversationId) setConversationId(d.conversationId);
      }, ctl.signal);
    } catch (e) {
      if (e.name !== 'AbortError') patch(aiId, (x) => ({ ...x, text: e.message || 'Something went wrong.', error: true }));
    } finally {
      patch(aiId, (x) => ({ ...x, streaming: false })); setSending(false); abortRef.current = null; loadStatus();
    }
  };
  const stop = () => abortRef.current?.abort();
  const newChat = () => { setMessages([]); setConversationId(null); setTab('chat'); };

  // ---------- attachments + microphone ----------
  const attach = async (file) => {
    if (!file) return;
    try { const r = await api.aiUpload(file); setAttachments((a) => [...a, r.media].slice(0, 4)); }
    catch (e) { say(e.message); }
  };
  const transcribe = async (blob) => {
    try {
      if (blob.size > 2 * 1024 * 1024) return say('That recording is too long. Keep it under about a minute.');
      const up = await api.aiUpload(new File([blob], 'voice', { type: blob.type }));
      const r = await api.aiTranscribe(up.media.id);
      if (r.text) setInput((t) => (t ? `${t} ` : '') + r.text); else say('I couldn’t hear any speech.');
    } catch (e) { say(e.message); }
  };
  const toggleRecord = async () => {
    if (recording) { recRef.current?.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return say('Voice recording isn’t supported in this browser.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t));
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); const chunks = [];
      rec.stream = stream;
      rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
      rec.onstop = () => { clearTimeout(recTimer.current); stream.getTracks().forEach((t) => t.stop()); setRecording(false); recRef.current = null; if (chunks.length) transcribe(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); };
      recRef.current = rec; rec.start(); setRecording(true);
      recTimer.current = setTimeout(() => rec.state !== 'inactive' && rec.stop(), MAX_REC_SECONDS * 1000);
    } catch { say('Microphone permission was denied.'); }
  };
  const readAloud = (t) => { try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(t)); } catch { say('Read-aloud isn’t available on this device.'); } };

  // ---------- history / memory / gallery ----------
  const openTab = (t) => {
    setTab(t);
    if (t === 'history') api.aiConversations().then((r) => setConversations(r.conversations)).catch((e) => { setConversations([]); say(e.message); });
    if (t === 'memory') api.aiMemory().then((r) => setMemories(r.memories)).catch((e) => { setMemories([]); say(e.message); });
    if (t === 'gallery') api.aiMedia().then((r) => setGallery(r.media)).catch(() => setGallery([]));
    if (t === 'limits') loadStatus();
  };
  const openConversation = async (id) => {
    try {
      const c = await api.aiConversation(id);
      setMessages(c.messages.map((m) => ({ id: m.id, role: m.role, text: m.text, engine: m.engine, media: m.media || [], error: m.error, route: m.engine ? { engine: m.engine, label: '' } : undefined })));
      setConversationId(id); setTab('chat');
    } catch (e) { say(e.message); }
  };
  const deleteConversation = async (id) => { await api.aiDeleteConversation(id).catch((e) => say(e.message)); setConversations((c) => (c || []).filter((x) => x.id !== id)); if (id === conversationId) newChat(); };
  const saveMemory = async (text, source = 'user') => {
    try { const r = await api.aiAddMemory(text, source); setMemories((m) => [r.memory, ...(m || [])]); say('Saved to memory.'); return true; } catch (e) { say(e.message); return false; }
  };
  const deleteMemory = async (id) => { await api.aiDeleteMemory(id).catch((e) => say(e.message)); setMemories((m) => (m || []).filter((x) => x.id !== id)); };
  const deleteAll = async () => {
    if (!window.confirm('Delete all your CODEX AI chats, memories and files? This can’t be undone.')) return;
    try { await api.aiDeleteAllData(); setConversations([]); setMemories([]); setGallery([]); newChat(); say('Everything was deleted.'); } catch (e) { say(e.message); }
  };

  const engines = status?.engines || [];
  const chip = (e) => (
    <button key={e.engine} type="button" className={`cai-chip st-${e.state}`} title={e.message || `${e.label}: ${STATE_TEXT[e.state]}`} onClick={() => openTab('limits')}>
      <span className="cai-dot" />{ENGINE_ICON[e.engine]} {e.label}{e.experimental ? ' (beta)' : ''}
    </button>
  );

  return (
    <div className="cai-page">
      <div className="cai-head glass-card">
        <button type="button" className="btn-ghost cai-back" onClick={onBack} aria-label="Back">←</button>
        <div className="cai-title"><b>🧠 CODEX AI</b><span>Text · Vision · Image · Video · Audio · Memory</span></div>
        <button type="button" className="btn-ghost cai-small" onClick={newChat}>＋ New</button>
      </div>
      <div className="cai-chips" aria-label="AI engine status">{engines.map(chip)}</div>
      {status?.freeOnly && <div className="cai-note">🆓 Free-only mode: CODEX never uses paid services. Free plans have limits and can pause — you’ll always be told when that happens.</div>}
      <div className="cai-tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => openTab(k)}>{l}</button>)}</div>
      {notice && <div className="cai-toast" role="status">{notice}</div>}

      {tab === 'chat' && (
        <div className="cai-chat">
          <div className="cai-log" ref={logRef} aria-live="polite">
            {!messages.length && (
              <div className="cai-empty">
                <b>Ask anything.</b> CODEX picks the right AI for you:
                <ul>
                  <li>💬 Questions, coding, explanations</li><li>🎨 “Draw a red fox in the snow”</li><li>👁️ Attach a picture or screenshot and ask about it</li>
                  <li>🎤 Tap the mic to talk</li><li>🔊 “/speak Hello from CHEX”</li><li>🧠 “Remember that I like short answers”</li>
                </ul>
              </div>
            )}
            {messages.map((m) => m.role === 'user' ? (
              <div key={m.id} className="cai-msg me">
                {m.text ? <Rich text={m.text} /> : <span className="cai-plain">🎤 Voice message</span>}
                {m.media?.map((x) => <MediaView key={x.id} m={x} />)}
              </div>
            ) : (
              <div key={m.id} className={`cai-msg ai${m.error ? ' err' : ''}${m.limitation ? ' limit' : ''}`}>
                {m.route && <div className="cai-route">{ENGINE_ICON[m.route.engine]} {m.route.label || 'CODEX'}{m.route.reason ? ` — ${m.route.reason}` : ''}</div>}
                {m.transcript && <div className="cai-heard">🎤 Heard: “{m.transcript}”</div>}
                {m.text ? <Rich text={m.text} /> : m.streaming ? <span className="loading-dot" /> : null}
                {m.media?.map((x) => <MediaView key={x.id} m={x} />)}
                {m.pending?.kind === 'confirm' || m.pending?.kind === 'plan' ? (
                  <div className="cai-row"><button type="button" className="btn-primary cai-small" onClick={() => answerPending(m.id, m.pending, 'yes')}>Confirm</button><button type="button" className="btn-ghost cai-small" onClick={() => answerPending(m.id, m.pending, 'no')}>Cancel</button></div>
                ) : m.pending?.kind === 'pick' ? (
                  <div className="cai-row">{m.pending.candidates.map((c) => <button key={c.username} type="button" className="btn-ghost cai-small" onClick={() => answerPending(m.id, m.pending, c.username)}>@{c.username}</button>)}<button type="button" className="btn-ghost cai-small" onClick={() => answerPending(m.id, m.pending, 'no')}>Cancel</button></div>
                ) : null}
                {m.proposal && (
                  <div className="cai-proposal">🧠 Save “{m.proposal}” to your memory?
                    <div className="cai-row"><button type="button" className="btn-primary cai-small" onClick={async () => { if (await saveMemory(m.proposal, 'chat')) patch(m.id, (x) => ({ ...x, proposal: null })); }}>Save to memory</button><button type="button" className="btn-ghost cai-small" onClick={() => patch(m.id, (x) => ({ ...x, proposal: null }))}>No thanks</button></div>
                  </div>
                )}
                {m.fallback === 'browser-speech' && m.speakText && <div className="cai-row"><button type="button" className="btn-ghost cai-small" onClick={() => readAloud(m.speakText)}>🔊 Read aloud on this device</button></div>}
                {!m.error && !m.streaming && m.text && (!m.route || m.route.engine === 'text' || m.route.engine === 'vision') && <button type="button" className="cai-tiny" onClick={() => readAloud(m.text)} aria-label="Read this answer aloud on this device" title="Read aloud on this device">🔊</button>}
              </div>
            ))}
          </div>

          <div className="cai-composer glass-card">
            {attachments.length > 0 && <div className="cai-attach">{attachments.map((a) => <span key={a.id} className="cai-att">{a.kind === 'image' ? <img src={a.url} alt="" /> : '🎤'}<button type="button" aria-label="Remove attachment" onClick={() => setAttachments((x) => x.filter((y) => y.id !== a.id))}>✕</button></span>)}</div>}
            <div className="cai-modes" role="group" aria-label="Choose an AI">{MODES.map(([k, l]) => <button key={k} type="button" className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>)}</div>
            <form className="cai-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <input ref={fileRef} type="file" accept="image/*" hidden aria-label="Attach a picture" onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ''; }} />
              <button type="button" className="cai-icon" onClick={() => fileRef.current?.click()} aria-label="Attach a picture" title="Attach a picture or screenshot">📎</button>
              <button type="button" className={`cai-icon${recording ? ' rec' : ''}`} onClick={toggleRecord} aria-label={recording ? 'Stop recording' : 'Record your voice'} title={recording ? 'Stop' : 'Speak'}>{recording ? '⏹' : '🎤'}</button>
              <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={recording ? 'Listening… tap ⏹ when done' : 'Message CODEX…'} aria-label="Message CODEX" rows={1} maxLength={4000} />
              {sending ? <button type="button" className="codex-send" onClick={stop} aria-label="Stop">⏹</button> : <button type="submit" className="codex-send" disabled={!input.trim() && !attachments.length} aria-label="Send">➤</button>}
            </form>
            <label className="cai-check"><input type="checkbox" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} /> Temporary chat (don’t save history)</label>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="cai-panel glass-card">
          <h3>Chat history</h3>
          {conversations === null ? <span className="loading-dot" /> : !conversations.length ? <p className="cai-dim">No saved chats yet.</p> : (
            <ul className="cai-list">{conversations.map((c) => <li key={c.id}><button type="button" className="cai-linkbtn" onClick={() => openConversation(c.id)}>{c.title}<small>{new Date(c.updatedAt).toLocaleString()}</small></button><button type="button" className="cai-icon" aria-label={`Delete ${c.title}`} onClick={() => deleteConversation(c.id)}>🗑</button></li>)}</ul>
          )}
          <button type="button" className="btn-ghost cai-small" onClick={deleteAll}>Delete all my CODEX AI data</button>
        </div>
      )}

      {tab === 'memory' && (
        <div className="cai-panel glass-card">
          <h3>🧠 Memory</h3>
          <p className="cai-dim">CODEX only remembers what you choose to save here. It never saves anything by itself, and it won’t store private details like card numbers or passwords.</p>
          <form className="cai-input" onSubmit={async (e) => { e.preventDefault(); if (memoryDraft.trim() && await saveMemory(memoryDraft.trim())) setMemoryDraft(''); }}>
            <input value={memoryDraft} onChange={(e) => setMemoryDraft(e.target.value)} placeholder="e.g. I prefer short answers" aria-label="Add a memory" maxLength={300} />
            <button type="submit" className="codex-send" disabled={!memoryDraft.trim()} aria-label="Save memory">＋</button>
          </form>
          {memories === null ? <span className="loading-dot" /> : !memories.length ? <p className="cai-dim">Nothing saved yet.</p> : (
            <ul className="cai-list">{memories.map((m) => <li key={m.id}><span>{m.text}</span><button type="button" className="cai-icon" aria-label={`Forget ${m.text}`} onClick={() => deleteMemory(m.id)}>🗑</button></li>)}</ul>
          )}
          {!!memories?.length && <button type="button" className="btn-ghost cai-small" onClick={async () => { await api.aiClearMemory().catch((e) => say(e.message)); setMemories([]); }}>Forget everything</button>}
        </div>
      )}

      {tab === 'gallery' && (
        <div className="cai-panel glass-card">
          <h3>Gallery</h3>
          {gallery === null ? <span className="loading-dot" /> : !gallery.length ? <p className="cai-dim">Images, audio and videos you create or upload appear here.</p> : (
            <div className="cai-grid">{gallery.map((m) => <figure key={m.id}><MediaView m={m} /><figcaption>{m.prompt || m.kind}</figcaption><button type="button" className="cai-tiny" aria-label="Delete file" onClick={async () => { await api.aiDeleteMedia(m.id).catch(() => {}); setGallery((g) => g.filter((x) => x.id !== m.id)); }}>🗑</button></figure>)}</div>
          )}
        </div>
      )}

      {tab === 'limits' && (
        <div className="cai-panel glass-card">
          <h3>Free usage today</h3>
          <p className="cai-dim">These are CHEX’s own daily guard rails for free plans. Providers can also pause free use at any time, and nothing here is unlimited. Counts reset at 00:00 UTC.</p>
          <ul className="cai-list">
            {engines.map((e) => (
              <li key={e.engine} className="cai-limit">
                <div><b>{ENGINE_ICON[e.engine]} {e.label}</b>{e.experimental ? ' · beta' : ''}<small>{e.what}</small></div>
                <div className={`cai-state st-${e.state}`}>{STATE_TEXT[e.state]}{e.state === 'ready' || e.state === 'limit_reached' ? ` · ${e.remaining.perUser} of ${e.limits.perUserDaily} left for you` : ''}</div>
                {e.message && <small className="cai-dim">{e.message}</small>}
              </li>
            ))}
            {status?.memory && <li className="cai-limit"><div><b>🧠 Memory AI</b><small>history &amp; saved memories</small></div><div className={`cai-state st-${status.memory.ok ? 'ready' : 'cooldown'}`}>{status.memory.ok ? 'Ready' : 'Unavailable'} · {status.memory.kind === 'mongodb' ? 'MongoDB' : 'local database'}</div></li>}
          </ul>
        </div>
      )}
    </div>
  );
}
