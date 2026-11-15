import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analysePhoto, checkPhotoFile, extractFrames, flagDuplicates, pickBestFrames, setReport, MAX_FRAMES } from './capture.js';
import { toGray, sharpness, exposure, qualityVerdict, sectorCoverage } from './studioMath.js';
import { IMPORT_EXTS } from './engine.js';

const cameraOk = () => typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
const SOURCES = [['camera', '📷 Camera'], ['photos', '🖼️ Photos'], ['video', '🎞️ Video'], ['single', '✨ One photo (AI)'], ['import', '📦 Import 3D file']];

function Thumb({ it, i, last, onMove, onRemove, onToggle, onReplace }) {
  return (
    <li className={`ss-thumb ${it.keep ? '' : 'off'} ${it.issues.length || it.dup ? 'warn' : ''}`}>
      <img src={it.url} alt={`Photo ${i + 1}`} draggable={false} />
      <span className="ss-thumb-n">{i + 1}</span>
      {(it.issues.length > 0 || it.dup) && <span className="ss-thumb-flag" title={[...it.issues, it.dup ? 'duplicate' : ''].filter(Boolean).join(', ')}>⚠ {it.dup ? 'duplicate' : it.issues[0]}</span>}
      <div className="ss-thumb-acts">
        <button type="button" onClick={() => onMove(i, -1)} disabled={i === 0} aria-label={`Move photo ${i + 1} earlier`}>◀</button>
        <button type="button" onClick={() => onMove(i, 1)} disabled={last} aria-label={`Move photo ${i + 1} later`}>▶</button>
        <button type="button" onClick={() => onToggle(it.id)} aria-label={it.keep ? 'Leave this photo out' : 'Use this photo'}>{it.keep ? '👁' : '🚫'}</button>
        <button type="button" onClick={() => onReplace(it.id)} aria-label="Replace this photo">⟳</button>
        <button type="button" onClick={() => onRemove(it.id)} aria-label="Remove this photo">✕</button>
      </div>
    </li>
  );
}

