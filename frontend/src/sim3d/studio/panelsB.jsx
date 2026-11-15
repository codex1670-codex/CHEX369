import { useEffect, useState } from 'react';
import { UNIT_NAMES, formatLength, formatArea, formatVolume, toMetres } from './studioMath.js';
import { Slider, Section, Btn, Primary, Confirm, fmtBytes, fmtNum } from './ui.jsx';

// ===================================================================================== WHAT-IF LAB
export function WhatIfTab({ ctx }) {
  const { eng, wi, unit, notify } = ctx; const [name, setName] = useState(''); const [cmp, setCmp] = useState(null); const [del, setDel] = useState(null); const [restoreOrig, setRestoreOrig] = useState(false);
  const list = [{ id: 'original', name: 'Original (locked)', original: true }, ...wi.variants];
  const metrics = (state) => eng.withState(state, () => { const a = eng.analyse(); const s = eng.size(); return { tris: a.triangles, size: s, area: a.areaM2, volume: a.volumeM3 }; });
  const compare = (id) => {
    const base = wi.baseState; const v = wi.variants.find((x) => x.id === id); if (!base || !v) return;
    setCmp({ id, a: metrics(base), b: metrics(v.id === wi.active ? eng.captureState() : v.state), name: v.name });
  };
  const changed = (id) => { const v = wi.variants.find((x) => x.id === id); if (!v || !wi.baseState) return 0; const a = new Map(wi.baseState.parts.map((p) => [p.id, JSON.stringify(p)])); return v.state.parts.filter((p) => a.get(p.id) !== JSON.stringify(p)).length; };
  return (
    <div className="ss-tool">
      <Section title="Design variants" hint="Every variant is an independent copy of positions, sizes, materials and names. The original can never be edited — change anything while it is showing and a new variant is started for you.">
        <div className="ss-row"><input className="ss-text" value={name} onChange={(e) => setName(e.target.value)} placeholder="New variant name" aria-label="Variant name" maxLength={40} />
          <Primary disabled={!wi.baseState} onClick={() => { wi.create(name.trim() || undefined); setName(''); }}>＋ From current</Primary></div>
        <ul className="ss-variants">
          {list.map((v) => (
            <li key={v.id} className={wi.active === v.id ? 'on' : ''}>
              <button type="button" className="ss-var-main" onClick={() => wi.switchTo(v.id)} aria-pressed={wi.active === v.id}>{wi.active === v.id ? '● ' : '○ '}{v.name}{!v.original && <small> · {changed(v.id)} part(s) changed</small>}</button>
              {!v.original && <><Btn aria-label={`Compare ${v.name} with original`} onClick={() => compare(v.id)}>Compare</Btn><Btn aria-label={`Delete ${v.name}`} onClick={() => setDel(v.id)}>🗑</Btn></>}
            </li>
          ))}
        </ul>
        {del && <Confirm text="Delete this variant? Other variants and the original are not affected." yes="Delete" onYes={() => { wi.remove(del); setDel(null); }} onNo={() => setDel(null)} />}
      </Section>

      {cmp && (
        <Section title={`Before / after — ${cmp.name}`}>
          <table className="ss-table"><thead><tr><th /><th>Original</th><th>{cmp.name}</th></tr></thead><tbody>
            <tr><td>Width × Height × Depth</td><td>{['x', 'y', 'z'].map((k) => formatLength(cmp.a.size[k], unit)).join(' × ')}</td><td>{['x', 'y', 'z'].map((k) => formatLength(cmp.b.size[k], unit)).join(' × ')}</td></tr>
            <tr><td>Triangles</td><td>{fmtNum(cmp.a.tris)}</td><td>{fmtNum(cmp.b.tris)}</td></tr>
            <tr><td>Surface area</td><td>{formatArea(cmp.a.area, unit)}</td><td>{formatArea(cmp.b.area, unit)}</td></tr>
            <tr><td>Volume</td><td>{cmp.a.volume == null ? 'open mesh' : formatVolume(cmp.a.volume, unit)}</td><td>{cmp.b.volume == null ? 'open mesh' : formatVolume(cmp.b.volume, unit)}</td></tr>
          </tbody></table>
          <div className="ss-row"><Btn onMouseDown={() => wi.peek('original')} onMouseUp={() => wi.peek(null)} onMouseLeave={() => wi.peek(null)} onTouchStart={() => wi.peek('original')} onTouchEnd={() => wi.peek(null)}>👁 Hold to see the original</Btn><Btn onClick={() => setCmp(null)}>Close</Btn></div>
          <p className="ss-help">Measures are for the visible parts; volumes only exist for closed (watertight) meshes.</p>
        </Section>
      )}

      <Section title="Version history" hint="Snapshots of positions, materials and names you can return to. They do not store mesh edits — those are undone with Undo, or reverted with “Restore original geometry”.">
        <Btn onClick={() => wi.saveVersion()}>＋ Save a version now</Btn>
        <ul className="ss-versions">{[...wi.versions].reverse().map((v) => <li key={v.id}><span>{v.label}<small> · {new Date(v.at).toLocaleString()}</small></span><Btn onClick={() => wi.restoreVersion(v.id)}>Restore</Btn></li>)}{!wi.versions.length && <li className="ss-help">No versions yet.</li>}</ul>
        <Btn disabled={!wi.hasOriginal} onClick={() => setRestoreOrig(true)}>⏪ Restore original geometry</Btn>
        {restoreOrig && <Confirm text="Reload the original model as first captured? Mesh edits since then (smooth, simplify, splits) are discarded; variants that refer to parts which no longer exist ignore them." yes="Restore" onYes={() => { setRestoreOrig(false); wi.restoreOriginal().catch((e) => notify(e.message)); }} onNo={() => setRestoreOrig(false)} />}
      </Section>
    </div>
  );
}

