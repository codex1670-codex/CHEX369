import { useEffect, useMemo, useState } from 'react';
import { MATERIAL_PRESETS } from './engine.js';
import { setReport } from './capture.js';
import { NumInput, Slider, Section, Btn, Primary, Confirm, round, fmtNum } from './ui.jsx';

// ===================================================================================== RECONSTRUCT
function Elapsed({ since, active }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!active) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [active]);
  const sec = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
  return <span>{Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}</span>;
}

export function ReconstructTab({ ctx }) {
  const { caps, frames, job, upload, startJob, cancelJob, retryJob, adoptJobResult, projectHasModel, stats, setSequential, sequential, speed, setSpeed } = ctx;
  const report = useMemo(() => setReport(frames), [frames]);
  const used = frames.filter((f) => f.keep);
  const active = job && ['queued', 'running'].includes(job.status);
  const stages = caps?.stages || [];
  const idx = stages.findIndex((s) => s.key === job?.stage);
  const photo = caps?.providers?.photogrammetry; const single = caps?.providers?.singleImage;
  const canPhoto = used.length >= (caps?.limits?.minPhotogrammetryImages || 8) && photo?.available && !projectHasModel && !active;
  const canSingle = used.length === 1 && single?.available && !projectHasModel && !active;

  return (
    <div className="ss-recon">
      <div className="ss-grid2">
        <Section title="1 · Engine" hint="Heavy reconstruction runs on the CHEX server, never in your browser.">
          <div className={`ss-engine ${photo?.available ? 'ok' : 'no'}`}>
            <b>Photogrammetry (COLMAP)</b>
            <span>{photo ? (photo.available ? '✅ Available' : '⛔ Not available on this server') : 'Checking…'}</span>
            <small>{photo?.available ? photo.output : photo?.needs}</small>
          </div>
          <div className={`ss-engine ${single?.available ? 'ok' : 'no'}`}>
            <b>Single-photo AI (estimated)</b>
            <span>{single ? (single.available ? '✅ Available' : '⛔ Not available on this server') : 'Checking…'}</span>
            <small>{single?.available ? single.output : single?.needs}</small>
          </div>
          <label className="sim-color"><span>One-photo speed</span>
            <select value={speed} onChange={(e) => setSpeed(e.target.value)} aria-label="One-photo speed">
              <option value="fast">⚡ Fast (plain colours)</option><option value="fastest">🚀 Fastest (shape only)</option><option value="quality">✨ Best quality (slower, PBR)</option>
            </select></label>
          <label className="sim-check"><input type="checkbox" checked={sequential} onChange={(e) => setSequential(e.target.checked)} /> Photos are video frames in order (faster matching)</label>
        </Section>

        <Section title="2 · Your photos" hint="Go back to Capture to add, remove or reorder.">
          <p><b>{used.length}</b> photo(s) selected {report.warnings.length === 0 && used.length > 0 ? '· no problems found' : ''}</p>
          {report.warnings.map((w) => <p key={w} className="ss-warn">⚠ {w}</p>)}
          {projectHasModel && <p className="ss-note">This project already has a model; start a new project to reconstruct another.</p>}
          <div className="ss-row">
            <Primary disabled={!canPhoto} onClick={() => startJob('photogrammetry')}>Reconstruct from {used.length} photos</Primary>
            <Btn disabled={!canSingle} onClick={() => startJob('single-image')}>Estimate from 1 photo</Btn>
          </div>
          {!photo?.available && used.length > 1 && <p className="ss-help">Photogrammetry needs COLMAP installed on the server. Your photos stay in your browser until a provider is available.</p>}
          {upload > 0 && upload < 1 && <progress value={upload} max="1" aria-label="Uploading photos" />}
        </Section>
      </div>

      <Section title="3 · Processing">
        {!job && <p className="ss-help">Nothing running. Upload photos to start — each stage below reports real progress from the server.</p>}
        {job && (
          <>
            <ol className="ss-stages" aria-label="Reconstruction stages">
              {stages.map((s, i) => {
                const st = !job ? 'pending' : job.status === 'done' ? 'done' : i < idx ? 'done' : i === idx ? (job.status === 'failed' ? 'error' : job.status === 'cancelled' ? 'stopped' : 'active') : 'pending';
                return <li key={s.key} className={`st-${st}`}><span className="dot" aria-hidden="true">{st === 'done' ? '✓' : st === 'error' ? '!' : i + 1}</span><span>{s.label}</span>{st === 'active' && <em>{job.message}</em>}</li>;
              })}
            </ol>
            <div className="ss-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={job.progress} aria-label="Reconstruction progress"><i style={{ width: `${job.progress}%` }} /><span>{job.progress}% · {job.status}</span></div>
            {active && <p className="ss-help" role="status">⏱ Running for <Elapsed since={job.createdAt} active={active} />{job.progress >= 90 ? ' — the AI provider holds at the last few percent while it finishes the file; this is normal and the model opens by itself when it is ready.' : ''}</p>}
            {job.status === 'failed' && <div className="error-banner" role="alert">{job.error || 'The job failed.'}</div>}
            <div className="ss-row">
              {active && <Btn onClick={cancelJob}>Cancel job</Btn>}
              {['failed', 'cancelled'].includes(job.status) && <Btn onClick={retryJob}>↻ Retry</Btn>}
              {job.status === 'done' && !projectHasModel && <Primary onClick={() => adoptJobResult(job)}>Open result in the 3D Studio</Primary>}
            </div>
          </>
        )}
      </Section>

      <Section title="4 · Quality report">
        {job?.status === 'done' ? (
          <ul className="ss-list">
            <li><b>Result type:</b> {job.resultKind === 'mesh' ? 'Mesh with vertex colours' : job.resultKind === 'point-cloud' ? 'Point cloud (no surface yet)' : job.resultKind === 'ai-estimated' ? 'AI-estimated model' : job.resultKind}</li>
            <li><b>Input:</b> {job.inputCount} image(s)</li>
            {job.note && <li className="ss-warn">ℹ {job.note}</li>}
            {stats && stats.parts > 0 && <li><b>In studio:</b> {fmtNum(stats.triangles)} triangles · {fmtNum(stats.vertices + stats.points)} vertices/points</li>}
            <li className="ss-help">Texture projection, hole repair and scale are not done by the server: real-world scale must be set with Measure ▸ Calibrate, and holes show as gaps.</li>
          </ul>
        ) : <p className="ss-help">The report appears when a job finishes: what kind of result you got, its size, and what the pipeline could not do.</p>}
      </Section>
    </div>
  );
}

