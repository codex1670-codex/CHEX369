import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { getSocket } from '../socket.js';
import { stickyVoiceOn, setStickyVoice, speakReminder } from '../stickyVoice.js';

const COLORS = ['yellow', 'pink', 'mint', 'blue', 'lilac', 'orange'];
const pad = (n) => String(n).padStart(2, '0');
const toInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromInput = (v) => (v ? new Date(v).toISOString() : null);

export function whenLabel(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days === -1) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

// The time box has minute precision, so "in 10 min" rounds UP to the next whole minute (never rings early).
const inMs = (ms) => new Date(Math.ceil((Date.now() + ms) / 60000) * 60000);
const QUICK = [
  ['In 10 min', () => inMs(10 * 60000)],
  ['In 1 hour', () => inMs(3600000)],
  ['Tonight 8 pm', () => { const d = new Date(); d.setHours(20, 0, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); return d; }],
  ['Tomorrow 9 am', () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; }],
];

function Note({ n, onChanged, onError }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(n.text);
  const [when, setWhen] = useState(toInput(n.remindAt));
  const [repeat, setRepeat] = useState(n.repeat);
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { setBusy(true); try { await fn(); onChanged(); } catch (e) { onError(e.message); } finally { setBusy(false); } };
  const save = () => run(async () => { await api.updateSticky(n.id, { text, remindAt: fromInput(when), repeat: when ? repeat : 'none' }); setEditing(false); });

  const overdue = !n.done && n.remindAt && !n.ringing && n.repeat === 'none' && new Date(n.remindAt) < new Date() && !n.snoozeUntil;
  return (
    <li className={`sticky-note sn-${n.color}${n.done ? ' done' : ''}${n.ringing ? ' ringing' : ''}`} style={{ '--tilt': `${(n.id.charCodeAt(0) % 5) - 2}deg` }}>
      <span className="sn-pin" aria-hidden="true">📌</span>
      {editing ? (
        <div className="sn-edit">
          <textarea value={text} maxLength={200} rows={3} onChange={e => setText(e.target.value)} aria-label="Note text" />
          <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} aria-label="Remind me at" />
          <select value={repeat} onChange={e => setRepeat(e.target.value)} disabled={!when} aria-label="Repeat">
            <option value="none">Once</option><option value="daily">Every day</option><option value="weekly">Every week</option>
          </select>
          <div className="sn-actions">
            <button type="button" disabled={busy || !text.trim()} onClick={save}>Save</button>
            <button type="button" onClick={() => { setEditing(false); setText(n.text); setWhen(toInput(n.remindAt)); setRepeat(n.repeat); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <p className="sn-text">{n.text}</p>
          <div className="sn-meta">
            {n.remindAt ? <span>⏰ {whenLabel(n.snoozeUntil || n.remindAt)}</span> : <span>No reminder</span>}
            {n.repeat !== 'none' && <span>🔁 {n.repeat === 'daily' ? 'Every day' : 'Every week'}</span>}
            {n.snoozeUntil && <span>😴 Snoozed</span>}
            {n.ringing && <span className="sn-ring">🔔 Ringing</span>}
            {overdue && <span>⌛ Time passed</span>}
          </div>
          <div className="sn-actions">
            {n.ringing && <button type="button" disabled={busy} onClick={() => run(() => api.snoozeSticky(n.id, 10))}>Snooze 10 min</button>}
            <button type="button" disabled={busy} aria-label={n.done ? 'Put back' : 'Mark done'} onClick={() => run(() => api.updateSticky(n.id, { done: !n.done }))}>{n.done ? '↩ Undo' : '✓ Done'}</button>
            {!n.done && <button type="button" aria-label="Edit note" onClick={() => setEditing(true)}>✎</button>}
            {n.remindAt && !n.done && <button type="button" aria-label="Read it aloud" onClick={() => speakReminder(n.text, { force: true })}>🔊</button>}
            <button type="button" disabled={busy} aria-label="Delete note" onClick={() => run(() => api.deleteSticky(n.id))}>🗑</button>
          </div>
        </>
      )}
    </li>
  );
}

// Sticky notes: jot a note, optionally give it a time, and CHEX reads it out loud (plus a phone notification) when it is due.
export default function Stickies({ onBack, embedded = false, mode = 'all' }) {
  const remindersOnly = mode === 'reminders';
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [when, setWhen] = useState('');
  const [repeat, setRepeat] = useState('none');
  const [color, setColor] = useState('yellow');
  const [needTime, setNeedTime] = useState(false);
  const [adding, setAdding] = useState(false);
  const [voice, setVoice] = useState(stickyVoiceOn());

  const load = useCallback(() => api.stickies().then(r => setNotes(r.notes)).catch(e => setError(e.message)), []);
  useEffect(() => {
    load();
    const socket = getSocket();
    socket?.on('sticky:due', load);
    window.addEventListener('chex:stickies-changed', load);
    window.addEventListener('chex:stickies-changed-by-alert', load);
    const tick = setInterval(load, 30000);
    return () => { socket?.off('sticky:due', load); window.removeEventListener('chex:stickies-changed', load); window.removeEventListener('chex:stickies-changed-by-alert', load); clearInterval(tick); };
  }, [load]);

  const add = async (e) => {
    e?.preventDefault();
    if (!text.trim()) return;
    if (remindersOnly && !when) { setNeedTime(true); setError('Pick a time so CHEX knows when to remind you — try one of the quick buttons.'); return; }
    setAdding(true); setError(''); setNeedTime(false);
    try {
      await api.addSticky({ text: text.trim(), remindAt: fromInput(when), repeat: when ? repeat : 'none', color });
      setText(''); setWhen(''); setRepeat('none');
      setColor(COLORS[(COLORS.indexOf(color) + 1) % COLORS.length]);
      await load();
    } catch (err) { setError(err.message); }
    finally { setAdding(false); }
  };

  // "Smart reminders" shows only notes that have a time; the sticky-notes board shows everything.
  const shown = (notes || []).filter(n => !remindersOnly || n.remindAt);
  const active = shown.filter(n => !n.done);
  const finished = shown.filter(n => n.done);

  return (
    <div className="stickies-page">
      {!embedded && (
        <div className="stickies-head">
          {onBack && <button className="btn-ghost" style={{ width: 'auto', padding: '7px 14px' }} onClick={onBack}>← Back</button>}
          <h2>📌 Sticky notes</h2>
        </div>
      )}
      <p className="stickies-sub">{remindersOnly ? <>Pick a time and CHEX says it out loud and sends a notification when it’s due — once, daily or weekly. Or tell Codex: <b>“remind me every day at 8am to take medicine”</b>.</> : <>Write a note and pick a time — CHEX says it out loud and sends a notification when it’s due. Or just tell Codex: <b>“remind me to call mom at 5pm”</b>.</>}</p>

      <form className="glass-card sticky-compose" onSubmit={add}>
        <textarea value={text} maxLength={200} rows={2} placeholder={remindersOnly ? 'Remind me to…' : 'What should I remind you about?'} aria-label="New sticky note" onChange={e => setText(e.target.value)} />
        <div className="sc-row">
          <input type="datetime-local" value={when} onChange={e => { setWhen(e.target.value); setNeedTime(false); }} aria-label="Remind me at" aria-invalid={needTime} />
          <select value={repeat} onChange={e => setRepeat(e.target.value)} disabled={!when} aria-label="Repeat">
            <option value="none">Once</option><option value="daily">Every day</option><option value="weekly">Every week</option>
          </select>
        </div>
        <div className="sc-chips">
          {QUICK.map(([label, fn]) => <button type="button" key={label} className="sc-chip" onClick={() => setWhen(toInput(fn().toISOString()))}>{label}</button>)}
          {when && !remindersOnly && <button type="button" className="sc-chip" onClick={() => { setWhen(''); setRepeat('none'); }}>No time</button>}
        </div>
        <div className="sc-row sc-bottom">
          <div className="sc-colors" role="radiogroup" aria-label="Note colour">
            {COLORS.map(c => <button type="button" key={c} role="radio" aria-checked={color === c} aria-label={c} className={`sc-dot sn-${c}${color === c ? ' on' : ''}`} onClick={() => setColor(c)} />)}
          </div>
          <button className="btn-primary" style={{ width: 'auto', padding: '9px 20px' }} disabled={adding || !text.trim()}>{remindersOnly ? '＋ Add reminder' : '＋ Add note'}</button>
        </div>
      </form>

      <div className="sticky-voice">
        <button type="button" className={`btn-ghost${voice ? ' sel' : ''}`} style={{ width: 'auto', padding: '8px 16px' }} role="switch" aria-checked={voice} onClick={() => setVoice(setStickyVoice(!voice))}>{voice ? '🔊 Voice reminders on' : '🔇 Voice reminders off'}</button>
        <button type="button" className="btn-ghost" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => speakReminder('This is how your reminders will sound.', { force: true })}>▶ Test voice</button>
      </div>
      {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

      {!notes ? <div className="glass-card" style={{ padding: 20 }}>Loading your notes…</div> : (
        <>
          {!active.length && <div className="glass-card" style={{ padding: 20, textAlign: 'center' }}>{remindersOnly ? 'No reminders yet. Add one above, or ask Codex: “remind me to call mom at 5pm”.' : 'No sticky notes yet. Add one above, or ask Codex to remind you of something.'}</div>}
          <ul className="sticky-board">{active.map(n => <Note key={n.id} n={n} onChanged={load} onError={setError} />)}</ul>
          {finished.length > 0 && (
            <details className="sticky-finished">
              <summary>Done ({finished.length})</summary>
              <ul className="sticky-board">{finished.map(n => <Note key={n.id} n={n} onChanged={load} onError={setError} />)}</ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
