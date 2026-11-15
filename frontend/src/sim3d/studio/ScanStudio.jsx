import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { updateCodexContext } from '../../codexContext.js';
import Viewport from './Viewport.jsx';
import CaptureTab from './CaptureTab.jsx';
import { prepareForUpload } from './capture.js';
import { ReconstructTab, PartsTab, EditTab } from './panelsA.jsx';
import { WhatIfTab, SimulateTab, MeasureTab, ExportTab, PublishTab, StudioTab } from './panelsB.jsx';
import { interpret } from './assistant.js';
import { connectedComponents, formatLength } from './studioMath.js';
import { Btn, Primary, Confirm, fmtBytes, fmtNum } from './ui.jsx';
import './studio.css';

const TABS = [['capture', '📷', 'Capture'], ['reconstruct', '🧬', 'Reconstruct'], ['studio', '🧊', '3D Studio'], ['parts', '🧩', 'Parts'], ['edit', '🛠️', 'Edit'], ['whatif', '🧪', 'What-If Lab'], ['simulate', '⚙️', 'Simulate'], ['measure', '📐', 'Measure'], ['export', '⬇️', 'Export'], ['publish', '🌐', 'Publish']];
const toast = (text) => window.dispatchEvent(new CustomEvent('chex:toast', { detail: { text } }));
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const STATE_BUDGET = 900 * 1024;