/** Live camera with an orbit-coverage ring. Permission is only requested when the person presses Start. */
function LiveCamera({ onShot, onVideo, shots }) {
  const vref = useRef(null); const streamRef = useRef(null); const recRef = useRef(null); const chunks = useRef([]);
  const [on, setOn] = useState(false); const [facing, setFacing] = useState('environment'); const [err, setErr] = useState('');
  const [torch, setTorch] = useState(false); const [torchOk, setTorchOk] = useState(false); const [rec, setRec] = useState(false); const [live, setLive] = useState(null);

  const stop = useCallback(() => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setOn(false); setTorch(false); setTorchOk(false); }, []);
  useEffect(() => stop, [stop]);
  const start = useCallback(async (face) => {
    setErr(''); stop();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: face }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      streamRef.current = s; if (vref.current) { vref.current.srcObject = s; await vref.current.play().catch(() => {}); }
      setTorchOk(!!s.getVideoTracks()[0]?.getCapabilities?.().torch); setOn(true);
    } catch (e) { setErr(e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in your browser’s site settings, or use “Photos” to upload pictures instead.' : e.name === 'NotFoundError' ? 'No camera was found on this device. Use “Photos” to upload pictures instead.' : 'The camera could not start. Close other apps using it, or use “Photos”.'); }
  }, [stop]);
  const flip = () => { const f = facing === 'environment' ? 'user' : 'environment'; setFacing(f); start(f); };
  const toggleTorch = async () => { try { await streamRef.current.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); } catch { setErr('Flash is not available on this camera.'); } };

  // live sharpness / exposure read-out (4×/s) so the person can steady the phone before shooting
  useEffect(() => {
    if (!on) return undefined; const c = document.createElement('canvas'); c.width = 160; c.height = 120; const ctx = c.getContext('2d', { willReadFrequently: true });
    const t = setInterval(() => { const v = vref.current; if (!v || !v.videoWidth) return; ctx.drawImage(v, 0, 0, 160, 120); const { data } = ctx.getImageData(0, 0, 160, 120); const g = toGray(data, 160, 120, 160); const sh = sharpness(g.gray, g.w, g.h); const ex = exposure(g.gray); setLive({ issues: qualityVerdict({ sharp: sh * 2.2, ...ex }), sharp: sh }); }, 250);
    return () => clearInterval(t);
  }, [on]);

  const shoot = () => {
    const v = vref.current; if (!v?.videoWidth) return; const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob((b) => b && onShot(new File([b], `shot-${Date.now()}.jpg`, { type: 'image/jpeg' })), 'image/jpeg', 0.92);
  };
  const toggleRec = () => {
    if (rec) { recRef.current?.stop(); return; }
    if (typeof MediaRecorder === 'undefined') { setErr('Video recording is not supported in this browser. Record with your camera app and use “Video”.'); return; }
    chunks.current = []; const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    const r = new MediaRecorder(streamRef.current, type ? { mimeType: type } : undefined); recRef.current = r;
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => { setRec(false); const blob = new Blob(chunks.current, { type: r.mimeType || 'video/webm' }); onVideo(new File([blob], `orbit-${Date.now()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`, { type: blob.type })); };
    r.start(); setRec(true);
  };
  const cov = sectorCoverage(shots);
  const tip = live?.issues.length ? `Hold still — ${live.issues.join(', ')}` : cov.covered < 12 ? `Move to angle ${cov.covered + 1} of 12 (about ${cov.covered * 30}°) and keep the object centred` : 'All 12 angles covered. Add a few higher and lower shots.';

  return (
    <div className="ss-cam">
      {!on ? (
        <div className="ss-cam-ask">
          <p><b>Why the camera?</b> CHEX needs the camera only to photograph or film the object you want to scan. Nothing is uploaded until you press Reconstruct.</p>
          <button type="button" className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }} onClick={() => start(facing)} disabled={!cameraOk()}>Start camera</button>
          {!cameraOk() && <p className="ss-warn" role="alert">The camera needs a secure (https) page and a browser that supports it. Use “Photos” to upload pictures instead.</p>}
        </div>
      ) : (
        <div className="ss-cam-stage">
          <video ref={vref} playsInline muted aria-label="Live camera preview" />
          <svg className="ss-cam-guide" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <rect x="22" y="18" width="56" height="64" rx="4" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth=".5" strokeDasharray="3 2" />
            {cov.hit.map((h, i) => { const a = (i / 12) * Math.PI * 2 - Math.PI / 2; const a2 = ((i + 0.85) / 12) * Math.PI * 2 - Math.PI / 2; return <path key={i} d={`M ${50 + 46 * Math.cos(a)} ${50 + 46 * Math.sin(a)} A 46 46 0 0 1 ${50 + 46 * Math.cos(a2)} ${50 + 46 * Math.sin(a2)}`} stroke={h ? '#3ddc97' : 'rgba(255,255,255,.35)'} strokeWidth="2" fill="none" />; })}
          </svg>
          <div className={`ss-cam-tip ${live?.issues.length ? 'bad' : ''}`} role="status">{rec ? '● Recording — walk slowly all the way round the object' : tip}</div>
          <div className="ss-cam-bar">
            <button type="button" onClick={flip} aria-label="Switch front / rear camera">🔄</button>
            <button type="button" className="shutter" onClick={shoot} aria-label="Take photo" disabled={rec} />
            <button type="button" className={rec ? 'rec' : ''} onClick={toggleRec} aria-label={rec ? 'Stop recording' : 'Record orbit video'}>{rec ? '■' : '🎥'}</button>
            {torchOk && <button type="button" className={torch ? 'on' : ''} onClick={toggleTorch} aria-pressed={torch} aria-label="Flash">🔦</button>}
            <button type="button" onClick={stop} aria-label="Turn camera off">✕</button>
          </div>
        </div>
      )}
      {err && <div className="error-banner" role="alert">{err}</div>}
      <p className="ss-help">The ring is a guide, not a measurement: it fills as you add photos, so it cannot tell you the real angle. Walk a full circle at three heights for the best result.</p>
    </div>
  );
}