// ===================================================================================== PARTS
export function PartsTab({ ctx }) {
  const { eng, parts, selected, saveNow, notify } = ctx;
  const [confirmDel, setConfirmDel] = useState(false); const [groupName, setGroupName] = useState(''); const [renaming, setRenaming] = useState(null); const [draft, setDraft] = useState('');
  const live = parts.filter((p) => !p.deleted); const sel = [...selected];
  const groups = useMemo(() => { const m = new Map(); for (const p of live) { const k = p.group || ''; (m.get(k) || m.set(k, []).get(k)).push(p); } return [...m.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0]))); }, [live]);
  const pick = (id, e) => eng.select([id], e.shiftKey || e.ctrlKey || e.metaKey);
  const run = (fn) => { try { return fn(); } catch (e) { notify(e.message); return null; } };
  const split = () => { const n = run(() => eng.split(sel[0])); if (n === 0) notify('This part is one connected piece, so it cannot be separated automatically. Use Group, or edit the source model.'); else if (n) notify(`Separated into ${n} parts.`); };
  return (
    <div className="ss-tool">
      <Section title="Parts" hint="Click to select (Shift/Ctrl for several). Parts come from the model’s own structure and from pieces that are not physically connected — no AI segmentation model is connected yet, so use Group and Rename to correct anything it gets wrong.">
        <div className="ss-row">
          <Btn onClick={() => eng.select(live.map((p) => p.id))}>Select all</Btn><Btn onClick={() => eng.select([])}>None</Btn>
          <Btn onClick={() => live.forEach((p) => !p.visible && eng.setVisible(p.id, true))}>Show all</Btn>
        </div>
        <div className="ss-tree" role="listbox" aria-multiselectable="true" aria-label="Model parts">
          {groups.map(([g, ps]) => (
            <div key={g || '_'} className="ss-group">
              {g && <div className="ss-group-h">📁 {g} <small>({ps.length})</small></div>}
              {ps.map((p) => (
                <div key={p.id} role="option" aria-selected={selected.has(p.id)} className={`ss-part ${selected.has(p.id) ? 'on' : ''} ${p.visible ? '' : 'dim'}`} onClick={(e) => pick(p.id, e)}>
                  <button type="button" aria-label={p.visible ? `Hide ${p.name}` : `Show ${p.name}`} onClick={(e) => { e.stopPropagation(); eng.setVisible(p.id, !p.visible); }}>{p.visible ? '👁' : '🚫'}</button>
                  <button type="button" aria-label={p.locked ? `Unlock ${p.name}` : `Lock ${p.name}`} onClick={(e) => { e.stopPropagation(); eng.setLocked(p.id, !p.locked); }}>{p.locked ? '🔒' : '🔓'}</button>
                  {renaming === p.id
                    ? <input autoFocus className="ss-rename" value={draft} aria-label="Part name" onClick={(e) => e.stopPropagation()} onChange={(e) => setDraft(e.target.value)} onBlur={() => { eng.rename(p.id, draft); setRenaming(null); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); }} />
                    : <span className="ss-part-name" onDoubleClick={() => { setRenaming(p.id); setDraft(p.name); }} title="Double-click to rename">{p.name}</span>}
                  <small>{p.kind === 'points' ? 'points' : `${fmtNum(p.tris)} △`}</small>
                </div>
              ))}
            </div>
          ))}
          {!live.length && <p className="ss-help">No model yet. Capture or import one first.</p>}
        </div>
      </Section>

      <Section title="Edit selection" hint={sel.length ? `${sel.length} selected` : 'Select a part first.'}>
        <div className="ss-row">
          <Btn disabled={sel.length !== 1} onClick={() => { const p = live.find((x) => x.id === sel[0]); setRenaming(sel[0]); setDraft(p?.name || ''); }}>✏️ Rename</Btn>
          <Btn disabled={!sel.length} onClick={() => eng.duplicate(sel)}>⧉ Duplicate</Btn>
          <Btn disabled={!sel.length} onClick={() => setConfirmDel(true)}>🗑 Delete</Btn>
          <Btn disabled={sel.length !== 1} onClick={split}>✂ Separate pieces</Btn>
        </div>
        {confirmDel && <Confirm text={`Delete ${sel.length} part(s)? You can undo this, and the original model file is never changed.`} yes="Delete" onYes={() => { eng.remove(sel); setConfirmDel(false); }} onNo={() => setConfirmDel(false)} />}
        <div className="ss-row">
          <input className="ss-text" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name (e.g. Legs)" aria-label="Group name" maxLength={40} />
          <Btn disabled={sel.length < 1 || !groupName.trim()} onClick={() => { eng.setGroup(sel, groupName.trim()); setGroupName(''); }}>Group</Btn>
          <Btn disabled={!sel.length} onClick={() => eng.setGroup(sel, null)}>Ungroup</Btn>
        </div>
        <Primary onClick={() => saveNow(true)}>💾 Save part hierarchy</Primary>
      </Section>
    </div>
  );
}

