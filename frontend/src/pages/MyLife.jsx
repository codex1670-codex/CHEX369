import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { speakReminder } from '../stickyVoice.js';
import { enablePush, pushSupported, syncPushIfAllowed } from '../push.js';
import Stickies from './Stickies.jsx';
import {
  DAY_NAMES, addDays, bestStreak, dateStr, dueState, fmtTime, habitStreak, mmss, prettyDate, repeatLabel, todayDayIndex,
} from '../lifeUtils.js';

const TABS = [
  { key: 'reminders', label: 'Smart reminders', icon: '⏰' },
  { key: 'alarm', label: 'Alarm', icon: '🔔' },
  { key: 'notes', label: 'Sticky notes', icon: '📌' },
  { key: 'planner', label: 'Daily planner', icon: '📅' },
  { key: 'timetable', label: 'Study timetable', icon: '🗓️' },
  { key: 'assignments', label: 'Assignments', icon: '📚' },
  { key: 'focus', label: 'Focus timer', icon: '🎯' },
  { key: 'habits', label: 'Habit tracker', icon: '🔥' },
];
const COLORS = ['yellow', 'pink', 'mint', 'blue', 'lilac', 'orange'];

// Loads and edits one kind of item. Every change goes to the server first, then the list is refreshed.
function useLife(kind) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.lifeItems(kind).then(r => { setItems(r.items); setError(''); }).catch(e => setError(e.message)), [kind]);
  useEffect(() => { load(); }, [load]);
  const guard = async (fn) => { try { setError(''); const out = await fn(); await load(); return out ?? true; } catch (e) { setError(e.message); return false; } };
  return {
    items, error, setError,
    add: (data) => guard(() => api.addLifeItem(kind, data)),
    patch: (id, data) => guard(() => api.updateLifeItem(id, data)),
    remove: (id) => guard(() => api.deleteLifeItem(id)),
  };
}
const Err = ({ msg }) => (msg ? <div className="error-banner" style={{ marginBottom: 12 }} role="alert">{msg}</div> : null);
const Loading = () => <div className="glass-card life-empty">Loading…</div>;

/* ───────── Alarm (notifies you at the set time) ───────── */
// Phone/desktop notification for alarms while CHEX is closed (Web Push; the server sends it at the alarm time).
function NotifyStatus() {
  const supported = pushSupported();
  const [perm, setPerm] = useState(() => (supported ? Notification.permission : 'unsupported'));
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (perm === 'granted') syncPushIfAllowed(); }, [perm]);
  const turnOn = async () => { setBusy(true); await enablePush(); setPerm(supported ? Notification.permission : 'unsupported'); setBusy(false); };
  if (perm === 'granted') return <p className="life-hint alarm-notify ok">✅ Notifications are on — you’ll get an alarm notification on this device even when CHEX is closed. Tap it to open CHEX.</p>;
  if (perm === 'denied') return <p className="life-hint alarm-notify">🚫 Notifications are blocked for CHEX. Allow them in your browser or phone settings to be alerted when the app is closed.</p>;
  if (perm === 'unsupported') return <p className="life-hint alarm-notify">ℹ️ This browser can’t show notifications when CHEX is closed. On iPhone, add CHEX to the Home Screen first (iOS 16.4+).</p>;
  return (
    <div className="life-row alarm-notify">
      <span className="life-hint">🔕 Turn on notifications so alarms alert you even when CHEX is closed.</span>
      <button type="button" className="btn-primary" style={{ width: 'auto', padding: '8px 18px' }} disabled={busy} onClick={turnOn}>Enable notifications</button>
    </div>
  );
}

