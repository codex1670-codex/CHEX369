import { useEffect, useState } from 'react';
import { Overlay, Stat, StatBar, pick, rnd, shuffle, useTimeouts, rand } from './ui.jsx';

/* ───────────────────────── Tic-Tac-Toe ───────────────────────── */
const T_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export function tttResult(b) {
  for (const l of T_LINES) if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[1]] === b[l[2]]) return { mark: b[l[0]], line: l };
  return b.every(Boolean) ? { mark: 'draw', line: [] } : null;
}
export function tttCpu(b, me = 'O', foe = 'X') {
  const empty = b.map((v, i) => (v ? -1 : i)).filter(i => i >= 0);
  const tryMark = (m) => empty.find(i => { const t = b.slice(); t[i] = m; return tttResult(t)?.mark === m; });
  const w = tryMark(me); if (w !== undefined) return w;
  const bl = tryMark(foe); if (bl !== undefined) return bl;
  if (b[4] === null && rand() < 0.85) return 4;
  return pick(empty);
}
export function TicTacToe({ players = 1 }) {
  const [b, setB] = useState(Array(9).fill(null));
  const [turn, setTurn] = useState('X');
  const [score, setScore] = useState({ X: 0, O: 0, draw: 0 });
  const [starter, setStarter] = useState('X');
  const res = tttResult(b);
  const cpuTurn = players === 1 && turn === 'O' && !res;

  const place = (i, mark) => {
    if (b[i] || res) return;
    const nb = b.slice(); nb[i] = mark; setB(nb);
    const r = tttResult(nb);
    if (r) setScore(s => ({ ...s, [r.mark]: s[r.mark] + 1 })); else setTurn(mark === 'X' ? 'O' : 'X');
  };
  useEffect(() => {
    if (!cpuTurn) return undefined;
    const t = setTimeout(() => place(tttCpu(b), 'O'), 450);
    return () => clearTimeout(t);
  }, [cpuTurn, b]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = () => { const s = starter === 'X' ? 'O' : 'X'; setStarter(s); setTurn(s); setB(Array(9).fill(null)); };
  const names = { X: players === 2 ? 'P1 (X)' : 'You (X)', O: players === 2 ? 'P2 (O)' : 'CPU (O)' };
  return (
    <div className="gm-table">
      <StatBar><Stat label={names.X} value={score.X} /><Stat label="Draws" value={score.draw} /><Stat label={names.O} value={score.O} /></StatBar>
      <p className="gm-result">{res ? (res.mark === 'draw' ? "It's a draw!" : `${names[res.mark]} wins!`) : cpuTurn ? 'CPU is thinking…' : `${names[turn]} to play`}</p>
      <div className="gm-grid ttt" role="grid" aria-label="Tic-Tac-Toe board">
        {b.map((v, i) => (
          <button key={i} type="button" className={`gm-ttt ${res?.line.includes(i) ? 'win' : ''} ${v === 'X' ? 'x' : 'o'}`} disabled={!!v || !!res || cpuTurn}
            onClick={() => place(i, turn)} aria-label={v ? `${v}` : `Cell ${i + 1}, empty`}>{v}</button>
        ))}
      </div>
      {res && <button type="button" className="gm-btn primary" onClick={next}>Next round</button>}
    </div>
  );
}

/* ───────────────────────── Connect Four ───────────────────────── */
const C4 = { cols: 7, rows: 6 };
export function c4Drop(board, col, mark) {
  for (let r = C4.rows - 1; r >= 0; r--) if (!board[r * C4.cols + col]) { const nb = board.slice(); nb[r * C4.cols + col] = mark; return { board: nb, cell: r * C4.cols + col }; }
  return null;
}
export function c4Result(board) {
  const g = (r, c) => (r < 0 || r >= C4.rows || c < 0 || c >= C4.cols ? null : board[r * C4.cols + c]);
  for (let r = 0; r < C4.rows; r++) for (let c = 0; c < C4.cols; c++) {
    const m = g(r, c); if (!m) continue;
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      if ([1, 2, 3].every(k => g(r + dr * k, c + dc * k) === m)) return { mark: m, cells: [0, 1, 2, 3].map(k => (r + dr * k) * C4.cols + c + dc * k) };
    }
  }
  return board.every(Boolean) ? { mark: 'draw', cells: [] } : null;
}
export function c4Cpu(board, me = 'Y', foe = 'R') {
  const cols = [...Array(C4.cols).keys()].filter(c => !board[c]);
  const wins = (m) => cols.find(c => c4Result(c4Drop(board, c, m).board)?.mark === m);
  let c = wins(me); if (c !== undefined) return c;
  c = wins(foe); if (c !== undefined) return c;
  // avoid moves that let the opponent win right away
  const safe = cols.filter(col => { const d = c4Drop(board, col, me).board; return !([...Array(C4.cols).keys()].filter(x => !d[x]).some(x => c4Result(c4Drop(d, x, foe).board)?.mark === foe)); });
  const pool = safe.length ? safe : cols;
  return pool.sort((a, b) => Math.abs(3 - a) - Math.abs(3 - b) + (rand() - 0.5))[0];
}
export function ConnectFour({ players = 1 }) {
  const [b, setB] = useState(Array(C4.rows * C4.cols).fill(null));
  const [turn, setTurn] = useState('R');
  const [score, setScore] = useState({ R: 0, Y: 0, draw: 0 });
  const [starter, setStarter] = useState('R');
  const res = c4Result(b);
  const cpuTurn = players === 1 && turn === 'Y' && !res;
  const names = { R: players === 2 ? 'P1 (red)' : 'You (red)', Y: players === 2 ? 'P2 (yellow)' : 'CPU (yellow)' };

  const drop = (col, mark) => {
    if (res) return;
    const d = c4Drop(b, col, mark); if (!d) return;
    setB(d.board);
    const r = c4Result(d.board);
    if (r) setScore(s => ({ ...s, [r.mark]: s[r.mark] + 1 })); else setTurn(mark === 'R' ? 'Y' : 'R');
  };
  useEffect(() => {
    if (!cpuTurn) return undefined;
    const t = setTimeout(() => drop(c4Cpu(b), 'Y'), 550);
    return () => clearTimeout(t);
  }, [cpuTurn, b]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = () => { const s = starter === 'R' ? 'Y' : 'R'; setStarter(s); setTurn(s); setB(Array(C4.rows * C4.cols).fill(null)); };
  return (
    <div className="gm-table">
      <StatBar><Stat label={names.R} value={score.R} /><Stat label="Draws" value={score.draw} /><Stat label={names.Y} value={score.Y} /></StatBar>
      <p className="gm-result">{res ? (res.mark === 'draw' ? "It's a draw!" : `${names[res.mark]} wins!`) : cpuTurn ? 'CPU is thinking…' : `${names[turn]} — pick a column`}</p>
      <div className="gm-grid c4" role="grid" aria-label="Connect Four board">
        {b.map((v, i) => (
          <button key={i} type="button" className={`gm-c4 ${v === 'R' ? 'r' : v === 'Y' ? 'y' : ''} ${res?.cells.includes(i) ? 'win' : ''}`}
            disabled={!!res || cpuTurn} onClick={() => drop(i % C4.cols, turn)} aria-label={`Column ${(i % C4.cols) + 1}${v ? `, ${v === 'R' ? 'red' : 'yellow'}` : ''}`} />
        ))}
      </div>
      {res && <button type="button" className="gm-btn primary" onClick={next}>Next round</button>}
    </div>
  );
}

/* ───────────────────────── Dots & Boxes ───────────────────────── */
const DB = { n: 4, gap: 62, pad: 28 };           // 4×4 boxes (5×5 dots)
const hIdx = (r, c) => r * DB.n + c;              // horizontal edges: (n+1) rows × n cols
const vIdx = (r, c) => r * (DB.n + 1) + c;        // vertical edges:   n rows × (n+1) cols
export const dbSides = (h, v, r, c) => [h[hIdx(r, c)], h[hIdx(r + 1, c)], v[vIdx(r, c)], v[vIdx(r, c + 1)]].filter(Boolean).length;
export function dbApply(state, kind, r, c, who) {
  const h = state.h.slice(), v = state.v.slice(), boxes = state.boxes.slice();
  (kind === 'h' ? h : v)[kind === 'h' ? hIdx(r, c) : vIdx(r, c)] = true;
  let got = 0;
  for (let br = 0; br < DB.n; br++) for (let bc = 0; bc < DB.n; bc++) if (boxes[br * DB.n + bc] === null && dbSides(h, v, br, bc) === 4) { boxes[br * DB.n + bc] = who; got++; }
  return { h, v, boxes, got };
}
export function dbMoves(state) {
  const m = [];
  for (let r = 0; r <= DB.n; r++) for (let c = 0; c < DB.n; c++) if (!state.h[hIdx(r, c)]) m.push(['h', r, c]);
  for (let r = 0; r < DB.n; r++) for (let c = 0; c <= DB.n; c++) if (!state.v[vIdx(r, c)]) m.push(['v', r, c]);
  return m;
}
export function dbCpu(state) {
  const moves = dbMoves(state);
  const scoring = moves.filter(([k, r, c]) => dbApply(state, k, r, c, 1).got > 0);
  if (scoring.length) return pick(scoring);
  const safe = moves.filter(([k, r, c]) => { const n = dbApply(state, k, r, c, 1); for (let br = 0; br < DB.n; br++) for (let bc = 0; bc < DB.n; bc++) if (dbSides(n.h, n.v, br, bc) === 3) return false; return true; });
  return pick(safe.length ? safe : moves);
}
const dbFresh = () => ({ h: Array((DB.n + 1) * DB.n).fill(false), v: Array(DB.n * (DB.n + 1)).fill(false), boxes: Array(DB.n * DB.n).fill(null) });
export function DotsBoxes({ players = 1 }) {
  const [s, setS] = useState(dbFresh);
  const [turn, setTurn] = useState(0);
  const names = ['P1', players === 2 ? 'P2' : 'CPU'];
  const scores = [0, 1].map(p => s.boxes.filter(x => x === p).length);
  const over = s.boxes.every(x => x !== null);
  const cpuTurn = players === 1 && turn === 1 && !over;

  const play = (kind, r, c) => {
    if (over) return;
    const n = dbApply(s, kind, r, c, turn);
    setS({ h: n.h, v: n.v, boxes: n.boxes });
    if (!n.got) setTurn(t => 1 - t);
  };
  useEffect(() => {
    if (!cpuTurn) return undefined;
    const t = setTimeout(() => { const [k, r, c] = dbCpu(s); play(k, r, c); }, 500);
    return () => clearTimeout(t);
  }, [cpuTurn, s]); // eslint-disable-line react-hooks/exhaustive-deps

  const size = DB.pad * 2 + DB.gap * DB.n;
  const X = (c) => DB.pad + c * DB.gap, Y = (r) => DB.pad + r * DB.gap;
  const color = ['var(--violet-bright)', 'var(--pink)'];
  const canClick = !over && !cpuTurn;
  return (
    <div className="gm-table">
      <StatBar><Stat label={`${names[0]}${turn === 0 && !over ? ' ◀' : ''}`} value={scores[0]} /><Stat label={`${names[1]}${turn === 1 && !over ? ' ◀' : ''}`} value={scores[1]} /></StatBar>
      <div className="gm-stage" style={{ maxWidth: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="gm-db" role="grid" aria-label="Dots and Boxes board">
          {s.boxes.map((o, i) => o !== null && <rect key={i} x={X(i % DB.n) + 4} y={Y(Math.floor(i / DB.n)) + 4} width={DB.gap - 8} height={DB.gap - 8} rx="8" fill={color[o]} opacity=".35" />)}
          {s.boxes.map((o, i) => o !== null && <text key={`t${i}`} x={X(i % DB.n) + DB.gap / 2} y={Y(Math.floor(i / DB.n)) + DB.gap / 2 + 6} textAnchor="middle" fontSize="18" fontWeight="700" fill={color[o]}>{names[o][1] === '1' ? '1' : players === 2 ? '2' : 'C'}</text>)}
          {Array.from({ length: (DB.n + 1) * DB.n }, (_, i) => { const r = Math.floor(i / DB.n), c = i % DB.n, on = s.h[i]; return (
            <g key={`h${i}`}><line x1={X(c) + 6} y1={Y(r)} x2={X(c + 1) - 6} y2={Y(r)} stroke={on ? 'var(--text-hi)' : 'var(--border-soft)'} strokeWidth={on ? 5 : 3} strokeLinecap="round" />
              {!on && canClick && <rect x={X(c) + 4} y={Y(r) - 12} width={DB.gap - 8} height="24" fill="transparent" className="gm-edge" tabIndex={0} role="button" aria-label={`Top line, row ${r + 1} column ${c + 1}`} onClick={() => play('h', r, c)} onKeyDown={(e) => e.key === 'Enter' && play('h', r, c)} />}</g>); })}
          {Array.from({ length: DB.n * (DB.n + 1) }, (_, i) => { const r = Math.floor(i / (DB.n + 1)), c = i % (DB.n + 1), on = s.v[i]; return (
            <g key={`v${i}`}><line x1={X(c)} y1={Y(r) + 6} x2={X(c)} y2={Y(r + 1) - 6} stroke={on ? 'var(--text-hi)' : 'var(--border-soft)'} strokeWidth={on ? 5 : 3} strokeLinecap="round" />
              {!on && canClick && <rect x={X(c) - 12} y={Y(r) + 4} width="24" height={DB.gap - 8} fill="transparent" className="gm-edge" tabIndex={0} role="button" aria-label={`Left line, row ${r + 1} column ${c + 1}`} onClick={() => play('v', r, c)} onKeyDown={(e) => e.key === 'Enter' && play('v', r, c)} />}</g>); })}
          {Array.from({ length: (DB.n + 1) ** 2 }, (_, i) => <circle key={`d${i}`} cx={X(i % (DB.n + 1))} cy={Y(Math.floor(i / (DB.n + 1)))} r="5" fill="var(--text-mid)" />)}
        </svg>
        {over && <Overlay title={scores[0] === scores[1] ? 'Draw!' : `${names[scores[0] > scores[1] ? 0 : 1]} wins! 🎉`} sub={`${scores[0]} – ${scores[1]} boxes`} actions={<button type="button" className="gm-btn primary" onClick={() => { setS(dbFresh()); setTurn(0); }}>Play again</button>} />}
      </div>
      <p className="gm-hint">{cpuTurn ? 'CPU is thinking…' : `${names[turn]}: draw a line between two dots. Close a box to go again.`}</p>
    </div>
  );
}

/* ───────────────────────── Rock Paper Scissors ───────────────────────── */
const RPS = [{ k: 'rock', e: '✊', beats: 'scissors' }, { k: 'paper', e: '✋', beats: 'rock' }, { k: 'scissors', e: '✌️', beats: 'paper' }];
export const rpsWinner = (a, b) => (a === b ? -1 : RPS.find(x => x.k === a).beats === b ? 0 : 1);
export function RockPaperScissors({ players = 1 }) {
  const [phase, setPhase] = useState('p1'); // p1 | pass | p2 | reveal
  const [picks, setPicks] = useState([null, null]);
  const [score, setScore] = useState([0, 0]);
  const GOAL = 3;
  const names = ['P1', players === 2 ? 'P2' : 'CPU'];
  const matchOver = score[0] >= GOAL || score[1] >= GOAL;
  const emoji = (k) => RPS.find(x => x.k === k).e;

  const reveal = (a, b) => {
    const w = rpsWinner(a, b);
    setPicks([a, b]); setPhase('reveal');
    if (w >= 0) setScore(s => { const n = s.slice(); n[w]++; return n; });
  };
  const choose = (k) => {
    if (phase === 'p1') { if (players === 1) reveal(k, pick(RPS).k); else { setPicks([k, null]); setPhase('pass'); } }
    else if (phase === 'p2') reveal(picks[0], k);
  };
  const w = phase === 'reveal' ? rpsWinner(picks[0], picks[1]) : null;
  const again = () => { setPicks([null, null]); setPhase('p1'); };
  return (
    <div className="gm-table">
      <StatBar><Stat label={players === 1 ? 'You' : names[0]} value={score[0]} /><Stat label="First to" value={GOAL} /><Stat label={names[1]} value={score[1]} /></StatBar>
      {phase === 'reveal' ? (
        <>
          <div className="gm-row gm-faceoff"><div className="gm-rps big">{emoji(picks[0])}</div><div className="gm-vs">VS</div><div className="gm-rps big">{emoji(picks[1])}</div></div>
          <p className="gm-result">{w === -1 ? 'Tie — go again!' : `${players === 1 && w === 0 ? 'You win' : players === 1 ? 'CPU wins' : `${names[w]} wins`} the round!`}</p>
          {!matchOver && <button type="button" className="gm-btn primary" onClick={again}>Next round</button>}
        </>
      ) : phase === 'pass' ? (
        <div className="gm-center"><p className="gm-result">P1 has chosen. Hand the device to Player 2 and don’t peek!</p><button type="button" className="gm-btn primary" onClick={() => setPhase('p2')}>I’m Player 2</button></div>
      ) : (
        <>
          <p className="gm-result">{players === 2 ? `${phase === 'p1' ? 'Player 1' : 'Player 2'}: choose in secret` : 'Choose your move'}</p>
          <div className="gm-row">{RPS.map(x => <button key={x.k} type="button" className="gm-btn gm-rps" onClick={() => choose(x.k)} aria-label={x.k}>{x.e}</button>)}</div>
        </>
      )}
      {matchOver && <Overlay title={players === 1 ? (score[0] > score[1] ? 'You win the match! 🎉' : 'CPU wins the match') : `${names[score[0] > score[1] ? 0 : 1]} wins the match! 🎉`} sub={`${score[0]} – ${score[1]}`} actions={<button type="button" className="gm-btn primary" onClick={() => { setScore([0, 0]); again(); }}>Rematch</button>} />}
    </div>
  );
}
