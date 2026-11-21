import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { FilterEngine } from '../filters/FilterEngine.js';
import { FILTER_GROUPS, NO_FILTER, filterById, isAvailable } from '../filters/faceFilters.js';
import { fmtClock } from '../components/VoiceRecorder.jsx';
import { cameraSupported } from '../components/CameraCapture.jsx';
import { groupTitle } from '../components/GroupSheets.jsx';

// CHEX Snap: a full-screen "advanced camera" with every filter from video calls (face, overlays, looks, effects).
// The camera feeds the same FilterEngine the calls use, so what you see is exactly what is saved:
//   photo  = a still of the filtered picture      video = the filtered picture + microphone, recorded live
// Afterwards: save to the phone, add to your Story, send in a chat, or post it.
const MAX_VIDEO_SECONDS = 600;
const VIDEO_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
const pickVideoType = () => (typeof MediaRecorder === 'undefined' ? '' : VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || '');
const QUALITY = { hd: [1280, 720, 1280], fhd: [1920, 1080, 1600], uhd: [3840, 2160, 1920] };
const toast = (text) => window.dispatchEvent(new CustomEvent('chex:toast', { detail: { text } }));

export default function Snap({ onBack, onOpenMessages }) {
  const { user } = useAuth();
  const videoRef = useRef(null);
  const engineRef = useRef(null);
  const camStreamRef = useRef(null);
  const trackRef = useRef(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const keepRef = useRef(false);
  const timerRef = useRef(null);
  const countRef = useRef(null);
  const elapsedRef = useRef(0);
  const lastTickRef = useRef(0);
  const pausedRef = useRef(false);
  const pinchRef = useRef(null);
  const swipeRef = useRef(null);
  const zoomRef = useRef(1);
  const filterRef = useRef('none');
  const nameTimer = useRef(null);

  const [facing, setFacing] = useState('user');           // selfie camera first: it is the filter camera
  const [quality, setQuality] = useState('fhd');
  const [mode, setMode] = useState('photo');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [multi, setMulti] = useState(false);
  const [torchOk, setTorchOk] = useState(false);
  const [torch, setTorch] = useState(false);
  const [zoomCaps, setZoomCaps] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [grid, setGrid] = useState(false);
  const [timerSec, setTimerSec] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [secs, setSecs] = useState(0);
  const [flash, setFlash] = useState(false);
  const [filterId, setFilterId] = useState('none');
  const [tab, setTab] = useState('face');
  const [tray, setTray] = useState(true);
  const [faceStatus, setFaceStatus] = useState('idle');
  const [faceSeen, setFaceSeen] = useState(null);
  const [label, setLabel] = useState('');
  const [shot, setShot] = useState(null);                 // { file, url, kind }
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState('');
  const [picker, setPicker] = useState(null);             // null | { loading, list, error }

  const all = useMemo(() => [NO_FILTER, ...FILTER_GROUPS.flatMap((g) => g[2]).filter(isAvailable)], []);

  // ---------- camera + filter engine ----------
  useEffect(() => {
    if (!cameraSupported()) { setError('The camera needs a secure (https) connection and a browser that supports it.'); return undefined; }
    let cancelled = false;
    setReady(false); setError('');
    (async () => {
      try {
        camStreamRef.current?.getTracks().forEach((t) => t.stop());
        const [w, h, maxW] = QUALITY[quality];
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: w }, height: { ideal: h } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        camStreamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        const caps = track?.getCapabilities?.() || {};
        setTorchOk(!!caps.torch); setTorch(false);
        setZoomCaps(caps.zoom ? { min: caps.zoom.min || 1, max: Math.min(caps.zoom.max || 4, 10), step: caps.zoom.step || 0.1 } : null);
        setZoom(1); zoomRef.current = 1;
        if (!engineRef.current) {
          const eng = new FilterEngine({ onStatus: setFaceStatus, onFace: setFaceSeen });
          engineRef.current = eng;
          eng.maxW = maxW; eng.setMirror(facing === 'user');
          const out = eng.start(track);
          if (videoRef.current) { videoRef.current.srcObject = out; videoRef.current.play?.().catch(() => {}); }
          if (filterRef.current !== 'none') eng.setFilter(filterRef.current);
        } else {
          engineRef.current.maxW = maxW; engineRef.current.setMirror(facing === 'user'); engineRef.current.setSource(track);
        }
        setReady(true);
        navigator.mediaDevices.enumerateDevices?.().then((d) => { if (!cancelled) setMulti(d.filter((x) => x.kind === 'videoinput').length > 1); }).catch(() => {});
      } catch (err) {
        if (cancelled) return;
        const n = err?.name;
        setError(n === 'NotAllowedError' || n === 'SecurityError' ? 'Camera is blocked. Allow it in Settings → Phone permissions, or in your browser site settings.'
          : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'No camera found on this device.' : 'Could not open the camera. Another app may be using it.');
      }
    })();
    return () => { cancelled = true; };
  }, [facing, quality, attempt]);

  // leaving closes everything
  useEffect(() => () => {
    keepRef.current = false;
    clearInterval(timerRef.current); clearInterval(countRef.current); clearTimeout(nameTimer.current);
    if (recRef.current && recRef.current.state !== 'inactive') { try { recRef.current.stop(); } catch { /* ignore */ } }
    engineRef.current?.stop(); engineRef.current = null;
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { if (picker) setPicker(null); else if (shot) retake(); else onBack?.(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  // coming back to the preview after a review: the canvas stream needs re-attaching to the new <video>
  useEffect(() => {
    if (!shot && videoRef.current && engineRef.current?.stream) { videoRef.current.srcObject = engineRef.current.stream; videoRef.current.play?.().catch(() => {}); }
  }, [shot]);

  // ---------- filters ----------
  const pickFilter = useCallback((id, announce = true) => {
    filterRef.current = id; setFilterId(id);
    engineRef.current?.setFilter(id);
    if (announce) { setLabel(filterById(id).name === 'None' && id === 'none' ? 'No filter' : filterById(id).name); clearTimeout(nameTimer.current); nameTimer.current = setTimeout(() => setLabel(''), 1400); }
  }, []);
  const step = useCallback((dir) => {
    const i = Math.max(0, all.findIndex((f) => f.id === filterRef.current));
    const next = all[(i + dir + all.length) % all.length];
    pickFilter(next.id);
    const g = FILTER_GROUPS.find((x) => x[2].some((f) => f.id === next.id)); if (g) setTab(g[0]);
  }, [all, pickFilter]);
  const shuffle = () => { const pool = all.filter((f) => f.id !== 'none' && f.id !== filterRef.current); const f = pool[Math.floor(Math.random() * pool.length)]; pickFilter(f.id); const g = FILTER_GROUPS.find((x) => x[2].some((y) => y.id === f.id)); if (g) setTab(g[0]); };

  // ---------- capture ----------
  const blink = () => { setFlash(true); setTimeout(() => setFlash(false), 160); };
  const takePhoto = () => {
    const cv = engineRef.current?.canvas;
    if (!cv || !cv.width) { setNote('Camera is still starting. Try again.'); return; }
    blink();
    cv.toBlob((blob) => {
      if (!blob) { setNote('Could not take the photo. Try again.'); return; }
      setShot({ file: new File([blob], `snap-${Date.now()}.jpg`, { type: 'image/jpeg' }), url: URL.createObjectURL(blob), kind: 'image' });
    }, 'image/jpeg', 0.93);
  };
  const stopRecording = (keep) => {
    keepRef.current = keep; clearInterval(timerRef.current);
    setRecording(false); setPaused(false); pausedRef.current = false;
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
  };
  const startRecording = async () => {
    const out = engineRef.current?.stream;
    if (!out) return;
    setNote('');
    let tracks = [...out.getVideoTracks()];
    try { const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); tracks = [...tracks, ...mic.getAudioTracks()]; }
    catch { setNote('Microphone is off, so this snap will have no sound.'); }
    const type = pickVideoType();
    let rec;
    try { rec = new MediaRecorder(new MediaStream(tracks), type ? { mimeType: type } : undefined); }
    catch { setNote('This browser cannot record video here. Use Photo instead.'); tracks.filter((t) => t.kind === 'audio').forEach((t) => t.stop()); return; }
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      tracks.filter((t) => t.kind === 'audio').forEach((t) => t.stop());
      if (!keepRef.current) return;
      const mime = rec.mimeType || type || 'video/webm';
      const blob = new Blob(chunksRef.current, { type: mime });
      if (!blob.size) { setNote('Nothing was recorded. Try again.'); return; }
      const base = mime.split(';')[0];
      setShot({ file: new File([blob], `snap-${Date.now()}.${base.includes('mp4') ? 'mp4' : 'webm'}`, { type: base }), url: URL.createObjectURL(blob), kind: 'video' });
    };
    recRef.current = rec; keepRef.current = false;
    elapsedRef.current = 0; lastTickRef.current = Date.now(); pausedRef.current = false; setPaused(false); setSecs(0);
    rec.start(500); setRecording(true);
    timerRef.current = setInterval(() => {
      const now = Date.now();
      if (!pausedRef.current) elapsedRef.current += now - lastTickRef.current;
      lastTickRef.current = now; const s = elapsedRef.current / 1000; setSecs(s);
      if (s >= MAX_VIDEO_SECONDS) stopRecording(true);
    }, 250);
  };
  const go = () => { if (mode === 'photo') takePhoto(); else startRecording(); };
  const shutter = () => {
    if (!ready) return;
    if (countdown > 0) { clearInterval(countRef.current); setCountdown(0); return; }
    if (recording) { stopRecording(true); return; }
    if (!timerSec) { go(); return; }
    let n = timerSec; setCountdown(n);
    countRef.current = setInterval(() => { n -= 1; if (n <= 0) { clearInterval(countRef.current); setCountdown(0); go(); } else setCountdown(n); }, 1000);
  };
  const togglePause = () => {
    const rec = recRef.current; if (!rec) return;
    try {
      if (rec.state === 'recording') { rec.pause(); pausedRef.current = true; setPaused(true); }
      else if (rec.state === 'paused') { rec.resume(); pausedRef.current = false; lastTickRef.current = Date.now(); setPaused(false); }
    } catch { setNote('This browser cannot pause recording.'); }
  };
  const toggleTorch = async () => {
    try { await trackRef.current?.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); } catch { setNote('Flash is not available on this camera.'); }
  };
  const applyZoom = (z) => {
    if (!zoomCaps) return;
    const v = Math.min(zoomCaps.max, Math.max(zoomCaps.min, z)); zoomRef.current = v; setZoom(v);
    trackRef.current?.applyConstraints({ advanced: [{ zoom: v }] }).catch(() => {});
  };
  const retake = () => { setShot(null); setCaption(''); setNote(''); setPicker(null); };

  // pinch = zoom, one-finger swipe left/right = next / previous filter
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onTouchStart = (e) => {
    if (e.touches.length === 2) { pinchRef.current = { d: dist(e.touches), z: zoomRef.current }; swipeRef.current = null; }
    else if (e.touches.length === 1 && e.target.closest?.('.snap-stage')) swipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  };
  const onTouchMove = (e) => { if (e.touches.length === 2 && pinchRef.current) applyZoom(pinchRef.current.z * (dist(e.touches) / pinchRef.current.d)); };
  const onTouchEnd = (e) => {
    pinchRef.current = null;
    const s = swipeRef.current; swipeRef.current = null;
    if (!s || !e.changedTouches?.[0]) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - s.t < 600) step(dx < 0 ? 1 : -1);
  };

  // ---------- after the shot ----------
  const save = () => {
    const a = document.createElement('a'); a.href = shot.url; a.download = shot.file.name; document.body.appendChild(a); a.click(); a.remove();
    toast('💾 Saved to your device');
  };
  const run = async (key, fn, done) => {
    setBusy(key); setNote('');
    try { await fn(); toast(done); retake(); } catch (err) { setNote(err?.message || 'That did not work. Try again.'); } finally { setBusy(''); }
  };
  const toStory = () => run('story', () => api.uploadStory(shot.file, { caption, audience: 'everyone' }), '✅ Added to your story');
  const toPost = () => run('post', () => api.uploadPost(shot.file, caption, null, 'public'), '✅ Posted');
  const toReel = () => run('reel', () => api.uploadReel(shot.file, caption), '✅ Reel posted');
  const openPicker = async () => {
    setPicker({ loading: true, list: [] });
    try { const res = await api.conversations(); setPicker({ loading: false, list: res.conversations || [] }); }
    catch (err) { setPicker({ loading: false, list: [], error: err?.message || 'Could not load your chats.' }); }
  };
  const sendTo = (c) => run('send', async () => { await api.sendMessageMedia(shot.file, { conversationId: c.id }, caption); setPicker(null); }, '✅ Sent');
  const convoName = (c) => (c.type === 'group' ? groupTitle(c, user.id) : c.participants.length === 1 ? 'Notes to self' : (c.participants.find((p) => p.id !== user.id) || c.participants[0])?.displayName || 'Chat');

  const groupList = FILTER_GROUPS.find((g) => g[0] === tab)?.[2].filter(isAvailable) || [];
  const faceTab = tab === 'face';

  return (
    <div className="cam-overlay snap-page" data-noswipe role="dialog" aria-modal="true" aria-label="CHEX Snap" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {!shot && <div className="snap-stage"><video ref={videoRef} className="cam-video" autoPlay playsInline muted /></div>}
      {!shot && grid && <div className="cam-grid" aria-hidden><i /><i /><i /><i /></div>}
      {shot && (shot.kind === 'video'
        ? <video className="cam-video" src={shot.url} controls autoPlay playsInline loop />
        : <img className="cam-video" src={shot.url} alt="Snap preview" />)}
      {flash && <div className="snap-flash" aria-hidden />}
      {countdown > 0 && <div className="cam-count" aria-live="assertive">{countdown}</div>}
      {label && !shot && <div className="snap-label" role="status">{label}</div>}

      <div className="cam-top">
        <button type="button" className="cam-btn" onClick={() => (recording ? stopRecording(false) : shot ? retake() : onBack?.())} aria-label={recording ? 'Discard recording' : shot ? 'Discard snap' : 'Close CHEX Snap'}>✕</button>
        {recording && <div className="cam-rec"><span className="rec-dot" aria-hidden /> {fmtClock(secs)}</div>}
        {!shot && (
          <div className="cam-tools">
            {torchOk && <button type="button" className={`cam-btn${torch ? ' on' : ''}`} onClick={toggleTorch} aria-pressed={torch} aria-label={torch ? 'Flash off' : 'Flash on'}>{torch ? '⚡' : '🔦'}</button>}
            {!recording && <button type="button" className={`cam-btn cam-pill${timerSec ? ' on' : ''}`} onClick={() => setTimerSec((t) => (t === 0 ? 3 : t === 3 ? 10 : 0))} aria-label={`Timer ${timerSec ? timerSec + ' seconds' : 'off'}`}>⏱{timerSec ? `${timerSec}s` : ''}</button>}
            <button type="button" className={`cam-btn${grid ? ' on' : ''}`} onClick={() => setGrid((g) => !g)} aria-pressed={grid} aria-label="Grid lines">▦</button>
            {!recording && <button type="button" className="cam-btn cam-pill" onClick={() => setQuality((q) => (q === 'hd' ? 'fhd' : q === 'fhd' ? 'uhd' : 'hd'))} aria-label={`Quality ${quality}`}>{quality === 'hd' ? 'HD' : quality === 'fhd' ? 'FHD' : '4K'}</button>}
            {multi && !recording && <button type="button" className="cam-btn" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label="Switch camera">🔄</button>}
          </div>
        )}
      </div>

      {error && (
        <div className="cam-error">
          <div>{error}</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
            <button type="button" className="btn-primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
            <button type="button" className="btn-ghost" onClick={onBack}>Back</button>
          </div>
        </div>
      )}
      {note && !error && <div className="cam-note">{note}</div>}

      {!shot && tray && (
        <div className="call-filters snap-tray" role="region" aria-label="Filters">
          <div className="cf-tabs" role="tablist">
            {FILTER_GROUPS.map(([k, name]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{name}</button>)}
            <button className="cf-close" onClick={shuffle} aria-label="Random filter" title="Random filter">🎲</button>
            <button className="cf-close" style={{ marginLeft: 4 }} onClick={() => setTray(false)} aria-label="Hide filters">✕</button>
          </div>
          {filterId !== 'none' && faceStatus === 'loading' && <div className="cf-note">Loading face tracking…</div>}
          {faceStatus === 'error' && <div className="cf-note warn">Face tracking couldn’t load. Overlays and looks still work.</div>}
          {faceStatus === 'ready' && !faceSeen && filterById(filterId).kind === 'face' && <div className="cf-note">Show your face to the camera</div>}
          <div className="cf-row">
            <button className={`cf-chip${filterId === 'none' ? ' on' : ''}`} onClick={() => pickFilter('none')} aria-label="No filter"><span>{NO_FILTER.icon}</span><small>None</small></button>
            {groupList.map((f) => (
              <button key={f.id} className={`cf-chip${filterId === f.id ? ' on' : ''}`} onClick={() => pickFilter(f.id)} aria-pressed={filterId === f.id} aria-label={f.name}><span>{f.icon}</span><small>{f.name}</small></button>
            ))}
          </div>
        </div>
      )}

      <div className="cam-bottom">
        {!shot ? (
          <>
            <div className="cam-modes" role="tablist" aria-label="Snap mode">
              <button type="button" role="tab" aria-selected={mode === 'photo'} className={mode === 'photo' ? 'on' : ''} disabled={recording} onClick={() => setMode('photo')}>Photo</button>
              <button type="button" role="tab" aria-selected={mode === 'video'} className={mode === 'video' ? 'on' : ''} disabled={recording} onClick={() => setMode('video')}>Video</button>
            </div>
            {ready && zoomCaps && zoomCaps.max > zoomCaps.min && (
              <div className="cam-zoom"><span>{zoom.toFixed(1)}×</span>
                <input type="range" min={zoomCaps.min} max={zoomCaps.max} step={zoomCaps.step} value={zoom} onChange={(e) => applyZoom(Number(e.target.value))} aria-label="Zoom" /></div>
            )}
            <div className="cam-shutter-row">
              {recording
                ? <button type="button" className="cam-btn cam-side" onClick={togglePause} aria-label={paused ? 'Resume recording' : 'Pause recording'}>{paused ? '▶' : '⏸'}</button>
                : <button type="button" className={`cam-btn cam-side${tray ? ' on' : ''}`} onClick={() => setTray((v) => !v)} aria-pressed={tray} aria-label="Filters">✨</button>}
              <button type="button" className={`cam-shutter ${mode === 'video' ? 'video' : ''} ${recording ? 'rec' : ''}`} onClick={shutter} disabled={!ready && !error}
                aria-label={mode === 'photo' ? 'Take photo' : recording ? 'Stop recording' : 'Start recording'} />
              {recording ? <span className="cam-side" aria-hidden /> : <button type="button" className="cam-btn cam-side" onClick={() => step(1)} aria-label="Next filter">➡️</button>}
            </div>
          </>
        ) : (
          <div className="snap-review">
            <input className="snap-caption" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} placeholder="Add a caption…" aria-label="Caption" />
            <div className="snap-actions">
              <button type="button" className="btn-ghost cam-act" onClick={retake} disabled={!!busy}>↺ Retake</button>
              <button type="button" className="btn-ghost cam-act" onClick={save} disabled={!!busy}>💾 Save</button>
              <button type="button" className="btn-primary cam-act" onClick={toStory} disabled={!!busy}>{busy === 'story' ? 'Adding…' : '⭕ My story'}</button>
              <button type="button" className="btn-primary cam-act" onClick={openPicker} disabled={!!busy}>{busy === 'send' ? 'Sending…' : '💬 Send to…'}</button>
              {shot.kind === 'video'
                ? <button type="button" className="btn-ghost cam-act" onClick={toReel} disabled={!!busy}>{busy === 'reel' ? 'Posting…' : '🎬 Reel'}</button>
                : <button type="button" className="btn-ghost cam-act" onClick={toPost} disabled={!!busy}>{busy === 'post' ? 'Posting…' : '🖼️ Post'}</button>}
            </div>
          </div>
        )}
      </div>

      {picker && (
        <div className="snap-picker" role="dialog" aria-label="Send to">
          <div className="snap-picker-card">
            <div className="snap-picker-head"><b>Send to…</b><button className="cam-btn" onClick={() => setPicker(null)} aria-label="Close">✕</button></div>
            {picker.loading && <div className="cf-note">Loading chats…</div>}
            {picker.error && <div className="cf-note warn">{picker.error}</div>}
            {!picker.loading && !picker.error && picker.list.length === 0 && <div className="cf-note">No chats yet. Start one in Messages first.</div>}
            <div className="snap-picker-list">
              {picker.list.map((c) => <button key={c.id} className="snap-picker-row" disabled={!!busy} onClick={() => sendTo(c)}>{convoName(c)}<span>{c.type === 'group' ? 'Group' : 'Send'}</span></button>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
