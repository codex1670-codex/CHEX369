import { useEffect, useRef, useState } from 'react';
import { Overlay, Stat, StatBar, pick, rnd, shuffle, useBest, useKeys, useSwipe, useTimeouts, rand } from './ui.jsx';

/* ───────────────────────── 2048 ───────────────────────── */
export function slideLine(line) {
  const tiles = line.filter(Boolean), out = []; let gained = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === tiles[i + 1]) { out.push(tiles[i] * 2); gained += tiles[i] * 2; i++; } else out.push(tiles[i]);
  }
  while (out.length < 4) out.push(0);
  return { line: out, gained };
}
export function move2048(board, dir) {
  const b = board.slice(); let gained = 0, moved = false;
  for (let i = 0; i < 4; i++) {
    const idx = [];
    for (let j = 0; j < 4; j++) idx.push(dir === 'left' ? i * 4 + j : dir === 'right' ? i * 4 + 3 - j : dir === 'up' ? j * 4 + i : (3 - j) * 4 + i);
    const { line, gained: g } = slideLine(idx.map(k => board[k]));
    idx.forEach((k, j) => { if (b[k] !== line[j]) moved = true; b[k] = line[j]; });
    gained += g;
  }
  return { board: b, gained, moved };
}
export function canMove2048(b) {
  if (b.includes(0)) return true;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { const v = b[r * 4 + c]; if ((c < 3 && b[r * 4 + c + 1] === v) || (r < 3 && b[(r + 1) * 4 + c] === v)) return true; }
  return false;
}
const addTile = (b) => { const e = b.map((v, i) => (v ? -1 : i)).filter(i => i >= 0); if (!e.length) return b; const n = b.slice(); n[pick(e)] = rand() < 0.9 ? 2 : 4; return n; };
const t2048Start = () => addTile(addTile(Array(16).fill(0)));
const TILE_BG = { 0: 'rgba(255,255,255,.06)', 2: '#3b3358', 4: '#4a3f73', 8: '#7c5cff', 16: '#9b7dff', 32: '#b45cff', 64: '#ff5c93', 128: '#ff8a5c', 256: '#ffb84d', 512: '#e6c84d', 1024: '#26e0c9', 2048: '#5ca8ff' };

