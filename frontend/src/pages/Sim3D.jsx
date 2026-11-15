import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import CameraCapture, { cameraSupported } from '../components/CameraCapture.jsx';
import Model3DViewer from '../sim3d/Model3DViewer.jsx';
import { BACKGROUNDS, DEFAULT_PARAMS, FINISHES, PRESETS, RANGES, clampParams, demoPhoto, loadImageToCanvas, makeCutout } from '../sim3d/model3d.js';
import '../sim3d/sim3d.css';

const ScanStudio = lazy(() => import('../sim3d/studio/ScanStudio.jsx'));   // 3D Scanning Studio: loaded only when opened

const toast = (text) => window.dispatchEvent(new CustomEvent('chex:toast', { detail: { text } }));

function Slider({ label, name, value, onChange, step = 0.01, unit = '', digits = 2 }) {
  const [min, max] = RANGES[name];
  return (
    <label className="sim-slider">
      <span className="sim-slider-top"><span>{label}</span><b>{Number(value).toFixed(digits)}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(name, Number(e.target.value))} aria-label={label} />
    </label>
  );
}

function QuickPhoto3D({ onBack, onPosted }) {
  const [photo, setPhoto] = useState(null);                 // decoded photo canvas
  const [cutout, setCutout] = useState(null);               // { canvas, version, fallback }
  const [sensitivity, setSensitivity] = useState(0.5);
  const [keepAll, setKeepAll] = useState(false);
  const [params, setParams] = useState({ ...DEFAULT_PARAMS });
  const [tab, setTab] = useState('shape');
  const [caption, setCaption] = useState('');
  const [audience, setAudience] = useState('public');
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const viewerRef = useRef(null);
  const version = useRef(0);

  const set = useCallback((k, v) => setParams((p) => ({ ...p, [k]: v })), []);
  const patch = useCallback((o) => setParams((p) => ({ ...p, ...o })), []);

  // Cut the object out of the photo (again whenever the photo or the cut-out settings change).
  useEffect(() => {
    if (!photo) return undefined;
    const t = setTimeout(() => {
      try {
        const res = makeCutout(photo, { sensitivity, keepAll });
        version.current += 1;
        setCutout({ canvas: res.canvas, version: version.current, fallback: res.fallback });
      } catch (e) { setError(e.message || 'Could not process this photo.'); }
    }, 150);
    return () => clearTimeout(t);
  }, [photo, sensitivity, keepAll]);

  const loadFile = async (file) => {
    if (!file) return;
    setError('');
    if (file.type && !file.type.startsWith('image/') && !/\.(heic|heif|jpe?g|png|webp|gif)$/i.test(file.name || '')) {
      setError('Choose a photo of an object (JPG, PNG, WebP…).'); return;
    }
    setLoading(true);
    try { setCutout(null); setPhoto(await loadImageToCanvas(file)); setKeepAll(false); setSensitivity(0.5); }
    catch (e) { setError(e.message || 'Could not open that photo.'); }
    finally { setLoading(false); }
  };
  const loadSample = () => { setError(''); setCutout(null); setPhoto(demoPhoto()); setKeepAll(false); setSensitivity(0.5); };
  const openCamera = () => { if (cameraSupported()) setCameraOpen(true); else camRef.current?.click(); };
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer?.files?.[0]); };
  const startOver = () => { setPhoto(null); setCutout(null); setError(''); setCaption(''); };
  const resetShape = () => setParams({ ...DEFAULT_PARAMS });

  const post = async () => {
    if (!cutout || posting) return;
    setPosting(true); setError('');
    try {
      const blob = await new Promise((resolve, reject) => cutout.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not prepare the 3D object.'))), 'image/png'));
      const file = new File([blob], 'chex-3d.png', { type: 'image/png' });
      const res = await api.uploadPost3D(file, caption.trim(), clampParams(params), audience);
      toast('🧊 Your 3D object is posted!');
      onPosted?.(res.post);
    } catch (e) { setError(e.message || 'Could not post. Please try again.'); }
    finally { setPosting(false); }
  };

  const bgSwatches = useMemo(() => BACKGROUNDS, []);
  const editing = !!photo;

  return (
    <div className="sim-page" data-noswipe="">
      <div className="stickies-head">
        {onBack && <button className="btn-ghost" style={{ width: 'auto', padding: '7px 14px' }} onClick={onBack}>← Back</button>}
        <h2>🧊 CHEX Simulation</h2>
      </div>
      <p className="stickies-sub">Pick a photo of any object and CHEX turns it into a 3D shape you can spin all the way round, reshape, and post.</p>

      {error && <div className="error-banner" role="alert" style={{ marginBottom: 10 }}>{error}</div>}

      {!editing && (
        <div className={`sim-pick ${dragOver ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
          <div className="sim-pick-art" aria-hidden="true">🧊</div>
          <h3>Start with an object</h3>
          <p>Photograph it on a plain, contrasting background (a white mug on a dark table works best).</p>
          <div className="sim-pick-btns">
            <button className="btn-primary" style={{ width: 'auto', padding: '10px 18px' }} onClick={openCamera} disabled={loading}>📷 Take a photo</button>
            <button className="btn-ghost" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => fileRef.current?.click()} disabled={loading}>🖼️ Choose a photo</button>
            <button className="btn-ghost" style={{ width: 'auto', padding: '10px 18px' }} onClick={loadSample} disabled={loading}>✨ Try a sample</button>
          </div>
          {loading && <p role="status">Opening photo…</p>}
          <input ref={fileRef} type="file" accept="image/*,.heic,.heif" hidden onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      )}

      {editing && (
        <div className="sim-edit">
          <div className="sim-stage">
            {cutout
              ? <Model3DViewer ref={viewerRef} canvas={cutout.canvas} version={cutout.version} params={params} className="sim-viewer-main" />
              : <div className="sim-viewer sim-viewer-main" style={{ background: params.bg }}><div className="sim-loading" role="status">Cutting out the object…</div></div>}
            <div className="sim-views" role="toolbar" aria-label="Viewpoint">
              {['front', 'side', 'back', 'top'].map((v) => <button key={v} type="button" onClick={() => viewerRef.current?.setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
              <button type="button" className={params.spin ? 'on' : ''} aria-pressed={params.spin} onClick={() => set('spin', !params.spin)}>⟳ Spin</button>
            </div>
            <div className="sim-hint">Drag to rotate 360° · pinch or scroll to zoom</div>
          </div>

          {cutout?.fallback && <div className="sim-note" role="status">Couldn't find a clear outline, so the whole photo is being used. Try a plainer background, or move “Background removal” in the Cutout tab.</div>}

          <div className="sim-tabs" role="tablist">
            {[['cutout', '✂️ Cutout'], ['shape', '📐 Shape'], ['look', '🎨 Look'], ['scene', '💡 Scene']].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>

          <div className="sim-controls" role="tabpanel">
            {tab === 'cutout' && (
              <>
                <label className="sim-slider">
                  <span className="sim-slider-top"><span>Background removal</span><b>{Math.round(sensitivity * 100)}%</b></span>
                  <input type="range" min="0" max="1" step="0.01" value={sensitivity} disabled={keepAll} onChange={(e) => setSensitivity(Number(e.target.value))} aria-label="Background removal" />
                </label>
                <label className="sim-check"><input type="checkbox" checked={keepAll} onChange={(e) => setKeepAll(e.target.checked)} /> Keep the whole photo (no cut-out)</label>
                <p className="sim-help">Too much of the object removed? Lower the slider. Background left behind? Raise it.</p>
              </>
            )}
            {tab === 'shape' && (
              <>
                <div className="sim-presets">
                  {Object.entries(PRESETS).map(([name, o]) => <button key={name} type="button" className="btn-ghost" onClick={() => patch(o)}>{name}</button>)}
                </div>
                <Slider label="Depth" name="depth" value={params.depth} onChange={set} />
                <Slider label="Roundness" name="roundness" value={params.roundness} onChange={set} />
                <Slider label="Width" name="width" value={params.width} onChange={set} />
                <Slider label="Height" name="height" value={params.height} onChange={set} />
                <Slider label="Twist" name="twist" value={params.twist} onChange={set} step={1} unit="°" digits={0} />
                <Slider label="Bend" name="bend" value={params.bend} onChange={set} step={1} unit="°" digits={0} />
                <Slider label="Wave" name="wave" value={params.wave} onChange={set} />
              </>
            )}
            {tab === 'look' && (
              <>
                <div className="sim-seg" role="radiogroup" aria-label="Finish">
                  {FINISHES.map((f) => <button key={f} type="button" role="radio" aria-checked={params.finish === f} className={params.finish === f ? 'on' : ''} onClick={() => set('finish', f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
                </div>
                <label className="sim-color"><span>Tint colour</span><input type="color" value={params.tint} onChange={(e) => patch({ tint: e.target.value, tintAmount: params.tintAmount || 0.5 })} aria-label="Tint colour" /></label>
                <Slider label="Tint strength" name="tintAmount" value={params.tintAmount} onChange={set} />
                <label className="sim-check"><input type="checkbox" checked={params.clay} onChange={(e) => set('clay', e.target.checked)} /> Clay (plain colour, no photo)</label>
                <label className="sim-check"><input type="checkbox" checked={params.wireframe} onChange={(e) => set('wireframe', e.target.checked)} /> Wireframe</label>
              </>
            )}
            {tab === 'scene' && (
              <>
                <div className="sim-swatches" role="radiogroup" aria-label="Background colour">
                  {bgSwatches.map((c) => <button key={c} type="button" role="radio" aria-checked={params.bg === c} aria-label={`Background ${c}`} className={params.bg === c ? 'on' : ''} style={{ background: c }} onClick={() => set('bg', c)} />)}
                  <input type="color" value={params.bg} onChange={(e) => set('bg', e.target.value)} aria-label="Custom background colour" />
                </div>
                <label className="sim-check"><input type="checkbox" checked={params.spin} onChange={(e) => set('spin', e.target.checked)} /> Slowly spin on its own</label>
                <Slider label="Spin speed" name="spinSpeed" value={params.spinSpeed} onChange={set} />
              </>
            )}
            <button type="button" className="btn-ghost sim-reset" onClick={resetShape}>↺ Reset all changes</button>
          </div>

          <div className="sim-post">
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} rows={2} placeholder="Say something about your 3D object…" aria-label="Caption" />
            <div className="sim-post-row">
              <select value={audience} onChange={(e) => setAudience(e.target.value)} aria-label="Who can see this">
                <option value="public">🌍 Everyone</option>
                <option value="followers">👥 Followers only</option>
              </select>
              <button type="button" className="btn-ghost" style={{ width: 'auto', padding: '10px 16px' }} onClick={startOver} disabled={posting}>New photo</button>
              <button type="button" className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }} onClick={post} disabled={!cutout || posting}>{posting ? 'Posting…' : '🧊 Post 3D object'}</button>
            </div>
            <p className="sim-help">Everyone who sees your post can spin the object round, exactly as you shaped it.</p>
          </div>
        </div>
      )}

      {cameraOpen && createPortal(
        <CameraCapture modes={['photo']} onCapture={(f) => { setCameraOpen(false); loadFile(f); }} onClose={() => setCameraOpen(false)} onFallback={() => { setCameraOpen(false); camRef.current?.click(); }} />,
        document.body,
      )}
    </div>
  );
}

/**
 * CHEX Simulation. Two workspaces live here: the original one-photo "Quick 3D" maker (unchanged) and the
 * full 3D Scanning Studio (capture → reconstruct → edit → simulate → measure → export → publish).
 */
export default function Sim3D({ onBack, onPosted }) {
  const [mode, setMode] = useState(() => { try { return sessionStorage.getItem('chex-sim-mode') === 'studio' ? 'studio' : 'quick'; } catch { return 'quick'; } });
  const pick = (m) => { setMode(m); try { sessionStorage.setItem('chex-sim-mode', m); } catch { /* private mode */ } };
  const bar = (
    <div className="sim-modebar" role="tablist" aria-label="CHEX Simulation workspace">
      <button type="button" role="tab" aria-selected={mode === 'quick'} className={mode === 'quick' ? 'on' : ''} onClick={() => pick('quick')}>⚡ Quick 3D from a photo</button>
      <button type="button" role="tab" aria-selected={mode === 'studio'} className={mode === 'studio' ? 'on' : ''} onClick={() => pick('studio')}>🧊 3D Scanning Studio</button>
    </div>
  );
  if (mode === 'studio') {
    return (
      <div className="sim-page sim-page-wide" data-noswipe="">
        <div className="stickies-head">
          {onBack && <button className="btn-ghost" style={{ width: 'auto', padding: '7px 14px' }} onClick={onBack}>← Back</button>}
          <h2>🧊 CHEX Simulation</h2>
        </div>
        {bar}
        <Suspense fallback={<p className="ss-help">Loading the 3D Scanning Studio…</p>}><ScanStudio /></Suspense>
      </div>
    );
  }
  return (<><div className="sim-page" style={{ paddingBottom: 0 }}>{bar}</div><QuickPhoto3D onBack={onBack} onPosted={onPosted} /></>);
}
