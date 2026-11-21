import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtClock } from './VoiceRecorder.jsx';

const MAX_VIDEO_SECONDS = 600; // auto-stops at 10:00
const VIDEO_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
const pickVideoType = () => (typeof MediaRecorder === 'undefined' ? '' : VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || '');

export const cameraSupported = () =>
  typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

// Full-screen live camera: shows the live view, takes a photo or records a video, then lets the
// person retake or use it. Calls onCapture(file) with a jpeg photo or a webm/mp4 video.
export default function CameraCapture({ onCapture, onClose, onFallback, modes = ['photo', 'video'] }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const startRef = useRef(0);
  const keepRef = useRef(false);
  const [facing, setFacing] = useState('environment'); // back camera first
  const [mode, setMode] = useState(modes[0] || 'photo');
  const [ready, setReady] = useState(false);
  const [multi, setMulti] = useState(false);
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [shot, setShot] = useState(null); // { file, url, kind }
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [attempt, setAttempt] = useState(0); // bump to reopen the camera after an error
  // advanced controls
  const [torchOk, setTorchOk] = useState(false);
  const [torch, setTorch] = useState(false);
  const [zoomCaps, setZoomCaps] = useState(null); // { min, max, step, hw }
  const [zoom, setZoom] = useState(1);
  const [timerSec, setTimerSec] = useState(0);    // 0 | 3 | 10 seconds before the shot / recording starts
  const [countdown, setCountdown] = useState(0);
  const [grid, setGrid] = useState(false);
  const [quality, setQuality] = useState('fhd');  // hd 720p | fhd 1080p | uhd 4K
  const [paused, setPaused] = useState(false);
  const trackRef = useRef(null);
  const countRef = useRef(null);
  const pausedRef = useRef(false);
  const elapsedRef = useRef(0);
  const lastTickRef = useRef(0);
  const pinchRef = useRef(null);
  const zoomRef = useRef(1);
  const QUALITY = { hd: [1280, 720], fhd: [1920, 1080], uhd: [3840, 2160] };

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // (re)start the live view whenever the camera side changes
  useEffect(() => {
    let cancelled = false;
    setReady(false); setError('');
    (async () => {
      try {
        stopStream();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: QUALITY[quality][0] }, height: { ideal: QUALITY[quality][1] } },
          audio: false, // the microphone is only asked for when a video recording starts
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        const caps = track?.getCapabilities?.() || {};
        setTorchOk(!!caps.torch); setTorch(false);
        setZoomCaps(caps.zoom ? { min: caps.zoom.min || 1, max: Math.min(caps.zoom.max || 4, 10), step: caps.zoom.step || 0.1, hw: true } : { min: 1, max: 4, step: 0.1, hw: false });
        setZoom(1); zoomRef.current = 1;
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play?.().catch(() => {}); }
        setReady(true);
        navigator.mediaDevices.enumerateDevices?.().then((d) => { if (!cancelled) setMulti(d.filter((x) => x.kind === 'videoinput').length > 1); }).catch(() => {});
      } catch (err) {
        if (cancelled) return;
        const n = err?.name;
        setError(n === 'NotAllowedError' || n === 'SecurityError' ? 'Camera is blocked. Allow it in Settings → Phone permissions, or in your browser site settings.'
          : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'No camera found on this device.'
          : 'Could not open the camera. Another app may be using it.');
      }
    })();
    return () => { cancelled = true; };
  }, [facing, attempt, quality, stopStream]);

  // leaving closes the camera and cancels any recording
  useEffect(() => () => {
    keepRef.current = false;
    clearInterval(timerRef.current); clearInterval(countRef.current);
    if (recRef.current && recRef.current.state !== 'inactive') { try { recRef.current.stop(); } catch { /* ignore */ } }
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const takePhoto = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    const z = zoomCaps && !zoomCaps.hw ? zoom : 1; // digital zoom: crop the centre, same as what the preview shows
    const sw = c.width / z, sh = c.height / z;
    c.getContext('2d').drawImage(v, (c.width - sw) / 2, (c.height - sh) / 2, sw, sh, 0, 0, c.width, c.height);
    c.toBlob((blob) => {
      if (!blob) { setNote('Could not take the photo. Try again.'); return; }
      const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setShot({ file, url: URL.createObjectURL(blob), kind: 'image' });
    }, 'image/jpeg', 0.92);
  };

  const stopRecording = (keep) => {
    keepRef.current = keep;
    clearInterval(timerRef.current);
    setRecording(false); setPaused(false); pausedRef.current = false;
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop(); // finishes in onstop
  };

  const startRecording = async () => {
    const live = streamRef.current;
    if (!live) return;
    setNote('');
    let tracks = [...live.getVideoTracks()];
    try { // add sound if the microphone is allowed; otherwise record silent video
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      tracks = [...tracks, ...mic.getAudioTracks()];
    } catch { setNote('Microphone is off, so this video will have no sound.'); }
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
      // The recorder's type can carry codecs ("video/webm;codecs=vp9,opus"); upload checks want the plain type.
      const baseMime = mime.split(';')[0];
      const file = new File([blob], `video-${Date.now()}.${baseMime.includes('mp4') ? 'mp4' : 'webm'}`, { type: baseMime });
      setShot({ file, url: URL.createObjectURL(blob), kind: 'video' });
    };
    recRef.current = rec;
    keepRef.current = false;
    elapsedRef.current = 0; lastTickRef.current = Date.now(); pausedRef.current = false; setPaused(false);
    setSecs(0);
    rec.start(500);
    setRecording(true);
    timerRef.current = setInterval(() => {
      const now = Date.now();
      if (!pausedRef.current) elapsedRef.current += now - lastTickRef.current;
      lastTickRef.current = now;
      const s = elapsedRef.current / 1000;
      setSecs(s);
      if (s >= MAX_VIDEO_SECONDS) stopRecording(true);
    }, 250);
  };

  const go = () => { if (mode === 'photo') takePhoto(); else startRecording(); };
  const shutter = () => {
    if (!ready) return;
    if (countdown > 0) { clearInterval(countRef.current); setCountdown(0); return; } // tap again cancels the timer
    if (recording) { stopRecording(true); return; }
    if (!timerSec) { go(); return; }
    let n = timerSec; setCountdown(n);
    countRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(countRef.current); setCountdown(0); go(); } else setCountdown(n);
    }, 1000);
  };
  const cycleTimer = () => setTimerSec((t) => (t === 0 ? 3 : t === 3 ? 10 : 0));
  const cycleQuality = () => setQuality((q) => (q === 'hd' ? 'fhd' : q === 'fhd' ? 'uhd' : 'hd'));
  const toggleTorch = async () => {
    const track = trackRef.current; if (!track) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); }
    catch { setNote('Flash is not available on this camera.'); }
  };
  const togglePause = () => {
    const rec = recRef.current; if (!rec) return;
    try {
      if (rec.state === 'recording') { rec.pause(); pausedRef.current = true; setPaused(true); }
      else if (rec.state === 'paused') { rec.resume(); pausedRef.current = false; lastTickRef.current = Date.now(); setPaused(false); }
    } catch { setNote('This browser cannot pause recording.'); }
  };
  const applyZoom = (z) => {
    const caps = zoomCaps; if (!caps) return;
    const v = Math.min(caps.max, Math.max(caps.min, z));
    zoomRef.current = v; setZoom(v);
    if (caps.hw) trackRef.current?.applyConstraints({ advanced: [{ zoom: v }] }).catch(() => {});
  };
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onTouchStart = (e) => { if (e.touches.length === 2) pinchRef.current = { d: dist(e.touches), z: zoomRef.current }; };
  const onTouchMove = (e) => { if (e.touches.length === 2 && pinchRef.current) applyZoom(pinchRef.current.z * (dist(e.touches) / pinchRef.current.d)); };
  const onTouchEnd = () => { pinchRef.current = null; };
  const retake = () => { setShot(null); setNote(''); setZoom(1); zoomRef.current = 1; if (zoomCaps?.hw) trackRef.current?.applyConstraints({ advanced: [{ zoom: 1 }] }).catch(() => {}); };
  const use = () => { if (shot) onCapture?.(shot.file); };

  return (
    <div className="cam-overlay" data-noswipe role="dialog" aria-modal="true" aria-label="Camera" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {!shot && <video ref={videoRef} className={`cam-video ${facing === 'user' ? 'mirror' : ''}`} autoPlay playsInline muted
        style={zoomCaps && !zoomCaps.hw && zoom > 1 ? { transform: `${facing === 'user' ? 'scaleX(-1) ' : ''}scale(${zoom})` } : undefined} />}
      {!shot && grid && <div className="cam-grid" aria-hidden><i /><i /><i /><i /></div>}
      {countdown > 0 && <div className="cam-count" aria-live="assertive">{countdown}</div>}
      {shot && (shot.kind === 'video'
        ? <video className="cam-video" src={shot.url} controls autoPlay playsInline loop />
        : <img className="cam-video" src={shot.url} alt="Photo preview" />)}

      <div className="cam-top">
        <button type="button" className="cam-btn" onClick={() => (recording ? stopRecording(false) : onClose?.())} aria-label={recording ? 'Discard recording' : 'Close camera'}>✕</button>
        {recording && <div className="cam-rec"><span className="rec-dot" aria-hidden /> {fmtClock(secs)}</div>}
        {!shot && (
          <div className="cam-tools">
            {torchOk && <button type="button" className={`cam-btn${torch ? ' on' : ''}`} onClick={toggleTorch} aria-pressed={torch} aria-label={torch ? 'Flash off' : 'Flash on'}>{torch ? '⚡' : '🔦'}</button>}
            {!recording && <button type="button" className={`cam-btn cam-pill${timerSec ? ' on' : ''}`} onClick={cycleTimer} aria-label={`Timer ${timerSec ? timerSec + ' seconds' : 'off'}`}>⏱{timerSec ? `${timerSec}s` : ''}</button>}
            <button type="button" className={`cam-btn${grid ? ' on' : ''}`} onClick={() => setGrid((g) => !g)} aria-pressed={grid} aria-label="Grid lines">▦</button>
            {!recording && <button type="button" className="cam-btn cam-pill" onClick={cycleQuality} aria-label={`Quality ${quality}`}>{quality === 'hd' ? 'HD' : quality === 'fhd' ? 'FHD' : '4K'}</button>}
            {multi && !recording && <button type="button" className="cam-btn" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label="Switch camera">🔄</button>}
          </div>
        )}
      </div>

      {error && (
        <div className="cam-error">
          <div>{error}</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <button type="button" className="btn-primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
            {onFallback && <button type="button" className="btn-ghost" onClick={onFallback}>Use phone camera app</button>}
          </div>
        </div>
      )}
      {note && !error && <div className="cam-note">{note}</div>}

      <div className="cam-bottom">
        {!shot ? (
          <>
            {modes.length > 1 && (
              <div className="cam-modes" role="tablist" aria-label="Camera mode">
                {modes.includes('photo') && <button type="button" role="tab" aria-selected={mode === 'photo'} className={mode === 'photo' ? 'on' : ''} disabled={recording} onClick={() => setMode('photo')}>Photo</button>}
                {modes.includes('video') && <button type="button" role="tab" aria-selected={mode === 'video'} className={mode === 'video' ? 'on' : ''} disabled={recording} onClick={() => setMode('video')}>Video</button>}
              </div>
            )}
            {ready && zoomCaps && zoomCaps.max > zoomCaps.min && (
              <div className="cam-zoom">
                <span>{zoom.toFixed(1)}×</span>
                <input type="range" min={zoomCaps.min} max={zoomCaps.max} step={zoomCaps.step} value={zoom} onChange={(e) => applyZoom(Number(e.target.value))} aria-label="Zoom" />
              </div>
            )}
            <div className="cam-shutter-row">
              {recording && <button type="button" className="cam-btn cam-side" onClick={togglePause} aria-label={paused ? 'Resume recording' : 'Pause recording'}>{paused ? '▶' : '⏸'}</button>}
              <button type="button" className={`cam-shutter ${mode === 'video' ? 'video' : ''} ${recording ? 'rec' : ''}`} onClick={shutter} disabled={!ready && !error}
                aria-label={mode === 'photo' ? 'Take photo' : recording ? 'Stop recording' : 'Start recording'} />
              {recording && <span className="cam-side" aria-hidden />}
            </div>
          </>
        ) : (
          <div className="cam-review">
            <button type="button" className="btn-ghost cam-act" onClick={retake}>↺ Retake</button>
            <button type="button" className="btn-primary cam-act" onClick={use}>✓ Use {shot.kind === 'video' ? 'video' : 'photo'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