export function Game2048({ duel }) {
  const [g, setG] = useState(() => ({ board: t2048Start(), score: 0, over: false, won: false, keepGoing: false }));
  const [best, submitBest] = useBest('2048');
  const doMove = (dir) => setG(prev => {
    if (prev.over) return prev;
    const r = move2048(prev.board, dir);
    if (!r.moved) return prev;
    const board = addTile(r.board), score = prev.score + r.gained;
    submitBest(score);
    return { ...prev, board, score, won: prev.won || board.includes(2048), over: !canMove2048(board) };
  });
  useKeys((k) => { const m = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down' }[k]; if (m) doMove(m); });
  useEffect(() => { duel?.onScore?.(g.score); if (g.over) duel?.onEnd(g.score); }, [g.score, g.over]); // eslint-disable-line react-hooks/exhaustive-deps
  const swipe = useSwipe(doMove);
  const restart = () => setG({ board: t2048Start(), score: 0, over: false, won: false, keepGoing: false });
  return (
    <div className="gm-table">
      <StatBar><Stat label="Score" value={g.score} /><Stat label="Best" value={best ?? 0} /></StatBar>
      <div className="gm-stage" style={{ touchAction: 'none', maxWidth: 340 }} {...swipe}>
        <div className="gm-grid g2048" role="grid" aria-label="2048 board">
          {g.board.map((v, i) => (
            <div key={i} className="gm-tile" style={{ background: TILE_BG[v] || '#5ca8ff', fontSize: v >= 1024 ? 20 : v >= 128 ? 24 : 28, color: v <= 4 ? 'var(--text-hi)' : '#fff' }}>{v || ''}</div>
          ))}
        </div>
        {g.over && <Overlay title="No moves left" sub={`Score ${g.score}`} actions={<button type="button" className="gm-btn primary" onClick={restart}>New game</button>} />}
        {g.won && !g.keepGoing && !g.over && <Overlay title="You made 2048! 🎉" sub="Keep going for a higher score?" actions={<><button type="button" className="gm-btn primary" onClick={() => setG({ ...g, keepGoing: true })}>Keep going</button><button type="button" className="gm-btn" onClick={restart}>New game</button></>} />}
      </div>
      <div className="gm-dpad">
        {[['u', '▲', 'up'], ['l', '◀', 'left'], ['r', '▶', 'right'], ['d', '▼', 'down']].map(([a, s, d]) => <button key={a} type="button" className="gm-btn" style={{ gridArea: a }} onClick={() => doMove(d)} aria-label={d}>{s}</button>)}
      </div>
      <p className="gm-hint">Arrow keys / WASD or swipe. Equal tiles merge.</p>
    </div>
  );
}

/* ───────────────────────── Memory Match ───────────────────────── */
const EMOJI = ['🍕', '🚀', '🎸', '🐙', '🌈', '🍩', '⚽', '🦄', '🐢', '🍉', '🎲', '🔥'];
const memDeal = () => shuffle([...EMOJI.slice(0, 8), ...EMOJI.slice(0, 8)].map((e, i) => ({ id: i, e, up: false, done: false })));
export function MemoryMatch({ players = 1 }) {
  const [cards, setCards] = useState(memDeal);
  const [first, setFirst] = useState(null);
  const [lock, setLock] = useState(false);
  const [moves, setMoves] = useState(0);
  const [turn, setTurn] = useState(0);
  const [scores, setScores] = useState([0, 0]);
  const [best, submitBest] = useBest('memory-match', true);
  const later = useTimeouts();
  const done = cards.every(c => c.done);

  const flip = (id) => {
    if (lock || done) return;
    const c = cards.find(x => x.id === id);
    if (c.up || c.done) return;
    const next = cards.map(x => (x.id === id ? { ...x, up: true } : x));
    setCards(next);
    if (first === null) { setFirst(id); return; }
    setMoves(m => m + 1);
    const a = next.find(x => x.id === first), b = next.find(x => x.id === id);
    setFirst(null);
    if (a.e === b.e) {
      const after = next.map(x => (x.id === a.id || x.id === b.id ? { ...x, done: true } : x));
      setCards(after);
      const sc = scores.slice(); sc[turn] += 1; setScores(sc);
      if (after.every(x => x.done) && players === 1) submitBest(moves + 1);
    } else {
      setLock(true);
      later(() => { setCards(cs => cs.map(x => (x.id === a.id || x.id === b.id ? { ...x, up: false } : x))); setLock(false); if (players === 2) setTurn(t => 1 - t); }, 800);
    }
  };
  const restart = () => { setCards(memDeal()); setFirst(null); setLock(false); setMoves(0); setTurn(0); setScores([0, 0]); };
  const winner = scores[0] === scores[1] ? -1 : scores[0] > scores[1] ? 0 : 1;
  return (
    <div className="gm-table">
      <StatBar>
        {players === 2 ? <><Stat label={`P1${turn === 0 && !done ? ' ◀' : ''}`} value={scores[0]} /><Stat label={`P2${turn === 1 && !done ? ' ◀' : ''}`} value={scores[1]} /></> : <><Stat label="Moves" value={moves} /><Stat label="Best" value={best ?? '—'} /></>}
      </StatBar>
      <div className="gm-stage" style={{ maxWidth: 340 }}>
        <div className="gm-grid mem">
          {cards.map(c => (
            <button key={c.id} type="button" className={`gm-mem ${c.up || c.done ? 'up' : ''} ${c.done ? 'done' : ''}`} onClick={() => flip(c.id)} aria-label={c.up || c.done ? c.e : 'Hidden card'}>
              <span>{c.up || c.done ? c.e : '❔'}</span>
            </button>
          ))}
        </div>
        {done && <Overlay title={players === 2 ? (winner === -1 ? 'Draw!' : `P${winner + 1} wins! 🎉`) : 'Cleared! 🎉'} sub={players === 2 ? `${scores[0]} – ${scores[1]} pairs` : `${moves} moves`} actions={<button type="button" className="gm-btn primary" onClick={restart}>Play again</button>} />}
      </div>
      <p className="gm-hint">{players === 2 ? `Player ${turn + 1}'s turn. A match keeps your turn.` : 'Find all 8 pairs in as few moves as you can.'}</p>
    </div>
  );
}

/* ───────────────────────── Sliding Puzzle ───────────────────────── */
export function slideShuffle(n) {
  const b = Array.from({ length: n * n }, (_, i) => (i + 1) % (n * n)); // 1..n²-1, 0 = blank (last)
  let blank = n * n - 1, prev = -1;
  for (let k = 0; k < n * n * 25; k++) {
    const r = Math.floor(blank / n), c = blank % n, opts = [];
    if (r > 0) opts.push(blank - n); if (r < n - 1) opts.push(blank + n); if (c > 0) opts.push(blank - 1); if (c < n - 1) opts.push(blank + 1);
    const choices = opts.filter(o => o !== prev); const t = choices[rnd(choices.length)];
    b[blank] = b[t]; b[t] = 0; prev = blank; blank = t;
  }
  return isSolved(b) ? slideShuffle(n) : b; // never hand the player an already-solved board
}
export const isSolved = (b) => b.every((v, i) => (i === b.length - 1 ? v === 0 : v === i + 1));
export function SlidePuzzle({ duel }) {
  const [n, setN] = useState(3);
  const [b, setB] = useState(() => slideShuffle(3));
  const [moves, setMoves] = useState(0);
  const [best, submitBest] = useBest('slide-puzzle-3', true);
  const [best4, submitBest4] = useBest('slide-puzzle-4', true);
  const solved = moves > 0 && isSolved(b);
  useEffect(() => { if (solved) duel?.onEnd(); }, [solved]); // eslint-disable-line react-hooks/exhaustive-deps
  const newGame = (size = n) => { setN(size); setB(slideShuffle(size)); setMoves(0); };

  const tryMove = (i) => {
    if (solved) return;
    const blank = b.indexOf(0), r = Math.floor(i / n), c = i % n, br = Math.floor(blank / n), bc = blank % n;
    if (Math.abs(r - br) + Math.abs(c - bc) !== 1) return;
    const nb = b.slice(); nb[blank] = nb[i]; nb[i] = 0;
    setB(nb); setMoves(m => m + 1);
    if (isSolved(nb)) (n === 3 ? submitBest : submitBest4)(moves + 1);
  };
  useKeys((k) => {
    const d = { arrowup: [1, 0], w: [1, 0], arrowdown: [-1, 0], s: [-1, 0], arrowleft: [0, 1], a: [0, 1], arrowright: [0, -1], d: [0, -1] }[k];
    if (!d) return;
    const blank = b.indexOf(0), r = Math.floor(blank / n) + d[0], c = (blank % n) + d[1];
    if (r >= 0 && r < n && c >= 0 && c < n) tryMove(r * n + c);
  });
  const bestShown = n === 3 ? best : best4;
  return (
    <div className="gm-table">
      <StatBar><Stat label="Moves" value={moves} /><Stat label="Best" value={bestShown ?? '—'} /></StatBar>
      {!duel && <div className="gm-row">{[3, 4].map(s => <button key={s} type="button" className={`gm-btn ${n === s ? 'on' : ''}`} onClick={() => newGame(s)}>{s}×{s}</button>)}<button type="button" className="gm-btn" onClick={() => newGame()}>Shuffle</button></div>}
      <div className="gm-stage" style={{ maxWidth: 320 }}>
        <div className="gm-grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          {b.map((v, i) => (
            <button key={i} type="button" className={`gm-tile slide ${v ? '' : 'blank'} ${v === i + 1 ? 'ok' : ''}`} onClick={() => tryMove(i)} disabled={!v} aria-label={v ? `Tile ${v}` : 'Empty'}>{v || ''}</button>
          ))}
        </div>
        {solved && <Overlay title="Solved! 🎉" sub={`${moves} moves`} actions={duel ? null : <button type="button" className="gm-btn primary" onClick={() => newGame()}>New puzzle</button>} />}
      </div>
      <p className="gm-hint">Click a tile next to the gap (or use the arrow keys) to slide it. Put 1, 2, 3… in order.</p>
    </div>
  );
}

