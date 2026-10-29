import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { EMOJI_PALETTE, DEFAULT_QUICK_REACTIONS, firstEmoji, saveQuickReactions } from '../quickReactions.js';

// Long-press menu for a chat message: the person's own top-10 emoji to react with, and a
// "Customize" mode to change which 10 they are. `current` = the emoji I already reacted with.
export default function ReactionPicker({ quick, current, onPick, onClose, onQuickChange }) {
  const [customizing, setCustomizing] = useState(false);
  const [draft, setDraft] = useState(quick);
  const [slot, setSlot] = useState(0);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const put = (emoji) => {
    if (!emoji) return;
    setDraft(d => d.map((e, i) => (i === slot ? emoji : e)));
    setSlot(s => Math.min(s + 1, draft.length - 1));
    setTyped('');
  };
  const done = () => { onQuickChange?.(saveQuickReactions(draft)); setCustomizing(false); };

  return createPortal(
    <div className="react-scrim" onClick={onClose} data-noswipe>
      <div className="react-sheet" role="dialog" aria-label={customizing ? 'Customize reactions' : 'React to message'} onClick={e => e.stopPropagation()}>
        {!customizing ? (
          <>
            <div className="react-grid" role="group" aria-label="Quick reactions">
              {quick.map((e, i) => (
                <button key={`${e}-${i}`} type="button" className={`react-btn${current === e ? ' on' : ''}`} aria-label={`React ${e}`} aria-pressed={current === e} onClick={() => onPick(e)}>{e}</button>
              ))}
            </div>
            <div className="react-foot">
              {current && <button type="button" className="btn-ghost" onClick={() => onPick(null)}>Remove my reaction</button>}
              <button type="button" className="btn-ghost" onClick={() => { setDraft(quick); setSlot(0); setCustomizing(true); }}>✏️ Customize top 10</button>
            </div>
          </>
        ) : (
          <>
            <div className="react-hint">Tap a slot, then pick an emoji for it.</div>
            <div className="react-grid" role="group" aria-label="Your top 10">
              {draft.map((e, i) => (
                <button key={i} type="button" className={`react-btn slot${slot === i ? ' sel' : ''}`} aria-label={`Slot ${i + 1}: ${e}`} onClick={() => setSlot(i)}>{e}</button>
              ))}
            </div>
            <div className="react-palette" role="group" aria-label="Emoji choices">
              {EMOJI_PALETTE.map(e => <button key={e} type="button" className="react-pal" onClick={() => put(e)} aria-label={`Use ${e}`}>{e}</button>)}
            </div>
            <input className="react-type" placeholder="Or type / paste any emoji" value={typed} aria-label="Type any emoji"
              onChange={e => { const g = firstEmoji(e.target.value); if (g) put(g); else setTyped(e.target.value.slice(0, 2)); }} />
            <div className="react-foot">
              <button type="button" className="btn-ghost" onClick={() => { setDraft([...DEFAULT_QUICK_REACTIONS]); setSlot(0); }}>Reset</button>
              <button type="button" className="btn-ghost" onClick={() => setCustomizing(false)}>Cancel</button>
              <button type="button" className="btn-primary" style={{ width: 'auto', padding: '8px 18px' }} onClick={done}>Save</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
