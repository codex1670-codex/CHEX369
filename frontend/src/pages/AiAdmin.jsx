import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

// Admin → AI: provider status, model + limit management, live connection tests, usage and quota monitoring.
// Secret keys are never shown here (the server only reports whether each is set).
const STATE_TEXT = { ready: 'Ready', disabled: 'Off', not_configured: 'Not set up', cooldown: 'Paused (provider limit)', limit_reached: 'Limit reached' };
const small = { width: 'auto', padding: '7px 13px', fontSize: 12.5 };
const box = { border: '1px solid var(--border-soft)', borderRadius: 12, padding: 12, marginBottom: 10 };
const inp = { background: 'var(--surface-hover)', border: '1px solid var(--border-soft)', borderRadius: 8, color: 'var(--text-hi)', padding: '6px 9px', fontSize: 13 };

function EngineCard({ e, models, onChanged, flash, fail }) {
  const [model, setModel] = useState(e.model);
  const [perUser, setPerUser] = useState(e.limits.perUserDaily);
  const [global, setGlobal] = useState(e.limits.globalDaily);
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setModel(e.model); setPerUser(e.limits.perUserDaily); setGlobal(e.limits.globalDaily); }, [e.model, e.limits.perUserDaily, e.limits.globalDaily]);

  const save = async (extra = {}) => {
    try { await api.aiAdminSetEngine(e.engine, { model, perUserDaily: Number(perUser), globalDaily: Number(global), ...extra }); flash(`${e.label} saved.`); onChanged(); }
    catch (err) { fail(err); }
  };
  const runTest = async () => { setBusy(true); setTest(null); try { setTest(await api.aiAdminTest(e.engine)); onChanged(); } catch (err) { setTest({ ok: false, detail: err.message }); } finally { setBusy(false); } };
  const used = e.usageToday;

  return (
    <div style={box} data-testid={`engine-${e.engine}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b style={{ color: 'var(--text-hi)' }}>{e.label}{e.experimental ? ' (experimental)' : ''} <small style={{ color: 'var(--text-low)', fontWeight: 400 }}>· {e.provider}</small></b>
        <span style={{ fontSize: 12, color: e.state === 'ready' ? '#3ddc84' : '#ffb020' }}>{STATE_TEXT[e.state]}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-low)', margin: '2px 0 8px' }}>{e.what}{e.message ? ` — ${e.message}` : ''}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 12 }}>Model <input style={{ ...inp, width: 230 }} list={`models-${e.engine}`} value={model} onChange={(ev) => setModel(ev.target.value)} aria-label={`${e.label} model`} /></label>
        {(e.engine === 'text' || e.engine === 'vision') && <datalist id={`models-${e.engine}`}>{models.map((m) => <option key={m} value={m} />)}</datalist>}
        <label style={{ fontSize: 12 }}>Per user/day <input style={{ ...inp, width: 70 }} type="number" min="0" value={perUser} onChange={(ev) => setPerUser(ev.target.value)} aria-label={`${e.label} per-user daily limit`} /></label>
        <label style={{ fontSize: 12 }}>All users/day <input style={{ ...inp, width: 70 }} type="number" min="0" value={global} onChange={(ev) => setGlobal(ev.target.value)} aria-label={`${e.label} global daily limit`} /></label>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
        <button type="button" className="btn-primary" style={small} onClick={() => save()}>Save</button>
        <button type="button" className={e.enabled ? 'btn-ghost sel' : 'btn-ghost'} style={small} role="switch" aria-checked={e.enabled} onClick={() => save({ enabled: !e.enabled })}>{e.enabled ? '✓ Enabled' : 'Disabled'}</button>
        <button type="button" className="btn-ghost" style={small} disabled={busy} onClick={runTest}>{busy ? 'Testing…' : 'Test connection'}</button>
        {e.cooldownUntil && <button type="button" className="btn-ghost" style={small} onClick={async () => { await api.aiAdminReset(e.engine).catch(fail); onChanged(); }}>Clear pause</button>}
        <small style={{ color: 'var(--text-low)' }}>Today: {used.requests} requests · {used.errors || 0} errors{e.engine === 'text' || e.engine === 'vision' ? '' : ''}</small>
      </div>
      {test && <div role="status" style={{ marginTop: 8, fontSize: 12.5, color: test.ok ? '#3ddc84' : '#ff7a7a' }}>{test.ok ? '✅' : '❌'} {test.detail} ({test.ms} ms)</div>}
    </div>
  );
}

export default function AiAdmin({ flash, fail }) {
  const [ov, setOv] = useState(null);
  const [models, setModels] = useState([]);
  const load = useCallback(() => api.aiAdminOverview().then(setOv).catch(fail), [fail]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.aiAdminModels().then((r) => setModels(r.models || [])).catch(() => {}); }, []);
  if (!ov) return <div className="glass-card" style={{ padding: 16 }}>Loading AI settings…</div>;
  const p = ov.providers; const cf = p.cloudflare;
  const pct = Math.min(100, Math.round((cf.neuronsUsedToday / cf.freeNeuronsPerDay) * 100));

  return (
    <div>
      <div className="glass-card" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, color: 'var(--text-hi)' }}>🧠 CODEX AI providers</div>
        <div style={{ fontSize: 12.5, margin: '4px 0 10px', color: ov.freeOnly ? '#3ddc84' : '#ff7a7a' }}>
          {ov.freeOnly ? '🆓 FREE_ONLY_MODE is ON — paid services are never used and credits are never bought.' : '⚠️ FREE_ONLY_MODE is OFF. CHEX still never buys credits, but paid-tier models are no longer blocked.'}
        </div>
        <div style={box}><b>Groq</b> — text &amp; vision<div style={{ fontSize: 12, color: 'var(--text-low)' }}>Host {p.groq.host} · key {p.groq.keySet ? 'set ✓' : 'missing ✗'} · up to {p.groq.concurrency} requests at a time. {p.groq.note}</div></div>
        <div style={box}><b>Cloudflare Workers AI</b> — image, speech-to-text, text-to-speech
          <div style={{ fontSize: 12, color: 'var(--text-low)' }}>Account {cf.accountSet ? '✓' : '✗'} · token {cf.tokenSet ? '✓' : '✗'} · CHEX stops at {cf.chexDailyCap} of {cf.freeNeuronsPerDay} free neurons/day. {cf.note}</div>
          <div aria-label="Cloudflare neurons used today" style={{ height: 8, background: 'var(--surface-hover)', borderRadius: 6, marginTop: 6, overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: pct > 80 ? '#ffb020' : '#3ddc84' }} /></div>
          <div style={{ fontSize: 12, marginTop: 3 }}>{cf.neuronsUsedToday} neurons used today ({pct}% of the free allowance)</div></div>
        <div style={box}><b>Video</b> (experimental)<div style={{ fontSize: 12, color: 'var(--text-low)' }}>Free models allowed: {p.video.freeModels.join(', ')} · key {p.video.keySet ? 'set' : 'not set (anonymous, heavily rate-limited)'}. {p.video.note}</div></div>
        <div style={box}><b>Memory</b><div style={{ fontSize: 12, color: 'var(--text-low)' }}>{p.memory.kind === 'mongodb' ? 'MongoDB' : 'Local database (set MONGODB_URI to use MongoDB)'} — {p.memory.ok ? 'connected ✓' : 'unreachable ✗'}</div></div>
      </div>

      {ov.engines.map((e) => <EngineCard key={e.engine} e={e} models={models} onChanged={load} flash={flash} fail={fail} />)}

      <div className="glass-card" style={{ padding: 16 }}>
        <div style={{ color: 'var(--text-hi)', marginBottom: 6 }}><b>Usage — {ov.usage.day} (UTC)</b></div>
        {ov.usage.topUsers.length > 0 ? <div style={{ fontSize: 12.5 }}>Top users today: {ov.usage.topUsers.map((u) => `@${u.username} (${u.requests})`).join(', ')}</div> : <div style={{ fontSize: 12.5, color: 'var(--text-low)' }}>No AI use yet today.</div>}
        <div style={{ fontSize: 12.5, marginTop: 8 }}><b>Recent errors</b></div>
        {ov.usage.recentErrors.length ? <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12 }}>{ov.usage.recentErrors.map((r, i) => <li key={i}>{r.engine} · {r.code} · {r.at}</li>)}</ul> : <div style={{ fontSize: 12, color: 'var(--text-low)' }}>None 🎉</div>}
        <button type="button" className="btn-ghost" style={{ ...small, marginTop: 10 }} onClick={load}>Refresh</button>
      </div>
    </div>
  );
}
