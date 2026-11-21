import { useEffect, useState } from 'react';
import { usePerf } from './usePerf.js';
import { saveMode, retestDevice } from './perfProfile.js';

const MODES = [
  ['auto', '✨ Auto', 'Best for this device (recommended)'],
  ['smooth120', '⚡ 120 FPS', 'Smoothest, if your screen supports it'],
  ['smooth60', '🎯 60 FPS', 'Steady and light'],
  ['saver', '🔋 Saver', '30 FPS, lightest effects'],
];
const TIER = { low: 'Entry-level', mid: 'Mid-range', high: 'High-end' };

// Settings → Performance: adaptive 60 / 120 FPS. Everything is measured on this device and kept on this device.
export default function PerfSettings() {
  const perf = usePerf();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(perf.mode);
  useEffect(() => setMode(perf.mode), [perf.mode]);

  const pick = (m) => setMode(saveMode(m));
  const retest = async () => { setBusy(true); try { await retestDevice(); } finally { setBusy(false); } };

  return (
    <div className="glass-card" style={{ padding: 20, marginBottom: 20 }} data-testid="perf-settings">
      <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display)', fontSize: 16 }}>🚀 Smooth performance</h3>
      <p style={{ fontSize: 12.5, color: 'var(--text-mid)', margin: '0 0 10px' }}>
        CHEX checks your screen and device, then runs animations at 60 or 120 FPS, whichever your phone can hold. If it ever starts to stutter, it eases off by itself and recovers when things calm down.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {MODES.map(([id, label]) => (
          <button key={id} type="button" className={`btn-ghost${mode === id ? ' sel' : ''}`} style={{ width: 'auto', padding: '7px 14px' }} aria-pressed={mode === id} onClick={() => pick(id)}>{label}</button>
        ))}
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-mid)', margin: '0 0 10px' }}>{MODES.find(([id]) => id === mode)?.[2]}</p>
      <div className="sg-hint" data-testid="perf-status" style={{ marginBottom: 10 }}>
        Running at <b>{perf.fps} FPS</b> · screen {perf.measured ? `${perf.refresh} Hz` : 'checking…'} · {TIER[perf.tier] || 'Mid-range'} device · effects: {perf.level}
        {perf.reason ? ` (${perf.reason})` : ''}
      </div>
      <button type="button" className="btn-ghost" style={{ width: 'auto', padding: '7px 14px' }} disabled={busy} onClick={retest}>{busy ? 'Testing…' : '↻ Test my device again'}</button>
    </div>
  );
}