/* ───────────────────────── Lights Out ───────────────────────── */
const LO = 5;
export function loPress(b, i) {
  const n = b.slice(), r = Math.floor(i / LO), c = i % LO;
  for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < LO && cc >= 0 && cc < LO) n[rr * LO + cc] = !n[rr * LO + cc]; }
  return n;
}
// Start from all-off and apply random presses, so every puzzle is guaranteed solvable.
export function loGenerate(level) {
  let b = Array(LO * LO).fill(false);
  const presses = Math.min(5 + level * 2, 16);
  for (const i of shuffle([...Array(LO * LO).keys()]).slice(0, presses)) b = loPress(b, i);
  return b.some(Boolean) ? b : loGenerate(level);
}
export function LightsOut({ duel }) {
  const [level, setLevel] = useState(duel ? 4 : 1);
  const [b, setB] = useState(() => loGenerate(duel ? 4 : 1));
  const [moves, setMoves] = useState(0);
  const [best, submitBest] = useBest('lights-out');
  const solved = !b.some(Boolean);
  useEffect(() => { if (solved) { if (duel) duel.onEnd(); else submitBest(level); } }, [solved]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="gm-table">
      <StatBar><Stat label="Level" value={level} /><Stat label="Moves" value={moves} /><Stat label="Best level" value={best ?? 0} /></StatBar>
      <div className="gm-stage" style={{ maxWidth: 320 }}>
        <div className="gm-grid" style={{ gridTemplateColumns: `repeat(${LO}, 1fr)` }}>
          {b.map((on, i) => <button key={i} type="button" className={`gm-lo ${on ? 'on' : ''}`} onClick={() => { if (!solved) { setB(loPress(b, i)); setMoves(m => m + 1); } }} aria-label={on ? 'Light on' : 'Light off'} />)}
        </div>
        {solved && <Overlay title="All lights out! 💡" sub={`Level ${level} in ${moves} moves`} actions={duel ? null : <button type="button" className="gm-btn primary" onClick={() => { setLevel(level + 1); setB(loGenerate(level + 1)); setMoves(0); }}>Next level</button>} />}
      </div>
      {!duel && <div className="gm-row"><button type="button" className="gm-btn" onClick={() => { setB(loGenerate(level)); setMoves(0); }}>New puzzle</button></div>}
      <p className="gm-hint">Tapping a light flips it and its four neighbours. Turn every light off.</p>
    </div>
  );
}