// ===================================================================================== SIMULATE
const SIM_SECTIONS = [['physics', '⬇️ Physics'], ['joints', '🔩 Joints'], ['timeline', '🎞️ Timeline'], ['materials', '🎨 Materials'], ['structure', '🏗️ Balance']];
const COMPARE_PRESETS = ['Original', 'Plastic', 'Matte', 'Metal', 'Brushed', 'Glass', 'Wood', 'Rubber'];
const EASE_LABEL = { linear: 'Linear', smooth: 'Smooth', in: 'Ease in', out: 'Ease out' };
const PUSH_DIRS = [['← Left', [-1, 0, 0]], ['→ Right', [1, 0, 0]], ['↑ Up', [0, 1, 0]], ['↗ Forward', [0, 0.15, -1]], ['↙ Back', [0, 0.15, 1]]];

export function SimulateTab({ ctx }) {
  const { eng, selected, notify, unit } = ctx; const [view, setView] = useState('physics');
  // physics
  const [sim, setSim] = useState(null); const [stats, setStats] = useState({ t: 0, moving: 0, total: 0 });
  const [gravity, setGravity] = useState(9.81); const [rest, setRest] = useState(0.25); const [grip, setGrip] = useState(0.9); const [speed, setSpeed] = useState(1);
  const [fixedSel, setFixedSel] = useState(true); const [autoPause, setAutoPause] = useState(true); const [boxes, setBoxes] = useState(false);
  const [push, setPush] = useState(2); const [poke, setPoke] = useState(false);
  // joints / timeline
  const [axis, setAxis] = useState('y'); const [amp, setAmp] = useState(60); const [slideAxis, setSlideAxis] = useState('x'); const [slidePct, setSlidePct] = useState(60); const [ballDeg, setBallDeg] = useState(20);
  const [anim, setAnim] = useState({ playing: false, t: 0, keys: {}, duration: 4, loop: true, speed: 1, easing: 'linear' }); const [t, setT] = useState(0);
  // materials / structure
  const [sheet, setSheet] = useState(null); const [sheetBusy, setSheetBusy] = useState(false); const [mp, setMp] = useState(null);
  const [rep, setRep] = useState(null); const [showCom, setShowCom] = useState(true); const [showLoads, setShowLoads] = useState(true);

  useEffect(() => eng.on((e, d) => {
    if (e === 'sim') setSim((s) => (d.stopped ? null : { ...(s || {}), ...d, settled: !!d.settled }));
    if (e === 'sim-stats' && d) setStats(d);
    if (e === 'anim') setAnim({ ...d }); if (e === 'anim-time') setT(d);
    if (e === 'matpreview') setMp(d);
  }), [eng]);
  useEffect(() => () => { eng.stopSim(); eng.clearStructure(); eng.revertMaterialPreview(); eng.setPoke(false); }, [eng]);

  const sel = [...selected]; const p = sel[0] ? eng.part(sel[0]) : null; const keyCount = sel[0] ? (anim.keys[sel[0]] || []).length : 0;
  const run = (fn) => { try { return fn(); } catch (e) { notify(e.message); return undefined; } };
  const start = () => run(() => { setStats({ t: 0, moving: 0, total: 0 }); eng.startSim({ fixedIds: fixedSel ? sel : [], restitution: rest, gravity: -gravity, friction: grip, timeScale: speed, autoPause }); eng.showBoxes(boxes); eng.setPoke(poke, push); });
  const nudgeSel = (dir) => {
    if (!sel.length) { notify('Select the part you want to push.'); return; }
    let moved = 0; let firstErr = '';
    sel.forEach((id) => { try { eng.nudge(id, dir, push); moved++; } catch (e) { firstErr ||= e.message; } });
    if (!moved) notify(firstErr);
  };

  const keys = Object.entries(anim.keys).flatMap(([id, list]) => list.map((k, index) => ({ id, index, t: k.t, name: eng.part(id)?.name || 'Part' }))).sort((a, b) => a.t - b.t);
  const runSheet = () => { setSheetBusy(true); setTimeout(() => { try { setSheet(eng.materialSheet(COMPARE_PRESETS, sel)); } catch (e) { notify(e.message || 'Could not render the comparison.'); } finally { setSheetBusy(false); } }, 30); };
  const analyse = (com = showCom, loads = showLoads) => run(() => setRep(eng.showStructure({ com, loads }, true)));
  const clearStructure = () => { eng.clearStructure(); setRep(null); };

  return (
    <div className="ss-tool">
      <p className="ss-note" role="note">⚠ Simplified visual preview only: each part is treated as a box of the same solid material. It is <b>not</b> an engineering, structural or safety analysis and must not be used to judge whether a design is safe.</p>
      <div className="ss-seg" role="tablist" aria-label="Simulation tools">{SIM_SECTIONS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{label}</button>)}</div>

      {view === 'physics' && <>
        <Section title="Gravity & collisions" hint="Parts drop onto the ground and bump into each other. Select a part and tick “Keep selected fixed” to use it as a table or base, then press Set up.">
          <Slider label="Gravity (m/s²)" value={gravity} min={0} max={25} step={0.1} digits={1} onChange={(v) => { setGravity(v); eng.updateSim({ gravity: v }); }} />
          <Slider label="Bounciness" value={rest} min={0} max={0.9} onChange={(v) => { setRest(v); eng.updateSim({ restitution: v }); }} />
          <Slider label="Ground grip" value={grip} min={0.5} max={0.99} onChange={(v) => { setGrip(v); eng.updateSim({ friction: v }); }} />
          <Slider label="Speed" value={speed} min={0.1} max={2} step={0.05} unit="×" onChange={(v) => { setSpeed(v); eng.updateSim({ timeScale: v }); }} />
          <label className="sim-check"><input type="checkbox" checked={fixedSel} onChange={(e) => setFixedSel(e.target.checked)} /> Keep selected part(s) fixed</label>
          <label className="sim-check"><input type="checkbox" checked={autoPause} onChange={(e) => { setAutoPause(e.target.checked); eng.updateSim({ autoPause: e.target.checked }); }} /> Pause automatically when everything has settled</label>
          <label className="sim-check"><input type="checkbox" checked={boxes} onChange={(e) => { setBoxes(e.target.checked); eng.showBoxes(e.target.checked); }} /> Show the collision boxes</label>
          <div className="ss-row">
            {!sim ? <Primary onClick={start}>Set up</Primary> : <>
              <Primary onClick={() => eng.playSim(!sim.playing)}>{sim.playing ? '⏸ Pause' : '▶ Play'}</Primary>
              <Btn onClick={() => eng.resetSim()}>↺ Reset</Btn><Btn onClick={() => eng.stopSim()}>Stop</Btn></>}
          </div>
          {sim && <p className="ss-help sim-status" role="status">{sim.settled ? '✔ Everything has settled.' : sim.playing ? 'Running…' : 'Paused.'} {stats.t.toFixed(1)} s · {stats.moving} of {stats.total} part(s) still moving</p>}
        </Section>
        <Section title="Push & poke" hint="Give a part a shove to see how it reacts. Directions are along the model’s own axes (Forward = away from the default front view).">
          <Slider label="Push strength (speed change)" value={push} min={0.5} max={8} step={0.1} digits={1} unit=" m/s" onChange={(v) => { setPush(v); eng.setPoke(poke, v); }} />
          <div className="ss-row">{PUSH_DIRS.map(([label, dir]) => <Btn key={label} disabled={!sim || !sel.length} onClick={() => nudgeSel(dir)}>{label}</Btn>)}</div>
          <label className="sim-check"><input type="checkbox" checked={poke} disabled={!sim} onChange={(e) => { setPoke(e.target.checked); eng.setPoke(e.target.checked, push); }} /> Poke mode — click a part in the viewport to push it away from you</label>
          {!sim && <p className="ss-help">Press “Set up” first. {!sel.length && 'Select a part to push with the buttons.'}</p>}
        </Section>
      </>}

      {view === 'joints' && <Section title="Joint demos" hint={p ? `Moves “${p.name}” on its own — each demo returns the part to where it was when you stop.` : 'Select a part in the viewport or the Parts list first.'}>
        <h5 className="ss-sub">Hinge — a door or lid</h5>
        <div className="ss-row"><select value={axis} onChange={(e) => setAxis(e.target.value)} aria-label="Hinge axis"><option value="y">Vertical hinge (door)</option><option value="x">Horizontal hinge (lid)</option><option value="z">Front-back hinge</option></select></div>
        <Slider label="Swing" value={amp} min={10} max={120} step={1} digits={0} unit="°" onChange={setAmp} />
        <div className="ss-row"><Btn disabled={!p} onClick={() => run(() => eng.startHinge(sel[0], axis, amp))}>▶ Swing “{p?.name || '—'}”</Btn></div>
        <h5 className="ss-sub">Slider — a drawer or sliding panel</h5>
        <div className="ss-row"><select value={slideAxis} onChange={(e) => setSlideAxis(e.target.value)} aria-label="Slide direction"><option value="x">Left–right (X)</option><option value="y">Up–down (Y)</option><option value="z">Front–back (Z)</option></select></div>
        <Slider label="Travel (of the part’s size)" value={slidePct} min={10} max={100} step={1} digits={0} unit="%" onChange={setSlidePct} />
        <div className="ss-row"><Btn disabled={!p} onClick={() => run(() => eng.startJoint(sel[0], 'slider', slideAxis, slidePct))}>▶ Slide “{p?.name || '—'}”</Btn></div>
        <h5 className="ss-sub">Ball joint — a joystick or lamp head</h5>
        <Slider label="Tilt" value={ballDeg} min={5} max={45} step={1} digits={0} unit="°" onChange={setBallDeg} />
        <div className="ss-row"><Btn disabled={!p} onClick={() => run(() => eng.startJoint(sel[0], 'ball', 'y', ballDeg))}>▶ Wobble “{p?.name || '—'}” from its base</Btn>
          <Btn onClick={() => { eng.stopAnim(); setT(0); }}>■ Stop</Btn></div>
        <p className="ss-help">These are motion demos: the joint has no limits, friction or strength, and the rest of the model does not react.</p>
      </Section>}

      {view === 'timeline' && <Section title="Animation timeline" hint="Pose the selected part, set a key at that time, move on and repeat. Select several parts to key them together.">
        <Slider label="Length" value={anim.duration} min={1} max={30} step={1} digits={0} unit=" s" onChange={(v) => eng.setAnimOptions({ duration: v })} />
        <Slider label="Playback speed" value={anim.speed} min={0.25} max={3} step={0.25} unit="×" onChange={(v) => eng.setAnimOptions({ speed: v })} />
        <div className="ss-row">
          <select value={anim.easing} onChange={(e) => eng.setAnimOptions({ easing: e.target.value })} aria-label="Motion easing">{Object.entries(EASE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <label className="sim-check"><input type="checkbox" checked={anim.loop} onChange={(e) => eng.setAnimOptions({ loop: e.target.checked })} /> Loop</label>
        </div>
        <Slider label="Time" value={Math.min(t, anim.duration)} min={0} max={anim.duration} step={0.05} unit=" s" onChange={(v) => { setT(v); eng.setAnimTime(v); }} />
        <div className="ss-row">
          <Btn disabled={!sel.length} onClick={() => sel.forEach((id) => eng.setKey(id, t))}>◆ Set key at {t.toFixed(1)} s{sel.length > 1 ? ` (${sel.length} parts)` : ''}</Btn>
          <Btn disabled={!keyCount} onClick={() => sel.forEach((id) => eng.clearKeys(id))}>Clear keys</Btn>
          <Primary disabled={!Object.keys(anim.keys).length} onClick={() => eng.playAnim(!anim.playing)}>{anim.playing ? '⏸ Pause' : '▶ Play'}</Primary>
          <Btn onClick={() => eng.resetAnim()}>↺ Reset</Btn>
        </div>
        <ul className="ss-list sim-keys" aria-label="Keyframes">
          {keys.slice(0, 40).map((k) => <li key={`${k.id}-${k.index}`}><span>◆ {k.name} · {k.t.toFixed(1)} s</span> <button type="button" className="sim-mini" onClick={() => { setT(k.t); eng.setAnimTime(k.t); }}>Go</button> <button type="button" className="sim-mini" aria-label={`Delete key of ${k.name} at ${k.t.toFixed(1)} seconds`} onClick={() => eng.deleteKey(k.id, k.index)}>✕</button></li>)}
          {!keys.length && <li className="ss-help">No keys yet.</li>}
        </ul>
        <p className="ss-help">{Object.keys(anim.keys).length} animated part(s). Animations are previews and are not saved into exports.</p>
      </Section>}

      {view === 'materials' && <Section title="Material appearance comparison" hint={`Compare how ${sel.length ? `the ${sel.length} selected part(s)` : 'every visible part'} would look in each material, using the studio lighting. Nothing changes until you press Keep.`}>
        <div className="ss-row"><Primary disabled={sheetBusy} onClick={runSheet}>{sheetBusy ? 'Rendering…' : sheet ? '↻ Re-render comparison' : '⊞ Compare all materials'}</Primary></div>
        {sheet && <div className="sim-thumbs" role="list" aria-label="Material comparison">{sheet.map((m) => (
          <button key={m.name} type="button" role="listitem" className={`sim-thumb ${mp?.name === m.name ? 'on' : ''}`} onClick={() => run(() => eng.previewMaterial(m.name, sel))} aria-label={`Preview ${m.name}`}><img src={m.url} alt={`${m.name} material`} /><span>{m.name}</span></button>))}</div>}
        {mp && <div className="ss-confirm" role="status"><p>Previewing <b>{mp.name}</b> on {mp.count} part(s){mp.on ? '.' : ' — showing the ORIGINAL right now.'}</p>
          <div><Btn onClick={() => eng.togglePreviewCompare()}>⇄ {mp.on ? 'Show original' : 'Show preview'}</Btn><Primary onClick={() => { const n = eng.commitMaterialPreview(); notify(`Applied to ${n} part(s). Undo works.`); }}>Keep</Primary><Btn onClick={() => eng.revertMaterialPreview()}>Revert</Btn></div></div>}
        <p className="ss-help">Presets set colour, metalness, roughness and transparency; a part’s own texture is tinted by the colour. Real surfaces look different under different light, so treat this as a guide.</p>
      </Section>}

      {view === 'structure' && <Section title="Balance & load path" hint="Checks whether the model would stay upright, and shows how much weight rests on each part (blue = little, red = most). Based on bounding boxes only.">
        <label className="sim-check"><input type="checkbox" checked={showCom} onChange={(e) => { setShowCom(e.target.checked); if (rep) analyse(e.target.checked, showLoads); }} /> Show centre of mass and footprint</label>
        <label className="sim-check"><input type="checkbox" checked={showLoads} onChange={(e) => { setShowLoads(e.target.checked); if (rep) analyse(showCom, e.target.checked); }} /> Tint parts by the weight resting on them</label>
        <div className="ss-row"><Primary onClick={() => analyse()}>{rep ? '↻ Re-analyse current pose' : 'Analyse'}</Primary>{rep && <Btn onClick={clearStructure}>Clear</Btn>}</div>
        {rep && <div className="sim-report" role="status">
          <p className={rep.stable ? 'sim-ok' : 'sim-bad'}>{!rep.support ? 'Nothing touches the ground, so there is no footprint to balance on.' : rep.stable ? `✔ The centre of mass is over the footprint (${formatLength(rep.marginM, unit)} from the nearest edge). It should stand${rep.comHeightM > 0 ? `; it would start to tip at roughly ${rep.tipAngleDeg.toFixed(0)}° of tilt` : ''}.` : `✖ The centre of mass is outside the footprint by ${formatLength(Math.abs(rep.marginM), unit)} — this pose would tip over.`}</p>
          {rep.com && <p className="ss-help">Centre of mass height: {formatLength(rep.comHeightM, unit)} above the ground · {rep.support?.count || 0} part(s) touch the ground.</p>}
          <ul className="sim-loads" aria-label="Weight resting on each part">{[...rep.parts].sort((a, b) => b.rel - a.rel).slice(0, 12).map((x) => <li key={x.id}><span>{x.name}</span><i style={{ width: `${Math.max(2, Math.round(x.rel * 100))}%` }} /><b>{Math.round(x.rel * 100)}%</b></li>)}</ul>
        </div>}
        <p className="ss-help">Assumes every part is the same solid material, treats the footprint as the bounding rectangle of the parts touching the ground (optimistic for ring or three-point bases), and ignores joints and strength. Lengths are real-world only once the scale has been calibrated in Measure.</p>
      </Section>}

      <p className="ss-help">Not included: stress or deflection (needs finite-element analysis), soft bodies and cloth, and rotating (tipping) rigid bodies.</p>
    </div>
  );
}

// ===================================================================================== MEASURE
export function MeasureTab({ ctx }) {
  const { eng, unit, setUnit, measurements, setMeasurements, tick, notify } = ctx; const [mode, setMode] = useState(null); const [prog, setProg] = useState(null); const [real, setReal] = useState(''); const [calUnit, setCalUnit] = useState(unit); const [calId, setCalId] = useState('');
  useEffect(() => eng.on((e, d) => { if (e === 'measure-progress') setProg(d); if (e === 'measure') setProg(null); }), [eng]);
  useEffect(() => () => { eng.setMeasureMode(null); eng.clearMeasure(); }, [eng]);
  const start = (m) => { const next = mode === m ? null : m; setMode(next); setProg(null); eng.setMeasureMode(next); };
  const size = eng.size(); const a = eng.analyse(); const st = eng.stats();
  const dists = measurements.filter((m) => m.mode === 'distance');
  const calibrate = () => {
    const m = dists.find((x) => x.id === Number(calId)); const v = Number(real);
    if (!m || !(v > 0)) { notify('Pick a measured distance and type its real length.'); return; }
    eng.scaleToMeters = toMetres(v, calUnit) / m.raw; setMeasurements((list) => list.map((x) => (x.mode === 'distance' ? { ...x, metres: x.raw * eng.scaleToMeters } : x))); eng.emit('meta'); eng.emit('transform'); notify(`Scale set: 1 model unit = ${(eng.scaleToMeters * 1000).toFixed(3)} mm.`);
  };
  return (
    <div className="ss-tool" data-tick={tick}>
      <Section title="Units"><div className="ss-seg">{UNIT_NAMES.map((u) => <button key={u} type="button" className={unit === u ? 'on' : ''} aria-pressed={unit === u} onClick={() => setUnit(u)}>{u}</button>)}</div></Section>
      <Section title="Measure in the viewport" hint="Click points on the model. Dimensions are only real-world accurate once the scale has been calibrated below — photogrammetry has no built-in scale.">
        <div className="ss-row"><Btn className={`btn-ghost ss-btn ${mode === 'distance' ? 'on' : ''}`} onClick={() => start('distance')} aria-pressed={mode === 'distance'}>📏 Distance (2 points)</Btn><Btn className={`btn-ghost ss-btn ${mode === 'angle' ? 'on' : ''}`} onClick={() => start('angle')} aria-pressed={mode === 'angle'}>∠ Angle (3 points)</Btn></div>
        {mode && <p className="ss-help" role="status">Click point {(prog?.have || 0) + 1} of {mode === 'angle' ? 3 : 2} on the model…</p>}
        <ul className="ss-list">{measurements.map((m) => <li key={m.id}>{m.mode === 'distance' ? `📏 #${m.id}  ${formatLength(m.metres, unit)}` : `∠ #${m.id}  ${m.degrees.toFixed(1)}°`}</li>)}{!measurements.length && <li className="ss-help">No measurements yet.</li>}</ul>
        {measurements.length > 0 && <Btn onClick={() => { setMeasurements([]); eng.clearMeasure(); }}>Clear measurements</Btn>}
      </Section>
      <Section title="Calibrate scale" hint="Measure something whose true length you know (a ruler, a coin), then enter it.">
        <div className="ss-row"><select value={calId} onChange={(e) => setCalId(e.target.value)} aria-label="Measured distance to calibrate"><option value="">Choose a distance…</option>{dists.map((m) => <option key={m.id} value={m.id}>#{m.id} — {formatLength(m.metres, unit)}</option>)}</select>
          <input className="ss-num" type="number" min="0" step="any" value={real} onChange={(e) => setReal(e.target.value)} aria-label="Real length" placeholder="Real length" />
          <select value={calUnit} onChange={(e) => setCalUnit(e.target.value)} aria-label="Unit of the real length">{UNIT_NAMES.map((u) => <option key={u}>{u}</option>)}</select>
          <Btn onClick={calibrate}>Apply</Btn></div>
      </Section>
      <Section title="Dimensions & analysis" hint="Of the visible parts. Bounding-box size is exact for the model; area and volume are estimates from the mesh.">
        <table className="ss-table"><tbody>
          <tr><td>Length (X)</td><td>{formatLength(size.x, unit)}</td></tr><tr><td>Height (Y)</td><td>{formatLength(size.y, unit)}</td></tr><tr><td>Width (Z)</td><td>{formatLength(size.z, unit)}</td></tr>
          <tr><td>Surface area</td><td>{a.any ? formatArea(a.areaM2, unit) : '—'}</td></tr>
          <tr><td>Volume</td><td>{a.volumeM3 != null ? formatVolume(a.volumeM3, unit) : a.any ? `not available — mesh is open (${fmtNum(a.boundaryEdges)} open edges)` : '—'}</td></tr>
          <tr><td>Triangles / vertices</td><td>{fmtNum(st.triangles)} / {fmtNum(st.vertices + st.points)}</td></tr>
          <tr><td>Texture resolution</td><td>{st.textures.join(', ') || 'none'}</td></tr>
        </tbody></table>
        <p className="ss-help">Accuracy limits: results are only as good as the scan and your calibration; holes, missing sides and AI-estimated models make area and volume unreliable.</p>
      </Section>
    </div>
  );
}

// ===================================================================================== EXPORT
const FORMATS = [
  ['glb', 'GLB', 'Single file with textures & materials. Best for sharing and web.'],
  ['gltf', 'glTF', 'Same as GLB as one self-contained .gltf file (textures embedded).'],
  ['obj', 'OBJ', 'Geometry only — colours and textures are not exported.'],
  ['stl', 'STL', 'Geometry only, for 3D printing — no colour or texture.'],
  ['ply', 'PLY', 'Geometry, with vertex colours where the model has them.'],
];
const BUDGETS = [[0, 'Full quality'], [200000, '≈ 200k triangles'], [100000, '≈ 100k triangles'], [50000, '≈ 50k triangles'], [20000, '≈ 20k triangles']];
export function ExportTab({ ctx }) {
  const { eng, project, notify } = ctx; const [fmt, setFmt] = useState('glb'); const [budget, setBudget] = useState(0); const [busy, setBusy] = useState(false); const [prog, setProg] = useState(0); const [last, setLast] = useState(null);
  const st = eng.stats(); const nothing = !st.parts;
  const go = async () => {
    setBusy(true); setProg(0); setLast(null);
    try {
      const blob = await eng.exportModel(fmt, { maxTriangles: budget, onProgress: setProg });
      const name = `${(project?.name || 'scan').replace(/[^\w\-]+/g, '_').slice(0, 40)}.${fmt}`;
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 6000);
      setLast({ name, size: blob.size });
    } catch (e) { notify(e.message || 'Export failed.'); } finally { setBusy(false); }
  };
  return (
    <div className="ss-tool">
      <Section title="Format" hint="Only visible, non-deleted parts are exported, exactly as you see them.">
        <div className="ss-formats" role="radiogroup" aria-label="Export format">{FORMATS.map(([k, l, d]) => <label key={k} className={fmt === k ? 'on' : ''}><input type="radio" name="fmt" checked={fmt === k} onChange={() => setFmt(k)} /><b>{l}</b><small>{d}</small></label>)}</div>
      </Section>
      <Section title="Quality" hint={st.triangles ? `Model has ${fmtNum(st.triangles)} triangles.` : undefined}>
        <select value={budget} onChange={(e) => setBudget(Number(e.target.value))} aria-label="Polygon budget">{BUDGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <p className="ss-help">A lower budget simplifies each mesh in your browser before exporting (parts up to 150k triangles; larger parts are exported as they are). Your project is not changed.</p>
      </Section>
      <Primary disabled={busy || nothing} onClick={go}>{busy ? 'Exporting…' : `⬇ Export ${fmt.toUpperCase()}`}</Primary>
      {busy && budget > 0 && <progress value={prog} max="1" aria-label="Export progress" />}
      {last && <p className="ss-ok" role="status">✅ Saved {last.name} ({fmtBytes(last.size)})</p>}
    </div>
  );
}

// ===================================================================================== PUBLISH
export function PublishTab({ ctx }) {
  const { project, wi, publish, stats, notify } = ctx; const [caption, setCaption] = useState(''); const [tags, setTags] = useState(''); const [aud, setAud] = useState('public'); const [which, setWhich] = useState('current'); const [ok, setOk] = useState(false); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const big = stats.triangles > 300000;
  const go = async () => {
    setBusy(true);
    try {
      const tagText = tags.split(/[\s,]+/).filter(Boolean).map((t) => `#${t.replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '')}`).filter((t) => t.length > 1).join(' ');
      await publish({ caption: [caption.trim(), tagText].filter(Boolean).join('\n'), audience: aud, variantId: which }); setDone(true);
    } catch (e) { notify(e.message || 'Could not publish.'); } finally { setBusy(false); }
  };
  if (done) return <div className="ss-tool"><p className="ss-ok" role="status">✅ Published to your CHEX feed. Everyone allowed to see it can rotate and inspect the model, react and comment.</p><Btn onClick={() => { setDone(false); setOk(false); }}>Publish another</Btn></div>;
  return (
    <div className="ss-tool">
      <Section title="Share to the CHEX feed" hint="Your project stays private until you confirm below. Viewers get an interactive 3D preview with comments and reactions.">
        <label className="sim-color"><span>What to publish</span><select value={which} onChange={(e) => setWhich(e.target.value)} aria-label="Variant to publish"><option value="current">Current model as shown</option>{wi.variants.map((v) => <option key={v.id} value={v.id}>Variant: {v.name}</option>)}</select></label>
        <textarea className="ss-text" rows={3} maxLength={1800} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption…" aria-label="Caption" />
        <input className="ss-text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags: scan chair design" aria-label="Tags" maxLength={120} />
        <label className="sim-color"><span>Who can see it</span><select value={aud} onChange={(e) => setAud(e.target.value)} aria-label="Audience"><option value="public">🌍 Everyone</option><option value="followers">👥 Followers only</option></select></label>
        {big && <p className="ss-warn">⚠ This model is large ({fmtNum(stats.triangles)} triangles) and may be slow in the feed. Simplify it in Edit or Export a lighter copy first.</p>}
        <label className="sim-check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I want to publish this scan{aud === 'public' ? ' publicly' : ' to my followers'}. The model file will be copied to CHEX storage.</label>
        <Primary disabled={!ok || busy || !project?.hasModel} onClick={go}>{busy ? 'Publishing…' : '🧊 Publish 3D model'}</Primary>
        {!project?.hasModel && <p className="ss-help">Save the project with a model first.</p>}
        <p className="ss-help">Not included yet: remix permissions and private share links. A published post can be deleted from its ⋯ menu, which also deletes the copied model.</p>
      </Section>
    </div>
  );
}

// ===================================================================================== 3D STUDIO (display tab)
export function StudioTab({ ctx }) {
  const { eng, stats } = ctx; const [o, setO] = useState({ bg: '#0d1226', key: 1.6, amb: 0.35, env: 0.7, exp: 1, ang: 0.8 });
  const up = (k, name, v) => { setO((x) => ({ ...x, [k]: v })); eng.setOption(name, v); };
  return (
    <div className="ss-tool">
      <Section title="Inspect" hint="Drag to orbit · scroll / pinch to zoom · right-drag or two fingers to pan · click a part to select it (Shift for several).">
        <p>{fmtNum(stats.parts)} part(s) · {fmtNum(stats.triangles)} triangles{stats.points ? ` · ${fmtNum(stats.points)} points` : ''}</p>
        <p className="ss-help">Use the bar above the viewport for Textured / Solid / Wireframe / X-ray / Points, and below it for standard views, projection, grid, axes and bounding box.</p>
      </Section>
      <Section title="Lighting & background">
        <label className="sim-color"><span>Background</span><input type="color" value={o.bg} onChange={(e) => up('bg', 'background', e.target.value)} aria-label="Background colour" /></label>
        <Slider label="Key light" value={o.key} min={0} max={4} onChange={(v) => up('key', 'keyLight', v)} />
        <Slider label="Light direction" value={o.ang} min={0} max={6.28} step={0.05} onChange={(v) => up('ang', 'lightAngle', v)} />
        <Slider label="Ambient" value={o.amb} min={0} max={2} onChange={(v) => up('amb', 'ambient', v)} />
        <Slider label="Reflections" value={o.env} min={0} max={2} onChange={(v) => up('env', 'environment', v)} />
        <Slider label="Exposure" value={o.exp} min={0.3} max={2.5} onChange={(v) => up('exp', 'exposure', v)} />
      </Section>
    </div>
  );
}
