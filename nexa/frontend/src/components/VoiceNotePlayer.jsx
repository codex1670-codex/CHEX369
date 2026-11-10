import { useEffect, useRef, useState } from 'react';
import { fmtClock } from './VoiceRecorder.jsx';

let nowPlaying = null; // only one voice note plays at a time

export default function VoiceNotePlayer({ src, seconds }) {
  const ref = useRef(null);
  const [on, setOn] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(seconds || 0);

  useEffect(() => {
    const a = ref.current;
    if (!a) return undefined;
    const tick = () => setPos(a.currentTime);
    // recorded webm often reports an infinite length, so the stored length is preferred
    const meta = () => { if (!seconds && Number.isFinite(a.duration)) setDur(a.duration); };
    const end = () => { setOn(false); setPos(0); };
    const onPlay = () => setOn(true);
    const onPause = () => setOn(false);
    a.addEventListener('timeupdate', tick);
    a.addEventListener('loadedmetadata', meta);
    a.addEventListener('durationchange', meta);
    a.addEventListener('ended', end);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    return () => {
      a.removeEventListener('timeupdate', tick);
      a.removeEventListener('loadedmetadata', meta);
      a.removeEventListener('durationchange', meta);
      a.removeEventListener('ended', end);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      if (nowPlaying === a) nowPlaying = null;
      a.pause();
    };
  }, [seconds]);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) {
      if (nowPlaying && nowPlaying !== a) nowPlaying.pause();
      nowPlaying = a;
      a.play().catch(() => setOn(false));
    } else a.pause();
  };
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;

  return (
    <div className="voice-note" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="vn-play" onClick={toggle} aria-label={on ? 'Pause voice note' : 'Play voice note'}>{on ? '⏸' : '▶'}</button>
      <div className="vn-track" aria-hidden><div className="vn-fill" style={{ width: `${pct}%` }} /></div>
      <span className="vn-time">{fmtClock(on || pos > 0 ? pos : dur)}</span>
      <audio ref={ref} src={src} preload="metadata" />
    </div>
  );
}
