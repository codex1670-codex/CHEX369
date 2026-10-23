// Score Duel: both players play the SAME solo game (same random seed) on their own device;
// each submits one final score and the server declares the winner.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { LOCAL_GAMES } from './catalog.js';
import { seedRandom } from './ui.jsx';

export const DUEL_CFG = {
  'duel-blackjack': { local: 'blackjack', unit: 'chips', intro: '10 hands each. Whoever finishes with the most chips wins.' },
  'duel-traffic-dodge': { local: 'traffic-dodge', unit: 'pts', intro: 'You both face the same traffic. Highest score wins.' },
  'duel-snake': { local: 'snake', unit: 'pts', intro: 'Same food positions for both. Highest score wins.' },
  'duel-breakout': { local: 'breakout', unit: 'pts', intro: 'Same ball launches. Highest score wins.' },
  'duel-flappy-hop': { local: 'flappy-hop', unit: 'pts', intro: 'Same pipes for both. Highest score wins.' },
  'duel-2048': { local: '2048', unit: 'pts', limit: 180, intro: 'Same tiles. You have 3 minutes — highest score wins.' },
  'duel-slide-puzzle': { local: 'slide-puzzle', timed: true, limit: 300, intro: 'Same puzzle. Fastest solve wins (5 minute limit).' },
  'duel-lights-out': { local: 'lights-out', timed: true, limit: 300, intro: 'Same puzzle. Fastest solve wins (5 minute limit).' },
};

export default function DuelBoard({ room, myId, onMove }) {
  const cfg = DUEL_CFG[room.gameId];
  const game = LOCAL_GAMES.find((g) => g.id === cfg.local);
  const st = room.state;
  const opp = room.players.find((p) => p.user.id !== myId);
  const already = !!st.submitted?.[myId];
  const [phase, setPhase] = useState(already ? 'sent' : 'play'); // play | ending | sent
  const [left, setLeft] = useState(cfg.limit || null);
  const [mine, setMine] = useState(null);
  const startedAt = useRef(Date.now());
  const scoreRef = useRef(0);
  const sentRef = useRef(already);
  const moveRef = useRef(onMove); moveRef.current = onMove;

  useMemo(() => { seedRandom(st.seed); }, [st.seed]); // same run for both players
  useEffect(() => () => seedRandom(null), []);

  const submit = useMemo(() => (value) => {
    if (sentRef.current) return;
    sentRef.current = true; setMine(value); setPhase('ending');
    setTimeout(() => { moveRef.current({ score: value }); setPhase('sent'); }, 1300);
  }, []);
  const duel = useMemo(() => ({
    onScore: (n) => { scoreRef.current = n; },
    onEnd: (n) => submit(n !== undefined ? Math.round(n) : cfg.timed ? Math.max(3, Math.round((Date.now() - startedAt.current) / 1000)) : Math.round(scoreRef.current)),
  }), [submit, cfg.timed]);

  useEffect(() => {
    if (!cfg.limit || phase !== 'play') return undefined;
    const iv = setInterval(() => setLeft((l) => (l === null ? l : l - 1)), 1000);
    return () => clearInterval(iv);
  }, [cfg.limit, phase]);
  useEffect(() => { if (left !== null && left <= 0 && phase === 'play') submit(cfg.timed ? 7200 : Math.round(scoreRef.current)); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (v) => `${v}${cfg.timed ? ' s' + (v >= 7200 ? ' (not finished)' : '') : ' ' + cfg.unit}`;
  const oppDone = !!st.submitted?.[opp?.user.id];
  const Comp = game.Component;
  return (
    <div className="gm-table">
      <div className="gm-hint" style={{ maxWidth: 420 }}>{cfg.intro}</div>
      <div className="gm-statbar">
        <div className="gm-stat"><span>{opp?.user.displayName || 'Opponent'}</span><b>{oppDone ? 'Finished ✓' : 'Playing…'}</b></div>
        {left !== null && phase === 'play' && <div className="gm-stat"><span>Time left</span><b>{Math.max(0, Math.floor(left / 60))}:{String(Math.max(0, left) % 60).padStart(2, '0')}</b></div>}
      </div>
      {phase !== 'sent' ? (
        <div className="gm-stage" style={{ maxWidth: 520 }}>
          <Suspense fallback={<div className="empty-state"><span className="loading-dot" /></div>}>
            <Comp players={1} duel={duel} />
          </Suspense>
        </div>
      ) : (
        <div className="gm-center" aria-live="polite">
          <div className="gm-overlay-title" style={{ position: 'static' }}>{st.result ? 'Final scores' : 'Score submitted ✓'}</div>
          {st.result ? room.players.map((p) => <div key={p.user.id} className="gm-stat"><span>{p.user.id === myId ? 'You' : p.user.displayName}</span><b>{fmt(st.result[p.user.id])}</b></div>)
            : <><div className="gm-stat"><span>Your score</span><b>{mine !== null ? fmt(mine) : '—'}</b></div><p className="gm-hint">Waiting for {opp?.user.displayName || 'your opponent'} to finish…</p></>}
        </div>
      )}
    </div>
  );
}
