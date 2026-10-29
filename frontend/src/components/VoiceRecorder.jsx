import { useEffect, useRef, useState } from 'react';

export const MAX_VOICE_SECONDS = 300; // auto-sends at 5:00
const MIN_VOICE_SECONDS = 1;
// Chrome/Android/Firefox record webm or ogg, Safari/iPhone records mp4 (aac).
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const pickType = () => (typeof MediaRecorder === 'undefined' ? '' : TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || '');
const extFor = (t) => (t.includes('mp4') ? 'm4a' : t.includes('ogg') ? 'ogg' : 'webm');
export const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const voiceSupported = () =>
  typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

// Mic button for the chat composer. Tap to record; while recording it shows a timer with
// delete and send buttons. Calls onSend(file, seconds) with the finished recording.
export default function VoiceRecorder({ disabled, onSend, onError, onRecordingChange }) {
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const recRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startRef = useRef(0);
  const timerRef = useRef(null);
  const sendRef = useRef(false);
  const cb = useRef({});
  cb.current = { onSend, onError, onRecordingChange };

  useEffect(() => { cb.current.onRecordingChange?.(recording); }, [recording]);
  useEffect(() => () => { // leaving the chat cancels an unfinished recording
    sendRef.current = false;
    clearInterval(timerRef.current);
    if (recRef.current && recRef.current.state !== 'inactive') { try { recRef.current.stop(); } catch { /* ignore */ } }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    cb.current.onRecordingChange?.(false);
  }, []);

  const stop = (send) => {
    sendRef.current = send;
    clearInterval(timerRef.current);
    setRecording(false);
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop(); // finishes in onstop
  };

  const start = async () => {
    if (recording || disabled) return;
    if (!voiceSupported()) { cb.current.onError?.('Voice notes need https and a browser that can record audio.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const type = pickType();
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!sendRef.current) return;
        const seconds = Math.round((Date.now() - startRef.current) / 1000);
        if (seconds < MIN_VOICE_SECONDS) { cb.current.onError?.('That was too short. Hold on a little longer.'); return; }
        const mime = rec.mimeType || type || 'audio/webm';
        const file = new File([new Blob(chunksRef.current, { type: mime })], `voice-note.${extFor(mime)}`, { type: mime });
        cb.current.onSend?.(file, seconds);
      };
      recRef.current = rec;
      sendRef.current = false;
      startRef.current = Date.now();
      setSecs(0);
      rec.start(250);
      setRecording(true);
      timerRef.current = setInterval(() => {
        const s = (Date.now() - startRef.current) / 1000;
        setSecs(s);
        if (s >= MAX_VOICE_SECONDS) stop(true);
      }, 200);
    } catch (err) {
      const name = err?.name;
      cb.current.onError?.(
        name === 'NotAllowedError' || name === 'SecurityError' ? 'Microphone is blocked. Allow it in Settings → Phone permissions, or in your browser site settings.'
        : name === 'NotFoundError' ? 'No microphone found on this device.'
        : 'Could not start recording.');
    }
  };

  if (!recording) {
    return <button type="button" className="send-btn mic-btn" aria-label="Record voice note" title="Voice note" disabled={disabled} onClick={start}>🎤</button>;
  }
  return (
    <div className="voice-rec" role="status" aria-live="polite">
      <button type="button" className="btn-ghost voice-rec-del" onClick={() => stop(false)} aria-label="Delete recording">🗑</button>
      <span className="rec-dot" aria-hidden />
      <span className="rec-time">{fmtClock(secs)}</span>
      <span className="rec-hint">Recording…</span>
      <button type="button" className="send-btn" onClick={() => stop(true)} aria-label="Send voice note">➤</button>
    </div>
  );
}