// ===================================================================================== EDIT
const GEOMETRY_TODO = ['Extrude and inset', 'Boolean operations (union / subtract)', 'Smooth (curvature-preserving) subdivision', 'Automatic hole filling'];

export function EditTab({ ctx }) {
  const { eng, selected, tick, notify } = ctx;
  const p = eng.primary?.(); const [uni, setUni] = useState(true); const [ratio, setRatio] = useState(0.5); const [busy, setBusy] = useState(''); const [gizmo, setGizmoState] = useState(null);
  const [snap, setSnap] = useState({ on: false, move: 0.05, rotate: 15, scale: 0.1 });
  const t = p ? eng.transformOf(p) : null; const m = p ? eng.materialOf(p) : null; const locked = !p || p.locked;
  const setG = (g) => { const next = gizmo === g ? null : g; setGizmoState(next); eng.setGizmo(next); };
  useEffect(() => () => eng.setGizmo(null), [eng]);
  const upSnap = (o) => { const n = { ...snap, ...o }; setSnap(n); eng.setSnap(n); };
  const axisRow = (label, key, step, min, max) => (
    <div className="ss-axes"><span>{label}</span>{[0, 1, 2].map((i) => (
      <NumInput key={`${key}${i}${tick}`} label={`${label} ${'XYZ'[i]}`} step={step} min={min} max={max} disabled={locked} value={t[key][i]}
        onCommit={(v) => { const next = [...t[key]]; if (key === 'scale' && uni) { const f = t.scale[i] ? v / t.scale[i] : 1; eng.setTransform(p.id, { scale: t.scale.map((s) => s * f) }, 'scale'); return; } next[i] = v; eng.setTransform(p.id, { [key]: next }, key); }} />
    ))}</div>
  );
  const geo = async (name, fn) => { setBusy(name); try { await fn(); notify(`${name} done. Undo (Ctrl+Z) reverts it.`); } catch (e) { notify(e.message); } finally { setBusy(''); } };

  return (
    <div className="ss-tool">
      {!p && <p className="ss-note">Select a part in the viewport or the Parts tab to edit it.</p>}
      {p?.locked && <p className="ss-note">🔒 “{p.name}” is locked. Unlock it in Parts to edit.</p>}
      <Section title="Transform" hint={p ? `Editing “${p.name}”` : undefined}>
        <div className="ss-row">
          {[['translate', '✥ Move'], ['rotate', '⟳ Rotate'], ['scale', '⤡ Scale']].map(([g, l]) => <Btn key={g} className={`btn-ghost ss-btn ${gizmo === g ? 'on' : ''}`} aria-pressed={gizmo === g} disabled={locked} onClick={() => setG(g)}>{l}</Btn>)}
        </div>
        <label className="sim-check"><input type="checkbox" checked={snap.on} onChange={(e) => upSnap({ on: e.target.checked })} /> Snap to grid ({snap.move} · {snap.rotate}° · {snap.scale})</label>
        {t && (<>
          {axisRow('Move', 'pos', 0.01)}{axisRow('Rotate°', 'rot', 1, -360, 360)}{axisRow('Scale', 'scale', 0.01, 0.0001)}
          <label className="sim-check"><input type="checkbox" checked={uni} onChange={(e) => setUni(e.target.checked)} /> Scale uniformly</label>
          <Btn disabled={locked} onClick={() => eng.resetTransform(p.id)}>↺ Reset transform</Btn>
        </>)}
      </Section>

      <Section title="Appearance" hint="Changes only this part. The model’s original materials stay available as “Original”.">
        {m ? (<>
          <label className="sim-color"><span>Colour</span><input type="color" value={m.color} disabled={locked} onChange={(e) => eng.setMaterial(p.id, { color: e.target.value })} aria-label="Part colour" /></label>
          <label className="sim-color"><span>Material</span>
            <select value={m.preset} disabled={locked} onChange={(e) => eng.applyPreset(p.id, e.target.value)} aria-label="Material preset">{Object.keys(MATERIAL_PRESETS).map((k) => <option key={k}>{k}</option>)}</select></label>
          <Slider label="Metallic" value={m.metalness} min={0} max={1} disabled={locked} onChange={(v) => eng.setMaterial(p.id, { metalness: v })} />
          <Slider label="Roughness" value={m.roughness} min={0} max={1} disabled={locked} onChange={(v) => eng.setMaterial(p.id, { roughness: v })} />
          <Slider label="Transparency" value={1 - m.opacity} min={0} max={0.95} disabled={locked} onChange={(v) => eng.setMaterial(p.id, { opacity: 1 - v })} />
          <label className="sim-color"><span>Replace texture</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={locked} aria-label="Replace texture" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { try { await eng.replaceTexture(p.id, f); } catch (er) { notify(er.message); } } }} /></label>
          {m.hasMap && (<>
            <Slider label="Texture scale" value={m.repeat} min={0.1} max={10} step={0.1} disabled={locked} onChange={(v) => eng.setTextureTransform(p.id, { repeat: v })} />
            <Slider label="Texture rotation" value={m.rotation} min={-180} max={180} step={1} digits={0} unit="°" disabled={locked} onChange={(v) => eng.setTextureTransform(p.id, { rotationDeg: v })} />
          </>)}
        </>) : <p className="ss-help">Point clouds have no material.</p>}
      </Section>

      <Section title="Geometry" hint="These change the working model’s mesh. Each is undoable, and the original model is stored untouched on the server.">
        <div className="ss-row">
          <Btn disabled={locked || !!busy} onClick={() => geo('Smooth', () => eng.smooth(p.id, 2))}>Smooth</Btn>
          <Btn disabled={locked || !!busy} onClick={() => geo('Subdivide', () => eng.subdivide(p.id))}>Subdivide (flat)</Btn>
          <Btn disabled={locked || !!busy} onClick={() => geo('Repair', () => { const r = eng.repair(p.id); notify(r.closed ? 'Mesh is now watertight.' : `Merged duplicate vertices. ${r.boundaryEdges} open edge(s) remain — holes are not filled automatically.`); })}>Repair</Btn>
        </div>
        <Slider label="Keep triangles" value={ratio} min={0.1} max={0.9} step={0.05} digits={2} onChange={setRatio} />
        <Btn disabled={locked || !!busy} onClick={() => geo('Simplify', () => eng.simplify(p.id, ratio))}>{busy === 'Simplify' ? 'Simplifying…' : `Simplify to ${Math.round(ratio * 100)}%`}</Btn>
        <details className="ss-todo"><summary>Not available in this build</summary><ul>{GEOMETRY_TODO.map((g) => <li key={g}>{g}</li>)}</ul></details>
      </Section>
    </div>
  );
}
