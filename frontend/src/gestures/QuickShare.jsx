import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import Avatar from '../components/Avatar.jsx';
import { loadTopPeople } from './gestureStore.js';

// Quick-send circle: hold Share, a frosted-glass ring of your top 5 people appears around your finger; drag the
// video onto a profile and let go to send it. Let go anywhere else and the ring stays open — tap a profile to send,
// tap the middle for the full share sheet, tap outside to close.
const SLOT = 64;          // avatar circle size
const HIT = 46;           // how close the finger must be to a profile to "grab" it
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';

export function ringGeometry(x, y, W, H) {
  const R = clamp(Math.min(W, H) * 0.28, 84, 118);
  const cx = clamp(x ?? W / 2, R + SLOT, W - R - SLOT);
  const cy = clamp((y ?? H * 0.62) - R - 64, R + SLOT + 24, H - R - SLOT - 96);
  const slots = Array.from({ length: 5 }, (_, i) => {
    const a = (-90 + i * 72) * Math.PI / 180;
    return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });
  return { R, cx, cy, slots };
}
export function nearestSlot(pt, slots, hit = HIT) {
  let best = -1, bd = hit;
  slots.forEach((s, i) => { const d = Math.hypot(pt.x - s.x, pt.y - s.y); if (d <= bd) { bd = d; best = i; } });
  return best;
}