const WEEKDAYS = [0, 1, 2, 3, 4];
function Alarms() {
  const { items, error, add, patch, remove } = useLife('alarm');
  const [f, setF] = useState({ time: '07:00', label: '', days: [] });
  const set = (k, v) => setF(o => ({ ...o, [k]: v }));
  const toggleDay = (d) => set('days', f.days.includes(d) ? f.days.filter(x => x !== d) : [...f.days, d].sort());
  const changed = () => window.dispatchEvent(new Event('chex:alarms-changed'));   // tells the ringer to reload
  const submit = async (e) => { e.preventDefault(); if (await add(f)) { setF(o => ({ ...o, label: '' })); changed(); } };
  const sorted = [...(items || [])].sort((a, b) => a.time.localeCompare(b.time));
  return (
    <section aria-label="Alarm">
      <form className="glass-card life-form" onSubmit={submit}>
        <p className="life-hint">🔔 At the set time you get a notification, even when CHEX is closed. If CHEX is open you get an alarm card with Stop and Snooze.</p>
        <NotifyStatus />
        <div className="life-row">
          <input type="time" className="alarm-timeinput" value={f.time} required aria-label="Alarm time" onChange={e => set('time', e.target.value)} />
          <input value={f.label} maxLength={60} placeholder="Label (e.g. Wake up)" aria-label="Alarm label" onChange={e => set('label', e.target.value)} />
        </div>
        <div className="sc-chips" role="group" aria-label="Repeat on">
          {DAY_NAMES.map((n, i) => <button type="button" key={n} aria-pressed={f.days.includes(i)} className={`sc-chip${f.days.includes(i) ? ' on' : ''}`} onClick={() => toggleDay(i)}>{n.slice(0, 3)}</button>)}
        </div>
        <div className="sc-chips">
          <button type="button" className="sc-chip" onClick={() => set('days', [])}>Once</button>
          <button type="button" className="sc-chip" onClick={() => set('days', WEEKDAYS)}>Weekdays</button>
          <button type="button" className="sc-chip" onClick={() => set('days', [0, 1, 2, 3, 4, 5, 6])}>Every day</button>
        </div>
        <div className="life-row life-between">
          <span className="life-sub">{repeatLabel(f.days)}</span>
          <button className="btn-primary" style={{ width: 'auto', padding: '9px 20px' }} disabled={!f.time}>＋ Set alarm</button>
        </div>
      </form>
      <Err msg={error} />
      {!items ? <Loading /> : !sorted.length ? <div className="glass-card life-empty">No alarms yet. Set a time and CHEX will notify you.</div> : (
        <ul className="life-list">
          {sorted.map(a => (
            <li key={a.id} className={`glass-card life-item alarm-item${a.enabled ? '' : ' done'}`}>
              <div className="life-main">
                <span className="alarm-big">{fmtTime(a.time)}</span>
                <span className="life-title">{a.label || 'Alarm'}</span>
                <span className="life-sub">{repeatLabel(a.days)}</span>
              </div>
              <button type="button" role="switch" aria-checked={a.enabled} aria-label={`${a.label || 'Alarm'} ${fmtTime(a.time)} ${a.enabled ? 'on' : 'off'}`} className={`life-mini alarm-switch${a.enabled ? ' on' : ''}`} onClick={async () => { if (await patch(a.id, { enabled: !a.enabled })) changed(); }}>{a.enabled ? 'On' : 'Off'}</button>
              <button type="button" className="life-mini" aria-label={`Delete ${a.label || 'alarm'} ${fmtTime(a.time)}`} onClick={async () => { if (await remove(a.id)) changed(); }}>🗑</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ───────── Daily planner ───────── */
function Planner() {
  const { items, error, add, patch, remove } = useLife('planner');
  const [day, setDay] = useState(dateStr());
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('');
  const [priority, setPriority] = useState('med');
  const today = dateStr();
  const list = (items || []).filter(i => i.date === day).sort((a, b) => (a.done - b.done) || (a.time || '99:99').localeCompare(b.time || '99:99'));
  const doneCount = list.filter(i => i.done).length;
  const submit = async (e) => { e.preventDefault(); if (!title.trim()) return; if (await add({ title, date: day, time, priority })) { setTitle(''); setTime(''); } };
  return (
    <section aria-label="Daily planner">
      <div className="life-daynav">
        <button type="button" className="btn-ghost" aria-label="Previous day" onClick={() => setDay(addDays(day, -1))}>‹</button>
        <div className="life-daylabel"><b>{prettyDate(day, today)}</b><span>{day}</span></div>
        <button type="button" className="btn-ghost" aria-label="Next day" onClick={() => setDay(addDays(day, 1))}>›</button>
        {day !== today && <button type="button" className="btn-ghost" onClick={() => setDay(today)}>Today</button>}
      </div>
      <form className="glass-card life-form" onSubmit={submit}>
        <input value={title} maxLength={120} placeholder="What do you plan to do?" aria-label="Task" onChange={e => setTitle(e.target.value)} />
        <p className="life-hint">🔔 Add a time and CHEX will notify you and read the task out loud when it starts.</p>
        <div className="life-row">
          <input type="time" value={time} aria-label="Time (optional)" onChange={e => setTime(e.target.value)} />
          <select value={priority} aria-label="Priority" onChange={e => setPriority(e.target.value)}>
            <option value="high">🔴 High</option><option value="med">🟡 Normal</option><option value="low">🟢 Low</option>
          </select>
          <button className="btn-primary" style={{ width: 'auto', padding: '9px 20px' }} disabled={!title.trim()}>＋ Add</button>
        </div>
      </form>
      <Err msg={error} />
      {!items ? <Loading /> : (
        <>
          {list.length > 0 && (
            <div className="life-progress" role="progressbar" aria-valuemin={0} aria-valuemax={list.length} aria-valuenow={doneCount} aria-label="Tasks done">
              <div style={{ width: `${(doneCount / list.length) * 100}%` }} /><span>{doneCount}/{list.length} done</span>
            </div>
          )}
          {!list.length && <div className="glass-card life-empty">Nothing planned for this day yet.</div>}
          <ul className="life-list">
            {list.map(i => (
              <li key={i.id} className={`glass-card life-item pr-${i.priority}${i.done ? ' done' : ''}`}>
                <input type="checkbox" checked={i.done} aria-label={`Mark "${i.title}" ${i.done ? 'not done' : 'done'}`} onChange={() => patch(i.id, { done: !i.done })} />
                <div className="life-main"><span className="life-title">{i.title}</span>{i.time && <span className="life-sub">🕐 {fmtTime(i.time)}</span>}</div>
                {!i.done && day < today && <button type="button" className="life-mini" onClick={() => patch(i.id, { date: today })}>Move to today</button>}
                <button type="button" className="life-mini" aria-label={`Delete "${i.title}"`} onClick={() => remove(i.id)}>🗑</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/* ───────── Study timetable ───────── */
function Timetable() {
  const { items, error, add, remove } = useLife('timetable');
  const [f, setF] = useState({ subject: '', day: todayDayIndex(), start: '09:00', end: '10:00', room: '', color: 'blue' });
  const set = (k, v) => setF(o => ({ ...o, [k]: v }));
  const submit = async (e) => { e.preventDefault(); if (await add({ ...f, day: Number(f.day) })) set('subject', ''); };
  const todayIdx = todayDayIndex();
  return (
    <section aria-label="Study timetable">
      <form className="glass-card life-form" onSubmit={submit}>
        <p className="life-hint">🔔 Every class repeats weekly — you’ll be notified and told out loud 10 minutes before it starts.</p>
        <input value={f.subject} maxLength={60} placeholder="Subject (e.g. Physics)" aria-label="Subject" onChange={e => set('subject', e.target.value)} />
        <div className="life-row">
          <select value={f.day} aria-label="Day" onChange={e => set('day', e.target.value)}>{DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          <input type="time" value={f.start} aria-label="Starts" onChange={e => set('start', e.target.value)} />
          <input type="time" value={f.end} aria-label="Ends" onChange={e => set('end', e.target.value)} />
          <input value={f.room} maxLength={40} placeholder="Room / topic" aria-label="Room or topic" onChange={e => set('room', e.target.value)} />
        </div>
        <div className="life-row life-between">
          <div className="sc-colors" role="radiogroup" aria-label="Colour">
            {COLORS.map(c => <button type="button" key={c} role="radio" aria-checked={f.color === c} aria-label={c} className={`sc-dot sn-${c}${f.color === c ? ' on' : ''}`} onClick={() => set('color', c)} />)}
          </div>
          <button className="btn-primary" style={{ width: 'auto', padding: '9px 20px' }} disabled={!f.subject.trim()}>＋ Add to timetable</button>
        </div>
      </form>
      <Err msg={error} />
      {!items ? <Loading /> : (
        <div className="tt-week">
          {DAY_NAMES.map((name, d) => {
            const slots = items.filter(i => i.day === d).sort((a, b) => a.start.localeCompare(b.start));
            return (
              <div key={name} className={`glass-card tt-day${d === todayIdx ? ' today' : ''}`}>
                <h3>{name}{d === todayIdx && <em> · today</em>}</h3>
                {!slots.length && <p className="life-sub">Free day</p>}
                {slots.map(s => (
                  <div key={s.id} className={`tt-slot sn-${s.color}`}>
                    <div><b>{s.subject}</b><span>{fmtTime(s.start)} – {fmtTime(s.end)}{s.room ? ` · ${s.room}` : ''}</span></div>
                    <button type="button" aria-label={`Delete ${s.subject}`} onClick={() => remove(s.id)}>✕</button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ───────── Assignment tracker ───────── */
const STATUS = [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']];
function Assignments() {
  const { items, error, add, patch, remove } = useLife('assignment');
  const [f, setF] = useState({ title: '', subject: '', due: '' });
  const set = (k, v) => setF(o => ({ ...o, [k]: v }));
  const submit = async (e) => { e.preventDefault(); if (await add({ ...f, status: 'todo' })) setF({ title: '', subject: '', due: '' }); };
  const today = dateStr();
  const sortDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999');
  const open = (items || []).filter(i => i.status !== 'done');
  const late = open.filter(i => i.due && i.due < today).length;
  return (
    <section aria-label="Assignment tracker">
      <form className="glass-card life-form" onSubmit={submit}>
        <p className="life-hint">🔔 With a due date, CHEX notifies you and reads it out at 8:00 am on the day it’s due.</p>
        <input value={f.title} maxLength={120} placeholder="Assignment (e.g. Chemistry lab report)" aria-label="Assignment" onChange={e => set('title', e.target.value)} />
        <div className="life-row">
          <input value={f.subject} maxLength={60} placeholder="Subject" aria-label="Subject" onChange={e => set('subject', e.target.value)} />
          <input type="date" value={f.due} aria-label="Due date" onChange={e => set('due', e.target.value)} />
          <button className="btn-primary" style={{ width: 'auto', padding: '9px 20px' }} disabled={!f.title.trim()}>＋ Add</button>
        </div>
      </form>
      <Err msg={error} />
      {!items ? <Loading /> : (
        <>
          <p className="life-summary">{open.length} open{late > 0 && <b className="tone-late"> · {late} overdue</b>}</p>
          <div className="asg-board">
            {STATUS.map(([key, label]) => {
              const col = items.filter(i => i.status === key).sort(sortDue);
              return (
                <div key={key} className="asg-col">
                  <h3>{label} <span>{col.length}</span></h3>
                  {!col.length && <p className="life-sub">Nothing here</p>}
                  {col.map(i => {
                    const d = dueState(i.due, i.status, today);
                    return (
                      <div key={i.id} className={`glass-card asg-card${i.status === 'done' ? ' done' : ''}`}>
                        <div className="life-title">{i.title}</div>
                        <div className="life-sub">{i.subject && `${i.subject} · `}<span className={`tone-${d.tone}`}>{d.label}</span></div>
                        <div className="asg-actions">
                          {STATUS.filter(([k]) => k !== key).map(([k, l]) => <button type="button" key={k} className="life-mini" onClick={() => patch(i.id, { status: k })}>→ {l}</button>)}
                          <button type="button" className="life-mini" aria-label={`Delete ${i.title}`} onClick={() => remove(i.id)}>🗑</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

/* ───────── Focus timer ───────── */
const PRESETS = [[25, 'Focus'], [45, 'Deep work'], [5, 'Short break'], [15, 'Long break']];
const FOCUS_KEY = 'chex.focusTimer';
const readTimer = () => { try { const t = JSON.parse(localStorage.getItem(FOCUS_KEY)); return t && t.end ? t : null; } catch { return null; } };
const writeTimer = (t) => { try { t ? localStorage.setItem(FOCUS_KEY, JSON.stringify(t)) : localStorage.removeItem(FOCUS_KEY); } catch { /* storage unavailable */ } };

function Focus() {
  const { items, error, add } = useLife('focus');
  const [minutes, setMinutes] = useState(25);
  const [label, setLabel] = useState('');
  const [run, setRun] = useState(readTimer);          // { end, minutes, label, isBreak } while a timer is going
  const [left, setLeft] = useState(() => (readTimer() ? readTimer().end - Date.now() : 0));
  const finished = useRef(false);

  const finish = useCallback((t) => {
    if (finished.current) return;
    finished.current = true;
    writeTimer(null); setRun(null);
    api.stopFocusAlert().catch(() => {});          // the app is open and speaks it itself
    speakReminder(t.isBreak ? 'Break is over. Ready to focus?' : 'Focus session complete. Take a break.', { force: true });
    if (!t.isBreak) add({ minutes: t.minutes, label: t.label, date: dateStr() });
  }, [add]);

  useEffect(() => {
    if (!run) return undefined;
    finished.current = false;
    const tick = () => { const ms = run.end - Date.now(); setLeft(ms); if (ms <= 0) finish(run); };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [run, finish]);

  const start = () => { const t = { end: Date.now() + minutes * 60000, minutes, label: label.trim(), isBreak: PRESETS.find(p => p[0] === minutes)?.[1].includes('break') || false }; writeTimer(t); setRun(t); setLeft(t.end - Date.now()); if (!t.isBreak) api.startFocusAlert(t.minutes, t.label).catch(() => {}); };
  const stop = () => { writeTimer(null); setRun(null); api.stopFocusAlert().catch(() => {}); };
  const today = dateStr();
  const todays = (items || []).filter(i => i.date === today);
  const todayMin = todays.reduce((s, i) => s + i.minutes, 0);
  const pct = run ? Math.min(100, Math.max(0, 100 - (left / (run.minutes * 60000)) * 100)) : 0;

  return (
    <section aria-label="Focus timer">
      <div className="glass-card focus-card">
        <div className="focus-ring" style={{ '--p': `${pct}%` }}>
          <div className="focus-time" role="timer" aria-live="off">{run ? mmss(left) : mmss(minutes * 60000)}</div>
          <div className="life-sub">{run ? (run.isBreak ? 'On a break' : run.label || 'Focusing…') : 'Ready'}</div>
        </div>
        {!run && (
          <>
            <div className="sc-chips" role="radiogroup" aria-label="Length">
              {PRESETS.map(([m, n]) => <button type="button" key={m} role="radio" aria-checked={minutes === m} className={`sc-chip${minutes === m ? ' on' : ''}`} onClick={() => setMinutes(m)}>{m} min · {n}</button>)}
            </div>
            <div className="life-row">
              <input type="number" min="1" max="240" value={minutes} aria-label="Custom minutes" onChange={e => setMinutes(Math.min(240, Math.max(1, Math.round(Number(e.target.value)) || 1)))} />
              <input value={label} maxLength={80} placeholder="What are you working on?" aria-label="Session label" onChange={e => setLabel(e.target.value)} />
            </div>
            <button type="button" className="btn-primary" style={{ width: 'auto', padding: '10px 28px' }} onClick={start}>▶ Start</button>
          </>
        )}
        {run && <button type="button" className="btn-ghost" style={{ width: 'auto', padding: '10px 28px' }} onClick={stop}>■ Stop</button>}
        <p className="life-hint">🔔 You’ll get a spoken alert and a phone notification when time is up — even if you leave the app.</p>
      </div>
      <Err msg={error} />
      <p className="life-summary">Today: <b>{todayMin} min</b> focused · {todays.length} session{todays.length === 1 ? '' : 's'}</p>
      {todays.length > 0 && <ul className="life-list">{todays.map(s => <li key={s.id} className="glass-card life-item"><div className="life-main"><span className="life-title">{s.label || 'Focus session'}</span><span className="life-sub">{s.minutes} min</span></div></li>)}</ul>}
    </section>
  );
}

/* ───────── Habit tracker ───────── */
function Habits() {
  const { items, error, add, patch, remove } = useLife('habit');
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('✅');
  const [remindTime, setRemindTime] = useState('');
  const today = dateStr();
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const toggle = (h, d) => patch(h.id, { days: h.days.includes(d) ? h.days.filter(x => x !== d) : [...h.days, d] });
  const submit = async (e) => { e.preventDefault(); if (!name.trim()) return; if (await add({ name, emoji, days: [], remindTime })) setName(''); };
  const sorted = [...(items || [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (
    <section aria-label="Habit tracker">
      <form className="glass-card life-form" onSubmit={submit}>
        <div className="life-row">
          <select value={emoji} aria-label="Icon" style={{ flex: '0 0 76px' }} onChange={e => setEmoji(e.target.value)}>{['✅', '💧', '📖', '🏃', '🧘', '😴', '🥗', '✍️', '🎵', '💻'].map(x => <option key={x}>{x}</option>)}</select>
          <input value={name} maxLength={60} placeholder="New habit (e.g. Read 20 pages)" aria-label="Habit" onChange={e => setName(e.target.value)} />
          <button className="btn-primary" style={{ width: 'auto', padding: '9px 20px' }} disabled={!name.trim()}>＋ Add</button>
        </div>
        <label className="life-hint life-label">🔔 Remind me every day at <input type="time" value={remindTime} aria-label="Daily reminder time (optional)" onChange={e => setRemindTime(e.target.value)} /> <span>(optional)</span></label>
      </form>
      <Err msg={error} />
      {!items ? <Loading /> : !sorted.length ? <div className="glass-card life-empty">No habits yet. Start with one small thing you want to do every day.</div> : (
        <ul className="life-list">
          {sorted.map(h => {
            const streak = habitStreak(h.days, today);
            return (
              <li key={h.id} className="glass-card habit-card">
                <div className="habit-head">
                  <span className="habit-emoji" aria-hidden="true">{h.emoji}</span>
                  <div className="life-main"><span className="life-title">{h.name}</span><span className="life-sub">🔥 {streak} day streak · best {bestStreak(h.days)}{h.remindTime && ` · 🔔 ${fmtTime(h.remindTime)}`}</span></div>
                  <button type="button" className="life-mini" aria-label={`Delete ${h.name}`} onClick={() => remove(h.id)}>🗑</button>
                </div>
                <div className="habit-week">
                  {week.map(d => {
                    const on = h.days.includes(d);
                    return (
                      <button type="button" key={d} role="checkbox" aria-checked={on} aria-label={`${h.name}, ${prettyDate(d, today)}`} className={`habit-day${on ? ' on' : ''}${d === today ? ' today' : ''}`} onClick={() => toggle(h, d)}>
                        <span>{new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'narrow' })}</span><b>{on ? '✓' : ''}</b>
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ───────── My life hub ───────── */
export default function MyLife({ onBack, initialTab }) {
  const [tab, setTab] = useState(TABS.some(t => t.key === initialTab) ? initialTab : 'planner');
  return (
    <div className="mylife-page">
      <div className="stickies-head">
        {onBack && <button className="btn-ghost" style={{ width: 'auto', padding: '7px 14px' }} onClick={onBack}>← Back</button>}
        <h2>🌟 My life</h2>
      </div>
      <p className="stickies-sub">Reminders, notes, plans, study and habits — all in one place.</p>
      <div className="life-tabs" role="tablist" aria-label="My life sections">
        {TABS.map(t => (
          <button key={t.key} type="button" role="tab" id={`life-tab-${t.key}`} aria-selected={tab === t.key} aria-controls="life-panel" className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>
      <div id="life-panel" role="tabpanel" aria-labelledby={`life-tab-${tab}`} key={tab} data-noswipe="">
        {tab === 'reminders' && <Stickies embedded mode="reminders" />}
        {tab === 'alarm' && <Alarms />}
        {tab === 'notes' && <Stickies embedded mode="notes" />}
        {tab === 'planner' && <Planner />}
        {tab === 'timetable' && <Timetable />}
        {tab === 'assignments' && <Assignments />}
        {tab === 'focus' && <Focus />}
        {tab === 'habits' && <Habits />}
      </div>
    </div>
  );
}