export default function CaptureTab({ ctx }) {
  const { frames, setFrames, notify, projectHasModel, importModel, engineReady } = ctx;
  const [src, setSrc] = useState('camera'); const [busy, setBusy] = useState(''); const [prog, setProg] = useState(0); const [over, setOver] = useState(false); const [err, setErr] = useState('');
  const abort = useRef(null); const fileRef = useRef(null); const vidRef = useRef(null); const replaceRef = useRef(null); const modelRef = useRef(null); const replaceId = useRef(null);
  const report = useMemo(() => setReport(frames), [frames]);

  const add = useCallback(async (files, { single = false } = {}) => {
    setErr(''); const list = [...files]; const rec = []; const problems = [];
    setBusy('Checking photos…');
    for (const f of list) {
      const bad = checkPhotoFile(f); if (bad) { problems.push(bad); continue; }
      try { rec.push(await analysePhoto(f, f.name)); } catch { problems.push(`“${(f.name || 'photo').slice(0, 40)}” could not be opened.`); }
    }
    setBusy('');
    if (problems.length) setErr(problems.slice(0, 3).join(' ') + (problems.length > 3 ? ` (+${problems.length - 3} more)` : ''));
    setFrames((prev) => { const merged = single ? rec.slice(0, 1) : [...prev, ...rec].slice(0, MAX_FRAMES); if (!single && prev.length + rec.length > MAX_FRAMES) notify(`Only the first ${MAX_FRAMES} photos are kept.`); return flagDuplicates(merged); });
  }, [setFrames, notify]);

  const onVideo = useCallback(async (file) => {
    setErr(''); const ctrl = new AbortController(); abort.current = ctrl; setBusy('Extracting frames…'); setProg(0);
    try {
      const got = await extractFrames(file, { count: 40, signal: ctrl.signal, onProgress: setProg });
      setFrames(() => pickBestFrames(flagDuplicates(got))); notify(`${got.length} frames extracted — review them below.`);
    } catch (e) { if (!e.cancelled) setErr(e.message || 'Could not read the video.'); }
    finally { setBusy(''); abort.current = null; }
  }, [setFrames, notify]);

  const move = (i, d) => setFrames((p) => { const a = [...p]; const j = i + d; if (j < 0 || j >= a.length) return p; [a[i], a[j]] = [a[j], a[i]]; return flagDuplicates(a); });
  const remove = (id) => setFrames((p) => flagDuplicates(p.filter((x) => { if (x.id === id) URL.revokeObjectURL(x.url); return x.id !== id; })));
  const toggle = (id) => setFrames((p) => p.map((x) => (x.id === id ? { ...x, keep: !x.keep } : x)));
  const clearAll = () => setFrames((p) => { p.forEach((x) => URL.revokeObjectURL(x.url)); return []; });
  const dropFiles = (e) => { e.preventDefault(); setOver(false); const fs = e.dataTransfer?.files; if (!fs?.length) return; const f0 = fs[0]; if (/\.(glb|gltf|obj|stl|ply)$/i.test(f0.name)) importModel(f0); else if (/^video\//.test(f0.type)) onVideo(f0); else add(fs, { single: src === 'single' }); };

  return (
    <div className="ss-capture" onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={dropFiles}>
      <div className="ss-seg" role="tablist" aria-label="How do you want to scan?">
        {SOURCES.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={src === k} className={src === k ? 'on' : ''} onClick={() => setSrc(k)}>{l}</button>)}
      </div>

      {projectHasModel && <div className="ss-note" role="status">This project already has a model, so its original is locked. Create a new project (Projects ▸ New) to scan or import another object.</div>}
      {err && <div className="error-banner" role="alert">{err}</div>}
      {busy && <div className="ss-busy" role="status"><span>{busy}</span>{prog > 0 && <progress value={prog} max="1" aria-label="Progress" />}{abort.current && <button type="button" className="btn-ghost" onClick={() => abort.current?.abort()}>Cancel</button>}</div>}

      <div className={`ss-source ${over ? 'over' : ''}`}>
        {src === 'camera' && <LiveCamera shots={frames.length} onShot={(f) => add([f])} onVideo={(f) => { setSrc('video'); onVideo(f); }} />}
        {src === 'photos' && (
          <div className="ss-drop"><div aria-hidden="true" className="ss-drop-art">🖼️</div>
            <h3>Add 20–40 photos from all around the object</h3>
            <p>Drag & drop, or choose files. JPG, PNG or WebP, up to 60 MB each — large photos are resized automatically before upload. Overlap each photo about 70% with the last.</p>
            <button type="button" className="btn-primary" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => fileRef.current?.click()}>Choose photos</button>
            <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} /></div>
        )}
        {src === 'video' && (
          <div className="ss-drop"><div aria-hidden="true" className="ss-drop-art">🎞️</div>
            <h3>Upload or record an orbit video</h3>
            <p>Film slowly once round the object (15–60 s, steady, well lit). CHEX picks up to {MAX_FRAMES} sharp, distinct frames — nothing leaves your device until you reconstruct.</p>
            <button type="button" className="btn-primary" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => vidRef.current?.click()} disabled={!!busy}>Choose a video</button>
            <input ref={vidRef} type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onVideo(f); }} /></div>
        )}
        {src === 'single' && (
          <div className="ss-drop"><div aria-hidden="true" className="ss-drop-art">✨</div>
            <h3>One photo → an <u>estimated</u> 3D model</h3>
            <p>An AI provider guesses the shape of the sides it cannot see. The result is <b>AI-inferred</b>, never a measured scan — do not use it for dimensions.</p>
            <button type="button" className="btn-primary" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => fileRef.current?.click()}>Choose a photo</button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { add(e.target.files, { single: true }); e.target.value = ''; }} /></div>
        )}
        {src === 'import' && (
          <div className="ss-drop"><div aria-hidden="true" className="ss-drop-art">📦</div>
            <h3>Import an existing 3D model</h3>
            <p>{IMPORT_EXTS.map((e) => e.toUpperCase()).join(', ')} · up to 80 MB. OBJ/STL/PLY/glTF are converted to GLB in your browser.</p>
            <button type="button" className="btn-primary" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => modelRef.current?.click()} disabled={projectHasModel || !engineReady}>Choose a model</button>
            <input ref={modelRef} type="file" accept=".glb,.gltf,.obj,.stl,.ply" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importModel(f); }} /></div>
        )}
      </div>

      {src !== 'import' && frames.length > 0 && (
        <section className="ss-frames" aria-label="Captured photos">
          <header>
            <b>{report.used} of {report.total} photos will be used</b>
            <span className="ss-badges">{report.blurry > 0 && <em>{report.blurry} blurry</em>}{report.exposureBad > 0 && <em>{report.exposureBad} exposure</em>}{report.dups > 0 && <em>{report.dups} duplicate</em>}</span>
            <button type="button" className="btn-ghost" onClick={() => setFrames((p) => pickBestFrames(p))}>Auto-pick best</button>
            <button type="button" className="btn-ghost" onClick={clearAll}>Clear all</button>
          </header>
          {report.warnings.map((w) => <p key={w} className="ss-warn">⚠ {w}</p>)}
          <ul className="ss-thumbs">{frames.map((it, i) => <Thumb key={it.id} it={it} i={i} last={i === frames.length - 1} onMove={move} onRemove={remove} onToggle={toggle} onReplace={(id) => { replaceId.current = id; replaceRef.current?.click(); }} />)}</ul>
          <input ref={replaceRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f || !replaceId.current) return; const bad = checkPhotoFile(f); if (bad) { setErr(bad); return; } const rec = await analysePhoto(f, f.name); setFrames((p) => flagDuplicates(p.map((x) => { if (x.id === replaceId.current) { URL.revokeObjectURL(x.url); return rec; } return x; }))); }} />
          <button type="button" className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }} onClick={() => ctx.go('reconstruct')}>Continue to Reconstruct →</button>
          <p className="ss-help">Sharpness and exposure checks are quick heuristics on a small copy of each photo — a flagged photo may still be fine, and an unflagged one can still fail to align.</p>
        </section>
      )}
    </div>
  );
}
