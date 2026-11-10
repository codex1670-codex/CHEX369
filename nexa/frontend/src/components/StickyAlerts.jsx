import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { getSocket } from '../socket.js';
import { speakReminder } from '../stickyVoice.js';

const REPEAT_EVERY_MS = 45000;   // keeps reading it out until you act on it …
const MAX_SPOKEN = 4;            // … but never more than this many times
const isAlarm = (n) => String(n?.source || '').startsWith('life:alarm:');   // alarms ring with their own song (AlarmRinger); the server copy only exists for the phone notification

// Floating "your reminder is ringing" cards. Listens for the server's `sticky:due` event, polls as a safety net
// (missed socket, app reopened later), and reads each reminder aloud until it is marked Done, snoozed or dismissed.
export default function StickyAlerts({ onOpen }) {
  const [ringing, setRinging] = useState([]);
  const spoken = useRef(new Map());    // `${id}:${lastFiredAt}` -> { n, at }

  const ring = useCallback((note, speakNow = true) => {
    setRinging(list => (list.some(x => x.id === note.id) ? list.map(x => (x.id === note.id ? note : x)) : [...list, note]));
    const key = `${note.id}:${note.lastFiredAt}`;
    if (speakNow && !spoken.current.has(key)) {
      spoken.current.set(key, { n: 1, at: Date.now() });
      speakReminder(note.text);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { notes } = await api.ringingStickies();
      const mine = notes.filter(n => !isAlarm(n));
      setRinging(mine);
      mine.forEach(n => ring(n));
    } catch { /* offline: try again next time */ }
  }, [ring]);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 20000);
    const socket = getSocket();
    const onDue = (note) => { if (!isAlarm(note)) ring(note); };
    socket?.on('sticky:due', onDue);
    window.addEventListener('chex:stickies-changed', refresh);
    return () => { clearInterval(poll); socket?.off('sticky:due', onDue); window.removeEventListener('chex:stickies-changed', refresh); };
  }, [refresh, ring]);

  // Say it again every 45 seconds while it is still ringing.
  useEffect(() => {
    if (!ringing.length) return undefined;
    const t = setInterval(() => {
      ringing.forEach(n => {
        const e = spoken.current.get(`${n.id}:${n.lastFiredAt}`);
        if (e && e.n < MAX_SPOKEN && Date.now() - e.at >= REPEAT_EVERY_MS) { e.n += 1; e.at = Date.now(); speakReminder(n.text); }
      });
    }, 5000);
    return () => clearInterval(t);
  }, [ringing]);

  const act = async (n, fn) => {
    setRinging(list => list.filter(x => x.id !== n.id));
    try { await fn(); } catch { /* the next poll will bring it back if it failed */ }
    window.dispatchEvent(new Event('chex:stickies-changed-by-alert'));
  };

  if (!ringing.length) return null;
  const shown = ringing.slice(0, 3);
  return (
    <div className="sticky-alerts" role="alert" aria-live="assertive">
      {shown.map(n => (
        <div key={n.id} className={`sticky-alert sn-${n.color}`}>
          <span className="sn-pin" aria-hidden="true">📌</span>
          <div className="sticky-alert-title">{n.label || 'Reminder'}</div>
          <div className="sticky-alert-text">{n.text}</div>
          <div className="sticky-alert-actions">
            <button type="button" onClick={() => act(n, () => api.updateSticky(n.id, { done: true }))}>✓ Done</button>
            <button type="button" onClick={() => act(n, () => api.snoozeSticky(n.id, 10))}>⏰ Snooze 10 min</button>
            <button type="button" aria-label="Say it again" onClick={() => speakReminder(n.text, { force: true })}>🔊</button>
            <button type="button" aria-label="Dismiss" onClick={() => act(n, () => api.dismissSticky(n.id))}>✕</button>
          </div>
        </div>
      ))}
      {ringing.length > shown.length && <button type="button" className="sticky-alert-more" onClick={onOpen}>+{ringing.length - shown.length} more reminders</button>}
    </div>
  );
}
