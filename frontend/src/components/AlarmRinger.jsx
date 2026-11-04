import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { speakReminder } from '../stickyVoice.js';
import { alarmDue, alarmKey, fmtTime } from '../lifeUtils.js';

const SNOOZE_MIN = 5;

// Shows your alarm anywhere in the app while CHEX is open (chime + spoken alert + Stop / Snooze card).
// While CHEX is closed the server sends a phone/desktop notification instead.
export default function AlarmRinger() {
  const [alarms, setAlarms] = useState([]);
  const [ringing, setRinging] = useState(null);
  const fired = useRef(new Set());
  const snoozed = useRef([]);                 // [{ alarm, at }]
  const ringingRef = useRef(null);
  ringingRef.current = ringing;

  const load = useCallback(() => api.lifeItems('alarm').then(r => setAlarms(r.items || [])).catch(() => {}), []);
  useEffect(() => {
    load();
    const poll = setInterval(load, 60000);
    window.addEventListener('chex:alarms-changed', load);
    return () => { clearInterval(poll); window.removeEventListener('chex:alarms-changed', load); };
  }, [load]);

  const startSound = useCallback((alarm) => { speakReminder(alarm.label ? `Alarm. ${alarm.label}` : 'Alarm', { force: true }); }, []);

  const ring = useCallback((alarm) => {
    if (ringingRef.current) return;           // one at a time
    setRinging(alarm);
    startSound(alarm);
  }, [startSound]);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      for (const a of alarms) {
        const key = alarmKey(a, now);
        if (alarmDue(a, now) && !fired.current.has(key)) { fired.current.add(key); ring(a); }
      }
      const due = snoozed.current.find(s => s.at <= now.getTime());
      if (due && !ringingRef.current) { snoozed.current = snoozed.current.filter(s => s !== due); ring(due.alarm); }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [alarms, ring]);

  const silence = () => { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } };

  const stop = async () => {
    const a = ringing; silence(); setRinging(null);
    if (a && !(a.days || []).length) {         // a one-time alarm switches itself off after it has rung
      try { await api.updateLifeItem(a.id, { enabled: false }); } catch { /* shown as still on until the next refresh */ }
      window.dispatchEvent(new Event('chex:alarms-changed'));
    }
  };
  const snooze = () => { const a = ringing; silence(); setRinging(null); if (a) snoozed.current.push({ alarm: a, at: Date.now() + SNOOZE_MIN * 60000 }); };

  return (
    <>
      {ringing && (
        <div className="alarm-ring" role="alertdialog" aria-live="assertive" aria-label="Alarm ringing">
          <div className="alarm-bell" aria-hidden="true">⏰</div>
          <div className="alarm-time">{fmtTime(ringing.time)}</div>
          <div className="alarm-label">{ringing.label || 'Alarm'}</div>
          <div className="alarm-actions">
            <button type="button" className="btn-ghost" onClick={snooze}>😴 Snooze {SNOOZE_MIN} min</button>
            <button type="button" className="btn-primary" onClick={stop}>■ Stop</button>
          </div>
        </div>
      )}
    </>
  );
}
