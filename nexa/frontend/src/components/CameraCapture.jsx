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
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false, // the microphone is only asked for when a video recording starts
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
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
  }, [facing, attempt, stopStream]);

  // leaving closes the camera and cancels any recording
  useEffect(() => () => {
    keepRef.current = false;
    clearInterval(timerRef.current);
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
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    c.toBlob((blob) => {
      if (!blob) { setNote('Could not take the photo. Try again.'); return; }
      const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setShot({ file, url: URL.createObjectURL(blob), kind: 'image' });
    }, 'image/jpeg', 0.92);
  };

  const stopRecording = (keep) => {
    keepRef.current = keep;
    clearInterval(timerRef.current);
    setRecording(false);
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
    startRef.current = Date.now();
    setSecs(0);
    rec.start(500);
    setRecording(true);
    timerRef.current = setInterval(() => {
      const s = (Date.now() - startRef.current) / 1000;
      setSecs(s);
      if (s >= MAX_VIDEO_SECONDS) stopRecording(true);
    }, 250);
  };

  const shutter = () => {
    if (!ready) return;
    if (mode === 'photo') takePhoto();
    else if (recording) stopRecording(true);
    else startRecording();
  };
  const retake = () => { setShot(null); setNote(''); };
  const use = () => { if (shot) onCapture?.(shot.file); };

  return (
    <div className="cam-overlay" data-noswipe role="dialog" aria-modal="true" aria-label="Camera">
      {!shot && <video ref={videoRef} className={`cam-video ${facing === 'user' ? 'mirror' : ''}`} autoPlay playsInline muted />}
      {shot && (shot.kind === 'video'
        ? <video className="cam-video" src={shot.url} controls autoPlay playsInline loop />
        : <img className="cam-video" src={shot.url} alt="Photo preview" />)}

      <div className="cam-top">
        <button type="button" className="cam-btn" onClick={() => (recording ? stopRecording(false) : onClose?.())} aria-label={recording ? 'Discard recording' : 'Close camera'}>✕</button>
        {recording && <div className="cam-rec"><span className="rec-dot" aria-hidden /> {fmtClock(secs)}</div>}
        {!shot && multi && !recording && <button type="button" className="cam-btn" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label="Switch camera">🔄</button>}
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
            <button type="button" className={`cam-shutter ${mode === 'video' ? 'video' : ''} ${recording ? 'rec' : ''}`} onClick={shutter} disabled={!ready && !error}
              aria-label={mode === 'photo' ? 'Take photo' : recording ? 'Stop recording' : 'Start recording'} />
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