export default function QuickShare({ item, me, onClose, onOpenSheet, onOpenSettings }) {
  const [people, setPeople] = useState(null);
  const [pt, setPt] = useState(item.x != null ? { x: item.x, y: item.y } : null);
  const [hot, setHot] = useState(-1);
  const [sticky, setSticky] = useState(!item.held);       // finger already up: tap mode
  const [state, setState] = useState({ phase: 'idle', index: -1, text: '' });   // idle | sending | done | error
  const hotRef = useRef(-1), busy = useRef(false), stickyRef = useRef(!item.held);
  const peopleRef = useRef(null), geo = useRef(null), closeTimer = useRef(null);

  const W = typeof window !== 'undefined' ? window.innerWidth : 390, H = typeof window !== 'undefined' ? window.innerHeight : 800;
  const g = useMemo(() => ringGeometry(item.x, item.y, W, H), [item.x, item.y, W, H]);
  geo.current = g;

  useEffect(() => {
    let live = true;
    loadTopPeople(api, me).then(list => { if (live) { peopleRef.current = list; setPeople(list); } }).catch(() => { if (live) setPeople([]); });
    return () => { live = false; clearTimeout(closeTimer.current); };
  }, [me?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (i) => {
    const u = peopleRef.current?.[i];
    if (!u || busy.current) return;
    busy.current = true;
    setState({ phase: 'sending', index: i, text: `Sending to ${first(u.displayName)}…` });
    try {
      const res = await api.shareItem(item.kind, item.id, [u.username], '');
      const r = res.results?.[0];
      if (r?.status === 'sent') setState({ phase: 'done', index: i, text: `Sent to ${first(u.displayName)} ✓` });
      else if (r?.status === 'message_request') setState({ phase: 'done', index: i, text: `Sent to ${first(u.displayName)} as a message request` });
      else throw new Error(r?.message || 'Could not send.');
      try { navigator.vibrate?.([12, 40, 12]); } catch { /* no haptics */ }
      closeTimer.current = setTimeout(onClose, 1100);
    } catch (err) {
      busy.current = false;
      setState({ phase: 'error', index: i, text: err?.message || 'Could not send.' });
    }
  };

  // Follow the finger that is still down from the long press.
  useEffect(() => {
    const move = (e) => {
      if (stickyRef.current || busy.current) return;
      const p = { x: e.clientX, y: e.clientY };
      setPt(p);
      const h = nearestSlot(p, geo.current.slots.map((s, i) => (peopleRef.current?.[i] ? s : { x: -999, y: -999 })));
      if (h !== hotRef.current) { hotRef.current = h; setHot(h); if (h >= 0) { try { navigator.vibrate?.(8); } catch { /* no haptics */ } } }
    };
    const up = (e) => {
      if (stickyRef.current || busy.current) return;
      const p = { x: e.clientX, y: e.clientY };
      const hub = Math.hypot(p.x - geo.current.cx, p.y - geo.current.cy) < 40;
      if (hotRef.current >= 0) { send(hotRef.current); }
      else if (hub) { onOpenSheet(); }
      else { stickyRef.current = true; setSticky(true); hotRef.current = -1; setHot(-1); }   // dropped on nothing: stay open, tap mode
    };
    const cancel = () => { if (!busy.current) { stickyRef.current = true; setSticky(true); hotRef.current = -1; setHot(-1); } };
    // While the finger is down the page must not scroll under it.
    const stopScroll = (e) => { if (!stickyRef.current && e.cancelable) e.preventDefault(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', stopScroll, { passive: false });
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', stopScroll); window.removeEventListener('keydown', key);
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const hotPerson = hot >= 0 ? people?.[hot] : null;
  const overHub = !!pt && !sticky && Math.hypot(pt.x - g.cx, pt.y - g.cy) < 40;
  // The video "snaps" onto the profile it is over.
  const ghost = !sticky && pt && state.phase === 'idle' ? (hot >= 0 ? { ...g.slots[hot], s: 0.5, snap: true } : { ...pt, s: 1, snap: false }) : null;
  const hint = state.text
    || (hotPerson ? `Release to send to ${first(hotPerson.displayName)}`
    : sticky ? (people && people.length ? 'Tap a profile to send' : '')
    : 'Drag onto a profile and let go');

  const ghostThumb = item.thumb && item.thumbType === 'video'
    ? <video src={`${item.thumb}#t=0.1`} muted playsInline preload="metadata" />
    : item.thumb ? <img src={item.thumb} alt="" draggable={false} /> : <span className="qs-ghost-ico">{item.kind === 'reel' ? '🎬' : '🖼️'}</span>;

  return createPortal(
    <div className={`qs-back${sticky ? ' sticky' : ''}`} data-noswipe data-circle-ui role="dialog" aria-label="Send to a friend"
      onClick={(e) => { if (e.target === e.currentTarget || e.target.classList?.contains('qs-stage')) onClose(); }}>
      <div className="qs-stage">
        <div className="qs-ring" style={{ left: g.cx, top: g.cy, width: g.R * 2 + SLOT, height: g.R * 2 + SLOT }} aria-hidden="true"><i /></div>

        <button type="button" className={`qs-hub${overHub ? ' over' : ''}`} style={{ left: g.cx, top: g.cy }} onClick={onOpenSheet} aria-label="More people — open the full share sheet">
          <span className="qs-hub-ico">{state.phase === 'done' ? '✓' : state.phase === 'sending' ? '…' : '↗'}</span>
          <span className="qs-hub-lbl">{state.phase === 'idle' ? 'More' : ''}</span>
        </button>

        {g.slots.map((s, i) => {
          const u = people?.[i];
          const mine = state.index === i;
          const cls = `qs-slot${u ? '' : ' empty'}${hot === i ? ' hot' : ''}${mine && state.phase === 'done' ? ' done' : ''}${mine && state.phase === 'error' ? ' err' : ''}${mine && state.phase === 'sending' ? ' sending' : ''}`;
          return (
            <button key={i} type="button" className={cls} style={{ left: s.x, top: s.y, '--i': i, width: SLOT, height: SLOT }}
              disabled={people === null || (u && state.phase === 'sending') || (u && state.phase === 'done')}
              aria-label={u ? `Send to ${u.displayName}` : 'Add a person in Settings'}
              onClick={() => { if (!u) { onOpenSettings(); return; } if (sticky) send(i); }}>
              {u ? <Avatar user={u} size={SLOT - 8} showPresence={false} /> : <span className="qs-plus">{people === null ? '' : '+'}</span>}
              {u && <span className="qs-name">{first(u.displayName)}</span>}
              {mine && state.phase === 'done' && <span className="qs-badge">✓</span>}
            </button>
          );
        })}

        {ghost && (
          <div className={`qs-ghost${ghost.snap ? ' snap' : ''}`} style={{ transform: `translate(${ghost.x}px, ${ghost.y}px) translate(-50%, -62%) scale(${ghost.s}) rotate(${ghost.snap ? 0 : -4}deg)` }} aria-hidden="true">
            {ghostThumb}
          </div>
        )}
      </div>

      <div className={`qs-hint${state.phase === 'error' ? ' err' : ''}`} role="status" aria-live="polite">{hint}</div>
      {people && people.length === 0 && (
        <div className="qs-empty-note">Nobody to show yet — follow people or chat with them, or pick your five in <button type="button" onClick={onOpenSettings}>Settings → Smart gestures</button>.</div>
      )}
      <button type="button" className="qs-close" onClick={onClose} aria-label="Close">✕</button>
    </div>,
    document.body,
  );
}
