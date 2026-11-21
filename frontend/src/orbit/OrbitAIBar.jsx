import { useState } from 'react';
import OrbitIcon from './OrbitIcon.jsx';

// "CHEX Orbit AI" — the assistant strip at the top of the ⋯ / ＋ launcher menu.
//   🎤 Speak   → opens the Codex voice agent (it listens, then does things: open any page, search, message, follow, post, call…)
//   Type + Enter → questions, writing, code, images and videos go to the CHEX AI chat; commands ("open reels", "go to settings") go to Codex.
//   Chips      → "Ask" (chat) and "Do it" (commands) so people can pick the route themselves.
// Both assistants already exist; this strip is the one door to them from the bottom bar.
export const CHAT_RE = /\?\s*$|^(what|why|how|when|where|who|which|explain|tell me|define|write|draw|generate|create|make|translate|summari[sz]e|help|teach|solve|code)\b/i;
const IDEAS = [
  ['Open Reels', 'do'], ['Message someone', 'do'], ['Search for a person', 'do'], ['Draw an image of a fox', 'ask'], ['Explain black holes', 'ask'],
];

export default function OrbitAIBar({ onDone }) {
  const [text, setText] = useState('');
  const fire = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const toChat = (t) => { onDone?.(); fire('chex:ai-open', t ? { text: t } : {}); };
  const toDo = (t) => { onDone?.(); fire('chex:codex-open', { mode: 'full', run: t }); };
  const talk = () => { onDone?.(); fire('chex:codex-open', { mode: 'full', talk: true }); };
  const route = (t, how) => { const v = (t ?? text).trim(); if (!v) return; setText(''); (how || (CHAT_RE.test(v) ? 'ask' : 'do')) === 'ask' ? toChat(v) : toDo(v); };

  return (
    <section className="oai" aria-label="CHEX Orbit AI" data-testid="orbit-ai-bar" onClick={(e) => e.stopPropagation()}>
      <header className="oai-head">
        <span className="oai-ico"><OrbitIcon name="codex" size={20} /></span>
        <div><b>CHEX Orbit AI</b><span>Speak or type. Ask anything, or tell me what to open or do.</span></div>
      </header>
      <form className="oai-row" onSubmit={(e) => { e.preventDefault(); route(); }}>
        <button type="button" className="oai-mic" onClick={talk} aria-label="Speak to CHEX Orbit AI" title="Speak"><OrbitIcon name="mic" size={22} /></button>
        <input className="oai-in" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask or say what to do…" aria-label="Ask CHEX Orbit AI" enterKeyHint="send" />
        <button type="submit" className="oai-go" disabled={!text.trim()} aria-label="Send"><OrbitIcon name="open" size={18} /></button>
      </form>
      <div className="oai-chips">
        <button type="button" className="oai-chip" onClick={() => toChat()}><OrbitIcon name="chat" size={15} />Ask (chat)</button>
        <button type="button" className="oai-chip" onClick={talk}><OrbitIcon name="mic" size={15} />Talk &amp; control</button>
        {IDEAS.map(([label, how]) => <button key={label} type="button" className="oai-chip soft" onClick={() => route(label, how)}>{label}</button>)}
      </div>
    </section>
  );
}