// ------------------------------------------------------------------------------------------ project list
function ProjectHome({ onOpen }) {
  const [list, setList] = useState(null); const [usage, setUsage] = useState(null); const [err, setErr] = useState(''); const [name, setName] = useState(''); const [del, setDel] = useState(null); const [thumbs, setThumbs] = useState({});
  const load = useCallback(async () => { try { const [p, u] = await Promise.all([api.scanProjects(), api.scanUsage()]); setList(p.projects); setUsage(u); } catch (e) { setErr(e.message || 'Could not load your projects.'); } }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!list) return undefined; let dead = false; const urls = []; list.filter((p) => p.hasThumb && !thumbs[p.id]).forEach(async (p) => { try { const u = URL.createObjectURL(await api.scanGetThumb(p.id)); urls.push(u); if (!dead) setThumbs((t) => ({ ...t, [p.id]: u })); } catch { /* no thumb */ } }); return () => { dead = true; }; /* eslint-disable-next-line */ }, [list]);
  useEffect(() => () => Object.values(thumbs).forEach(URL.revokeObjectURL), []); // eslint-disable-line
  const create = async () => { try { const r = await api.scanCreateProject(name.trim() || 'Untitled scan'); onOpen(r.project.id); } catch (e) { setErr(e.message); } };
  return (
    <div className="ss-home">
      <header><h2>Your 3D scan projects</h2>{usage && <small>{usage.projects}/{usage.maxProjects} projects · {fmtBytes(usage.bytes)} stored</small>}</header>
      {err && <div className="error-banner" role="alert">{err}</div>}
      <div className="ss-row"><input className="ss-text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="New project name" aria-label="New project name" maxLength={80} /><Primary onClick={create}>＋ New scan project</Primary></div>
      {!list && !err && <p className="ss-help">Loading…</p>}
      {list && !list.length && <p className="ss-help">No projects yet. Scans are private to you until you publish them.</p>}
      <ul className="ss-projects">
        {list?.map((p) => (
          <li key={p.id}>
            <button type="button" className="ss-proj-open" onClick={() => onOpen(p.id)}>
              <span className="ss-proj-thumb">{thumbs[p.id] ? <img src={thumbs[p.id]} alt="" /> : <span aria-hidden="true">🧊</span>}</span>
              <b>{p.name}</b><small>{p.status} · {p.hasModel ? fmtBytes(p.modelBytes) : 'no model'} · {new Date(p.updatedAt).toLocaleDateString()}</small>
            </button>
            <div className="ss-row"><Btn onClick={async () => { try { await api.scanDuplicateProject(p.id); load(); } catch (e) { setErr(e.message); } }}>⧉ Duplicate</Btn><Btn onClick={() => setDel(p)}>🗑 Delete</Btn></div>
          </li>
        ))}
      </ul>
      {del && <Confirm text={`Permanently delete “${del.name}”, its model files and scan history? This cannot be undone. (A post you already published keeps its own copy until you delete the post.)`} yes="Delete forever" onYes={async () => { try { await api.scanDeleteProject(del.id); setDel(null); load(); } catch (e) { setErr(e.message); } }} onNo={() => setDel(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------ assistant
function Assistant({ run, names }) {
  const [log, setLog] = useState([{ who: 'ai', text: 'Hi! Ask me to change the view, separate parts, hide or select things, make a variant, simplify, measure, explain the model or prepare it for sharing. Anything that changes the model asks you first.' }]);
  const [text, setText] = useState(''); const [pending, setPending] = useState(null); const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [log, pending]);
  const send = async (q) => {
    const t = (q ?? text).trim(); if (!t) return; setText(''); setLog((l) => [...l, { who: 'me', text: t }]);
    const r = await run(t); if (r?.reply) setLog((l) => [...l, { who: 'ai', text: r.reply }]); setPending(r?.confirm ? r.confirm : null);
  };
  const decide = async (yes) => { const p = pending; setPending(null); if (!yes) { setLog((l) => [...l, { who: 'ai', text: 'Okay, nothing changed.' }]); return; } const r = await p.run(); setLog((l) => [...l, { who: 'ai', text: r || 'Done. Undo (Ctrl+Z) reverts it.' }]); };
  return (
    <div className="ss-ai"><h4>✨ Codex scan assistant</h4>
      <div className="ss-ai-log" role="log" aria-live="polite">{log.map((m, i) => <p key={i} className={m.who}>{m.text}</p>)}{pending && <Confirm text={pending.text} onYes={() => decide(true)} onNo={() => decide(false)} />}<span ref={end} /></div>
      <div className="ss-chips">{['Show from the top', 'Separate the components', 'Explain this model', 'Create a simplified version'].map((c) => <button key={c} type="button" onClick={() => send(c)}>{c}</button>)}</div>
      <form onSubmit={(e) => { e.preventDefault(); send(); }}><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about this scan…" aria-label="Ask the scan assistant" maxLength={200} /><button type="submit" className="btn-primary" aria-label="Send">➤</button></form>
      <small className="ss-help">Understands English commands. Other languages and free-form questions go to the main Codex assistant, which can see this page.</small>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ studio
function Studio({ openId, onHome }) {
  const vp = useRef(null);
  const [eng, setEng] = useState(null); const [glErr, setGlErr] = useState('');
  const [project, setProject] = useState(null); const projRef = useRef(null);
  const [loading, setLoading] = useState('Opening project…'); const [loadErr, setLoadErr] = useState('');
  const [tab, setTab] = useState('capture'); const [parts, setParts] = useState([]); const [selected, setSelected] = useState(new Set()); const [stats, setStats] = useState({ parts: 0, triangles: 0, vertices: 0, points: 0, textures: [] });
  const [tick, setTick] = useState(0); const [hist, setHist] = useState([]); const [frames, setFrames] = useState([]); const [caps, setCaps] = useState(null);
  const [job, setJob] = useState(null); const [upload, setUpload] = useState(0); const [sequential, setSequential] = useState(false); const [speed, setSpeed] = useState('fast');
  const [unit, setUnit] = useState('cm'); const [measurements, setMeasurements] = useState([]);
  const [save, setSave] = useState('saved'); const [side, setSide] = useState(true);
  const [ex, setEx] = useState({ variants: [], versions: [], baseState: null, active: 'original' }); const exRef = useRef(ex);
  const setExtra = (fn) => setEx((p) => { const n = typeof fn === 'function' ? fn(p) : fn; exRef.current = n; return n; });
  const holdRef = useRef(null); const geomDirty = useRef(false); const timer = useRef(null); const saving = useRef(false); const unitRef = useRef(unit); unitRef.current = unit; const framesRef = useRef(frames); framesRef.current = frames;
  projRef.current = project;

  // ---- engine events -> React state
  useEffect(() => {
    if (!eng) return undefined;
    return eng.on((t, d) => {
      if (t === 'parts') setParts(d); else if (t === 'selection') setSelected(new Set(d)); else if (t === 'stats') setStats(d);
      else if (t === 'transform') setTick((x) => x + 1); else if (t === 'history') setHist(eng.history.map((h) => h.label));
      else if (t === 'measure') setMeasurements((m) => [...m, d.mode === 'distance' ? { id: m.length + 1, mode: 'distance', metres: d.metres, raw: d.raw } : { id: m.length + 1, mode: 'angle', degrees: d.degrees }]);
      else if (t === 'geometry') { geomDirty.current = true; }
      else if (t === 'dirty') onDirty(); else if (t === 'meta') schedule();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eng]);

  const notify = useCallback((t) => toast(t), []);

  // ---- persistence
  const syncActive = () => { const e = exRef.current; if (eng && e.active !== 'original') { e.variants = e.variants.map((v) => (v.id === e.active ? { ...v, state: eng.captureState() } : v)); } };
  const persist = useCallback(async () => {
    const p = projRef.current; if (!eng || !p || saving.current) return; saving.current = true; setSave('saving');
    try {
      syncActive(); let e = exRef.current; let state = { v: 1, current: eng.captureState(), unit: unitRef.current, baseState: e.baseState, variants: e.variants, versions: e.versions, active: e.active };
      while (JSON.stringify(state).length > STATE_BUDGET && state.versions.length) { state = { ...state, versions: state.versions.slice(1) }; toast('Oldest saved version dropped to stay within the project size limit.'); }
      if (state.versions.length !== e.versions.length) setExtra((x) => ({ ...x, versions: state.versions }));
      if (geomDirty.current && stats.parts) {
        const glb = await eng.exportModel('glb', { all: true });
        if (glb.size > 80 * 1024 * 1024) throw new Error('This model is larger than the 80 MB project limit. Simplify it, then save again.');
        await api.scanPutModel(p.id, glb, 'current'); geomDirty.current = false;
      }
      await api.scanSaveProject(p.id, { state }); setSave('saved');
    } catch (err) { setSave('error'); toast(err.message || 'Could not save.'); } finally { saving.current = false; }
  }, [eng, stats.parts]); // eslint-disable-line
  const persistRef = useRef(persist); persistRef.current = persist;
  const schedule = useCallback(() => { setSave('dirty'); clearTimeout(timer.current); timer.current = setTimeout(() => persistRef.current(), 1600); }, []);
  const saveNow = useCallback(async (announce) => { clearTimeout(timer.current); await persistRef.current(); if (announce) toast('Saved.'); }, []);

  // Editing while the Original is showing never changes it: a new variant takes the edits.
  const onDirty = useCallback(() => {
    const e = exRef.current;
    if (e.active === 'original' && e.baseState && eng) {
      const v = { id: uid(), name: `Variant ${e.variants.length + 1}`, state: eng.captureState(), at: Date.now() };
      setExtra({ ...e, variants: [...e.variants, v], active: v.id }); toast(`Original kept safe — your changes are going into “${v.name}”.`);
    }
    schedule();
  }, [eng, schedule]);

  // ---- open project
  useEffect(() => {
    if (!eng || !openId) return undefined; let dead = false;
    (async () => {
      try {
        setLoading('Opening project…'); const [{ project: p }, c] = await Promise.all([api.scanGetProject(openId), api.scanCapabilities().catch(() => null)]);
        if (dead) return; setProject(p); setCaps(c);
        const s = p.state; setExtra({ variants: s?.variants || [], versions: s?.versions || [], baseState: s?.baseState || null, active: s?.active || 'original' }); if (s?.unit) setUnit(s.unit);
        if (p.hasModel) { setLoading('Loading model…'); const blob = await api.scanGetModel(openId); if (dead) return; await eng.importBuffer(await blob.arrayBuffer(), 'glb', p.name); if (s?.current) eng.applyState(s.current); setTab('studio'); }
        const js = await api.scanJobs(openId).catch(() => ({ jobs: [] })); if (!dead && js.jobs[0] && p.status === 'processing') setJob(js.jobs[0]);
        setLoading('');
      } catch (e) { if (!dead) { setLoadErr(e.message || 'Could not open this project.'); setLoading(''); } }
    })();
    return () => { dead = true; };
  }, [eng, openId]);

  // ---- job polling
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return undefined;
    const t = setInterval(async () => { try { const r = await api.scanJob(job.id); setJob(r.job); if (!['queued', 'running'].includes(r.job.status)) { const g = await api.scanGetProject(projRef.current.id); setProject(g.project); projRef.current = g.project; if (r.job.status === 'done') adoptJobResult(r.job); } } catch { /* keep polling */ } }, 1000);
    return () => clearInterval(t);
  }, [job?.id, job?.status]); // eslint-disable-line

  const startJob = async (kind) => {
    const used = framesRef.current.filter((f) => f.keep); const f = new FormData(); setUpload(0.01);
    for (const [i, u] of used.entries()) f.append('images', await prepareForUpload(u.blob, kind === 'single-image' ? { maxSide: 1536, keepUnderBytes: 1.5 * 1024 * 1024 } : { maxSide: 3200, keepUnderBytes: 8 * 1024 * 1024 }), `${String(i).padStart(3, '0')}.jpg`);
    f.append('projectId', project.id); f.append('engine', kind); f.append('sequential', sequential ? '1' : '0'); f.append('speed', speed);
    try { setUpload(0.01); const r = await api.scanStartJob(f, setUpload); setUpload(0); setJob(r.job); } catch (e) { setUpload(0); toast(e.message || 'Upload failed.'); }
  };
  const adopt = useCallback(async () => {
    const p = projRef.current; setLoading('Saving the original model…');
    try {
      const base = eng.captureState(); const glb = await eng.exportModel('glb', { all: true });
      if (glb.size > 80 * 1024 * 1024) throw new Error('That model is larger than the 80 MB limit.');
      await api.scanPutModel(p.id, glb, 'original'); const th = await eng.thumbnail(); if (th) await api.scanPutThumb(p.id, th).catch(() => {});
      setExtra({ variants: [], versions: [], baseState: base, active: 'original' }); geomDirty.current = false;
      const g = await api.scanGetProject(p.id); setProject(g.project); setTab('studio'); setSave('dirty'); setTimeout(() => persistRef.current(), 300);
    } catch (e) { toast(e.message || 'Could not save the model.'); } finally { setLoading(''); }
  }, [eng]);
  const importModel = useCallback(async (file) => { if (projRef.current?.hasModel) { toast('This project already has a model. Create a new project to import another.'); return; } setLoading('Importing…'); try { await eng.importFile(file); await adopt(); } catch (e) { setLoading(''); toast(e.message); } }, [eng, adopt]);
  const adoptJobResult = async (j = job) => {
    if (!j?.hasResult || projRef.current?.hasModel) return;
    setLoading('Opening the result…');
    try { const blob = await api.scanJobResult(j.id); await eng.importBuffer(await blob.arrayBuffer(), j.resultExt.slice(1), projRef.current.name); await adopt(); } catch (e) { setLoading(''); toast(e.message || 'Could not open the result.'); }
  };
  const rename = async (name) => { const n = name.trim(); if (!n || n === project.name) return; try { const r = await api.scanSaveProject(project.id, { name: n }); setProject((p) => ({ ...p, name: r.project.name })); } catch (e) { toast(e.message); } };

  // ---- what-if lab
  const wi = {
    get variants() { return ex.variants; }, get versions() { return ex.versions; }, get active() { return ex.active; }, get baseState() { return ex.baseState; }, hasOriginal: !!project?.hasOriginal,
    create: (name) => { const e = exRef.current; syncActive(); const v = { id: uid(), name: name || `Variant ${e.variants.length + 1}`, state: eng.captureState(), at: Date.now() }; setExtra({ ...exRef.current, variants: [...exRef.current.variants, v], active: v.id }); schedule(); },
    switchTo: (id) => { syncActive(); const e = exRef.current; const st = id === 'original' ? e.baseState : e.variants.find((v) => v.id === id)?.state; if (!st) return; eng.applyState(st); setExtra({ ...e, variants: [...e.variants], active: id }); schedule(); },
    remove: (id) => { const e = exRef.current; setExtra({ ...e, variants: e.variants.filter((v) => v.id !== id), active: e.active === id ? 'original' : e.active }); if (e.active === id && e.baseState) eng.applyState(e.baseState); schedule(); },
    saveVersion: () => { syncActive(); const e = exRef.current; setExtra({ ...e, versions: [...e.versions, { id: uid(), label: `Version ${e.versions.length + 1}`, at: Date.now(), state: eng.captureState() }].slice(-30) }); schedule(); toast('Version saved.'); },
    restoreVersion: (id) => { const v = exRef.current.versions.find((x) => x.id === id); if (v) { eng.applyState(v.state); schedule(); toast(`Restored ${v.label}.`); } },
    restoreOriginal: async () => { const blob = await api.scanGetModel(project.id, 'original'); await eng.importBuffer(await blob.arrayBuffer(), 'glb', project.name); if (exRef.current.baseState) eng.applyState(exRef.current.baseState); setExtra({ ...exRef.current, active: 'original' }); geomDirty.current = true; schedule(); toast('Original geometry restored.'); },
    peek: (id) => { const e = exRef.current; if (id === 'original') { if (!holdRef.current) holdRef.current = eng.captureState(); if (e.baseState) eng.applyState(e.baseState); } else if (holdRef.current) { eng.applyState(holdRef.current); holdRef.current = null; } },
  };

  // ---- publish
  const publish = async ({ caption, audience, variantId }) => {
    const p = projRef.current; syncActive(); const keep = eng.captureState(); const e = exRef.current;
    const st = variantId === 'current' ? null : e.variants.find((v) => v.id === variantId)?.state;
    try {
      if (st) eng.applyState(st);
      const glb = await eng.exportModel('glb', { all: true }); await api.scanPutModel(p.id, glb, 'current');
      const shot = await eng.poster(2048);   // large, smooth, helper-free, fully framed
      await api.publishScan3D(new File([shot.blob], shot.type === 'image/png' ? 'scan.png' : 'scan.jpg', { type: shot.type }), p.id, caption, audience);
      window.dispatchEvent(new CustomEvent('chex:post-created'));
    } finally { if (st) { eng.applyState(keep); try { const back = await eng.exportModel('glb', { all: true }); await api.scanPutModel(p.id, back, 'current'); } catch { /* next autosave retries */ } } }
  };

  // ---- assistant
  const names = parts.filter((p) => !p.deleted).map((p) => ({ id: p.id, name: p.name }));
  const runAssistant = async (text) => {
    if (!eng) return { reply: 'The viewport is not ready yet.' };
    const it = interpret(text, { partNames: names, selected: [...selected] });
    const live = parts.filter((p) => !p.deleted); const sel = [...selected];
    switch (it.intent) {
      case 'undo': return { reply: eng.undo() ? 'Undone.' : 'Nothing to undo.' };
      case 'redo': return { reply: eng.redo() ? 'Redone.' : 'Nothing to redo.' };
      case 'frame': eng.frame(); return { reply: 'Camera reset.' };
      case 'view': setTab((t) => (['capture', 'reconstruct'].includes(t) ? 'studio' : t)); eng.setView(it.value); return { reply: `Showing the ${it.value} view.` };
      case 'viewMode': setTab((t) => (['capture', 'reconstruct'].includes(t) ? 'studio' : t)); eng.setViewMode(it.value); return { reply: `${it.value} view on.` };
      case 'hide': it.ids.forEach((id) => eng.setVisible(id, false)); return { reply: `Hid ${it.ids.length} part(s).` };
      case 'showPart': if (it.all) live.forEach((p) => !p.visible && eng.setVisible(p.id, true)); else it.ids.forEach((id) => eng.setVisible(id, true)); return { reply: 'Shown.' };
      case 'select': eng.select(it.ids); return { reply: `Selected ${it.ids.length} part(s).` };
      case 'lock': case 'unlock': it.ids.forEach((id) => eng.setLocked(id, it.intent === 'lock')); return { reply: `${it.intent === 'lock' ? 'Locked' : 'Unlocked'}.` };
      case 'duplicate': eng.duplicate(it.ids); return { reply: 'Duplicated.' };
      case 'rename': setTab('parts'); return { reply: 'Double-click the part name in the list (or press Rename) and type the new name.' };
      case 'delete': return { reply: '', confirm: { text: `Delete ${it.ids.length} part(s)? This can be undone and the original file is never changed.`, run: async () => { eng.remove(it.ids); return 'Deleted.'; } } };
      case 'split': {
        const target = sel.length ? parts.find((p) => p.id === sel[0]) : [...live].filter((p) => p.kind === 'mesh').sort((a, b) => b.tris - a.tris)[0]; if (!target) return { reply: 'There is no mesh to separate yet.' };
        const o = eng.part(target.id).object; const g = o.geometry; const n = connectedComponents(g.getAttribute('position').array, g.index ? Array.from(g.index.array) : undefined).length;
        if (n < 2) return { reply: `“${target.name}” is a single connected piece, so it cannot be separated automatically. You can still group parts by hand in the Parts tab.` };
        return { reply: '', confirm: { text: `“${target.name}” can be separated into ${n} disconnected pieces${n > 40 ? ' (only the 40 largest will be created)' : ''}. Apply?`, run: async () => { setTab('parts'); return `Created ${eng.split(target.id)} parts.`; } } };
      }
      case 'simplify': { const big = live.filter((p) => p.kind === 'mesh' && p.tris >= 200 && p.tris <= 120000); if (!big.length) return { reply: 'No part is big enough to simplify in the browser (200 – 120,000 triangles each).' };
        return { reply: '', confirm: { text: `Simplify ${big.length} part(s) to about ${Math.round(it.ratio * 100)}% of their triangles? Your original model file stays stored, and Undo works.`, run: async () => { let ok = 0; for (const p of big) { try { await eng.simplify(p.id, it.ratio); ok++; } catch { /* skip */ } } return `Simplified ${ok} part(s). Now ${fmtNum(eng.stats().triangles)} triangles.`; } } }; }
      case 'smooth': { const t = sel.length ? sel : live.filter((p) => p.kind === 'mesh').map((p) => p.id); return { reply: '', confirm: { text: `Smooth ${t.length} part(s)? It softens detail slightly and can be undone.`, run: async () => { let ok = 0; for (const id of t) { try { eng.smooth(id, 2); ok++; } catch { /* skip */ } } return `Smoothed ${ok} part(s).`; } } }; }
      case 'variant': {
        if (!exRef.current.baseState) return { reply: 'Add a model first, then I can make variants.' };
        wi.create(`Variant ${exRef.current.variants.length + 1}${it.material ? ` (${it.material})` : ''}`);
        live.filter((p) => p.kind === 'mesh' && !p.locked).forEach((p) => { if (it.material) eng.applyPreset(p.id, it.material[0].toUpperCase() + it.material.slice(1)); if (it.color) eng.setMaterial(p.id, { color: { grey: '#888888', gray: '#888888', gold: '#d4af37', silver: '#c0c0c0' }[it.color] || it.color }); });
        setTab('whatif'); return { reply: 'Made a new variant with that change. The original is untouched — switch back any time in the What-If Lab.' };
      }
      case 'simulate': {
        setTab('simulate');
        try { eng.startSim({ fixedIds: [] }); eng.playSim(true); } catch (e) { return { reply: e.message }; }
        return { reply: 'Dropping the model in the simplified physics preview. It only moves the view — nothing is changed in your project, and “Stop” on the Simulate tab puts every part back.' };
      }
      case 'simStop': eng.stopSim(); return { reply: 'Simulation stopped and every part is back where it was.' };
      case 'balance': {
        try {
          const r = eng.analyseStructure(); setTab('simulate');
          if (!r.support) return { reply: 'Nothing touches the ground, so there is no footprint to balance on.' };
          return { reply: r.stable ? `The centre of mass is over the footprint (${formatLength(r.marginM, unit)} from the nearest edge), so it should stand; it would start to tip at roughly ${r.tipAngleDeg.toFixed(0)}° of tilt. This treats every part as the same solid material and is not a safety check.` : `The centre of mass is ${formatLength(Math.abs(r.marginM), unit)} outside the footprint, so this pose would tip over. This is a rough box-based check, not a safety analysis.` };
        } catch (e) { return { reply: e.message }; }
      }
      case 'compareMaterials': setTab('simulate'); return { reply: 'Open the “🎨 Materials” section on the Simulate tab and press “Compare all materials” — it renders your model in each material side by side, and nothing changes until you press Keep.' };
      case 'measure': setTab('measure'); return { reply: `Press “${it.mode === 'angle' ? 'Angle' : 'Distance'}” on the left, then click ${it.mode === 'angle' ? 'three points' : 'two points'} on the model. Calibrate the scale there for real-world units.` };
      case 'dimensions': { const s = eng.size(); return { reply: `Bounding box: ${formatLength(s.x, unit)} × ${formatLength(s.y, unit)} × ${formatLength(s.z, unit)} (length × height × width). These are real-world values only if the scale has been calibrated.` }; }
      case 'explain': { const a = eng.analyse(); const s = eng.size(); const kinds = live.length; return { reply: `This model has ${kinds} part(s), ${fmtNum(stats.triangles)} triangles${stats.points ? ` and ${fmtNum(stats.points)} points` : ''}. Its box is ${formatLength(s.x, unit)} × ${formatLength(s.y, unit)} × ${formatLength(s.z, unit)}. The mesh is ${a.closed ? 'closed (watertight), so volume can be estimated' : `open (${fmtNum(a.boundaryEdges)} open edges), so volume is not reliable`}. ${live.slice(0, 6).map((p) => p.name).join(', ')}${live.length > 6 ? '…' : ''}. I can describe geometry, not what the object is for.` }; }
      case 'prepareShare': { const issues = []; if (!project?.hasModel) issues.push('save the model to the project'); if (stats.triangles > 300000) issues.push(`simplify it (${fmtNum(stats.triangles)} triangles is heavy for the feed)`); setTab('publish'); return { reply: issues.length ? `Before sharing you should ${issues.join(' and ')}. I’ve opened Publish for you.` : 'It looks ready. I’ve opened Publish — add a caption, choose who can see it and tick the confirmation.' }; }
      case 'save': await saveNow(true); return { reply: 'Saved.' };
      case 'goto': setTab(it.value); return { reply: 'Opened.' };
      default: return { reply: it.reply };
    }
  };

  // ---- Codex context, keyboard, unload guard
  useEffect(() => { updateCodexContext({ screen: 'sim3d-studio', studio: { project: project?.name, tab, selectedParts: parts.filter((p) => selected.has(p.id)).map((p) => p.name).slice(0, 5), parts: stats.parts, triangles: stats.triangles, variant: ex.active } }); }, [project?.name, tab, parts, selected, stats, ex.active]);
  useEffect(() => {
    const key = (e) => {
      if (!eng || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
      const m = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
      if (m && k === 'z') { e.preventDefault(); e.shiftKey ? eng.redo() : eng.undo(); } else if (m && k === 'y') { e.preventDefault(); eng.redo(); } else if (m && k === 's') { e.preventDefault(); saveNow(true); }
      else if (k === 'delete' || k === 'backspace') { if (selected.size && tab !== 'capture') { e.preventDefault(); eng.remove([...selected]); } }
      else if (k === 'f') eng.frame(); else if (k === 'escape') eng.select([]);
      else if (tab === 'edit' && k === 'g') eng.setGizmo('translate'); else if (tab === 'edit' && k === 'r') eng.setGizmo('rotate'); else if (tab === 'edit' && k === 's' && !m) eng.setGizmo('scale');
      else if (k === 'w') eng.setViewMode(eng.viewMode === 'wireframe' ? 'textured' : 'wireframe');
    };
    const unload = (e) => { if (save === 'dirty' || save === 'saving') { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('keydown', key); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('beforeunload', unload); };
  }, [eng, selected, tab, save, saveNow]);
  useEffect(() => () => { clearTimeout(timer.current); }, []);
  const leave = async () => { if (save === 'dirty') await saveNow(); onHome(); };

  const ctx = {
    eng, parts, selected, stats, tick, notify, project, projectHasModel: !!project?.hasModel, engineReady: !!eng, frames, setFrames, go: setTab, importModel, caps, job, upload, startJob, sequential, setSequential, speed, setSpeed,
    cancelJob: async () => { try { const r = await api.scanCancelJob(job.id); setJob(r.job); } catch (e) { toast(e.message); } },
    retryJob: async () => { try { const r = await api.scanRetryJob(job.id); setJob(r.job); } catch (e) { toast(e.message); } },
    adoptJobResult, unit, setUnit: (u) => { setUnit(u); schedule(); }, measurements, setMeasurements, wi, publish, saveNow,
  };
  const wide = tab === 'capture' || tab === 'reconstruct';
  const panel = !eng ? null : { capture: <CaptureTab ctx={ctx} />, reconstruct: <ReconstructTab ctx={ctx} />, studio: <StudioTab ctx={ctx} />, parts: <PartsTab ctx={ctx} />, edit: <EditTab ctx={ctx} />, whatif: <WhatIfTab ctx={ctx} />, simulate: <SimulateTab ctx={ctx} />, measure: <MeasureTab ctx={ctx} />, export: <ExportTab ctx={ctx} />, publish: <PublishTab ctx={ctx} /> }[tab];
  const sel1 = eng && selected.size ? eng.part([...selected][0]) : null;
  const lastJobActive = job && ['queued', 'running'].includes(job.status);

  return (
    <div className="ss-root">
      <header className="ss-top">
        <button type="button" className="btn-ghost ss-btn" onClick={leave}>← Projects</button>
        <input className="ss-title" defaultValue={project?.name || ''} key={project?.id + (project?.name || '')} onBlur={(e) => rename(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Project name" maxLength={80} />
        <span className={`ss-save ${save}`} role="status">{save === 'saved' ? '✓ Saved' : save === 'saving' ? 'Saving…' : save === 'dirty' ? '● Unsaved' : '⚠ Not saved'}</span>
        <div className="ss-top-acts">
          <button type="button" className="btn-ghost ss-btn" onClick={() => eng?.undo()} disabled={!hist.length} aria-label="Undo">↶</button>
          <button type="button" className="btn-ghost ss-btn" onClick={() => eng?.redo()} disabled={!eng?.future.length} aria-label="Redo">↷</button>
          <button type="button" className="btn-ghost ss-btn" onClick={() => saveNow(true)}>💾 Save</button>
          <button type="button" className="btn-ghost ss-btn" onClick={() => setTab('export')}>⬇ Export</button>
          <button type="button" className="btn-primary ss-btn" onClick={() => setTab('publish')}>🌐 Publish</button>
        </div>
      </header>
      <nav className="ss-tabs" role="tablist" aria-label="Studio steps">
        {TABS.map(([k, ico, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><span aria-hidden="true">{ico}</span> {l}</button>)}
      </nav>

      {glErr && <div className="error-banner" role="alert">{glErr} You can still capture photos and reconstruct on the server, and open the finished model on a device with 3D graphics.</div>}
      {loadErr && <div className="error-banner" role="alert">{loadErr}</div>}
      {loading && <div className="ss-loading" role="status"><span className="ss-spin" aria-hidden="true" />{loading}</div>}

      <div className={`ss-body ${wide ? 'wide' : ''} ${side ? '' : 'noside'}`}>
        <aside className="ss-left" aria-label="Tools">{wide ? null : panel}</aside>
        <main className="ss-main">
          {wide && <div className="ss-wide">{panel}</div>}
          <Viewport ref={vp} hidden={wide} onEngine={setEng} onFail={setGlErr}>
            {eng && !stats.parts && !wide && !loading && <div className="ss-empty"><p>No model yet</p><button type="button" className="btn-primary" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => setTab('capture')}>Capture or import one</button></div>}
            {eng && measurements.length > 0 && tab === 'measure' && <div className="ss-hud">{measurements.slice(-3).map((m) => <span key={m.id}>{m.mode === 'distance' ? formatLength(m.metres, unit) : `${m.degrees.toFixed(1)}°`}</span>)}</div>}
            {ex.active !== 'original' && <div className="ss-badge">Variant: {ex.variants.find((v) => v.id === ex.active)?.name}</div>}
          </Viewport>
        </main>
        {!wide && (
          <aside className="ss-right" aria-label="Properties and assistant">
            <section className="ss-props"><h4>Properties</h4>{sel1 ? (<><p><b>{sel1.name}</b></p><p className="ss-help">{sel1.object.isPoints ? 'Point cloud' : `${fmtNum(sel1.object.geometry.index ? sel1.object.geometry.index.count / 3 : sel1.object.geometry.getAttribute('position').count / 3)} triangles`}{sel1.locked ? ' · locked' : ''}{sel1.group ? ` · ${sel1.group}` : ''}</p>{selected.size > 1 && <p className="ss-help">+{selected.size - 1} more selected</p>}</>) : <p className="ss-help">Click a part to see its details.</p>}</section>
            <Assistant run={runAssistant} names={names} />
          </aside>
        )}
      </div>

      <footer className="ss-timeline" aria-label="Capture, processing and history">
        <div className="ss-tl-frames">{frames.slice(0, 40).map((f) => <img key={f.id} src={f.url} alt="" className={f.keep ? '' : 'off'} />)}{!frames.length && <span className="ss-help">Captured photos appear here</span>}</div>
        {job && <div className="ss-tl-job"><span>{lastJobActive ? '⏳' : job.status === 'done' ? '✅' : '⚠'} {job.stageLabel}</span><progress value={job.progress} max="100" aria-label="Job progress" /></div>}
        <div className="ss-tl-hist">{hist.slice(-8).map((h, i) => <em key={i}>{h}</em>)}</div>
      </footer>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ entry
export default function ScanStudio() {
  const [openId, setOpenId] = useState(null);
  return openId ? <Studio key={openId} openId={openId} onHome={() => setOpenId(null)} /> : <ProjectHome onOpen={setOpenId} />;
}
