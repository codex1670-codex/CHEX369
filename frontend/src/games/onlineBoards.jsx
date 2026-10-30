import { useEffect, useRef, useState } from 'react';
import { PlayingCard } from './ui.jsx';
// Boards for the online (server-validated) party games. Each gets { room, myId, onMove }.
// The server owns all game state; these components only render it and send moves.
const nameOf = (room, id) => room.players.find((p) => p.user.id === id)?.user.displayName || 'Opponent';
const oppId = (room, myId) => room.players.find((p) => p.user.id !== myId)?.user.id;
const Scores = ({ room, myId, scores }) => {
  const opp = oppId(room, myId);
  return (
    <div className="gm-statbar" style={{ marginBottom: 12 }}>
      <div className="gm-stat"><span>You</span><b>{scores[myId] ?? 0}</b></div>
      <div className="gm-stat"><span>{nameOf(room, opp)}</span><b>{scores[opp] ?? 0}</b></div>
    </div>
  );
};

/* ───────── Dots & Boxes ───────── */
const N = 4, GAP = 62, PAD = 28;
export function DotsBoxesBoard({ room, myId, onMove }) {
  const { h, v, boxes, scores, turn, winner } = room.state;
  const canClick = turn === myId && !winner;
  const X = (c) => PAD + c * GAP, Y = (r) => PAD + r * GAP, size = PAD * 2 + GAP * N;
  const col = (id) => (id === myId ? 'var(--violet-bright)' : 'var(--pink)');
  return (
    <div style={{ maxWidth: size, margin: '0 auto' }}>
      <Scores room={room} myId={myId} scores={scores} />
      <svg viewBox={`0 0 ${size} ${size}`} className="gm-db" role="grid" aria-label="Dots and Boxes board">
        {boxes.map((o, i) => o && <rect key={i} x={X(i % N) + 4} y={Y(Math.floor(i / N)) + 4} width={GAP - 8} height={GAP - 8} rx="8" fill={col(o)} opacity=".35" />)}
        {h.map((on, i) => { const r = Math.floor(i / N), c = i % N; return (
          <g key={`h${i}`}><line x1={X(c) + 6} y1={Y(r)} x2={X(c + 1) - 6} y2={Y(r)} stroke={on ? 'var(--text-hi)' : 'var(--border-soft)'} strokeWidth={on ? 5 : 3} strokeLinecap="round" />
            {!on && canClick && <rect x={X(c) + 4} y={Y(r) - 12} width={GAP - 8} height="24" fill="transparent" className="gm-edge" tabIndex={0} role="button" aria-label={`Top line row ${r + 1} column ${c + 1}`} onClick={() => onMove({ kind: 'h', r, c })} onKeyDown={(e) => e.key === 'Enter' && onMove({ kind: 'h', r, c })} />}</g>); })}
        {v.map((on, i) => { const r = Math.floor(i / (N + 1)), c = i % (N + 1); return (
          <g key={`v${i}`}><line x1={X(c)} y1={Y(r) + 6} x2={X(c)} y2={Y(r + 1) - 6} stroke={on ? 'var(--text-hi)' : 'var(--border-soft)'} strokeWidth={on ? 5 : 3} strokeLinecap="round" />
            {!on && canClick && <rect x={X(c) - 12} y={Y(r) + 4} width="24" height={GAP - 8} fill="transparent" className="gm-edge" tabIndex={0} role="button" aria-label={`Left line row ${r + 1} column ${c + 1}`} onClick={() => onMove({ kind: 'v', r, c })} onKeyDown={(e) => e.key === 'Enter' && onMove({ kind: 'v', r, c })} />}</g>); })}
        {Array.from({ length: (N + 1) ** 2 }, (_, i) => <circle key={i} cx={X(i % (N + 1))} cy={Y(Math.floor(i / (N + 1)))} r="5" fill="var(--text-mid)" />)}
      </svg>
      <div className="gm-hint" style={{ marginTop: 8 }}>Close a box to go again.</div>
    </div>
  );
}

/* ───────── Rock Paper Scissors ───────── */
const RPS = [{ k: 'rock', e: '✊' }, { k: 'paper', e: '✋' }, { k: 'scissors', e: '✌️' }];
const em = (k) => RPS.find((x) => x.k === k)?.e;
export function RpsBoard({ room, myId, onMove }) {
  const { scores, turn, picked, last, round, winner } = room.state;
  const opp = oppId(room, myId);
  const myTurn = turn === myId && !winner;
  return (
    <div className="gm-table">
      <Scores room={room} myId={myId} scores={scores} />
      {last && (
        <div className="gm-row gm-faceoff" aria-live="polite">
          <div><div className="gm-label">You</div><div className="gm-rps big">{em(last.picks[myId])}</div></div>
          <div className="gm-vs">VS</div>
          <div><div className="gm-label">{nameOf(room, opp)}</div><div className="gm-rps big">{em(last.picks[opp])}</div></div>
        </div>
      )}
      {last && <p className="gm-result">{last.winner === 'tie' ? 'Last round: tie!' : last.winner === myId ? 'You won the last round!' : 'You lost the last round.'}</p>}
      {!winner && (
        <>
          <p className="gm-result">Round {round} · first to 3. {picked[myId] ? 'Locked in — waiting for your opponent…' : myTurn ? 'Pick in secret:' : 'Your opponent is picking…'}</p>
          <div className="gm-row">{RPS.map((x) => <button key={x.k} type="button" className="gm-btn gm-rps" disabled={!myTurn || picked[myId]} onClick={() => onMove({ pick: x.k })} aria-label={x.k}>{x.e}</button>)}</div>
          <div className="gm-hint">Picks stay hidden on the server until both players have chosen.</div>
        </>
      )}
    </div>
  );
}

/* ───────── Pig Dice ───────── */
const FACE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
export function PigDiceBoard({ room, myId, onMove }) {
  const { scores, pts, roll, lastEvent, turn, winner } = room.state;
  const myTurn = turn === myId && !winner;
  const who = (id) => (id === myId ? 'You' : nameOf(room, id));
  const msg = !lastEvent ? 'Roll the die. Roll a 1 and you lose the turn’s points!'
    : lastEvent.type === 'bust' ? `${who(lastEvent.by)} rolled a 1 — turn lost!`
    : lastEvent.type === 'hold' ? `${who(lastEvent.by)} banked ${lastEvent.value}.`
    : `${who(lastEvent.by)} rolled a ${lastEvent.value}.`;
  return (
    <div className="gm-table">
      <Scores room={room} myId={myId} scores={scores} />
      <div className="gm-stat"><span>This turn</span><b>{pts}</b></div>
      <div className="gm-die" aria-label={roll ? `Rolled ${roll}` : 'No roll yet'}>{roll ? FACE[roll - 1] : '🎲'}</div>
      <p className="gm-result">{msg}</p>
      <div className="gm-row">
        <button type="button" className="gm-btn primary" disabled={!myTurn} onClick={() => onMove({ action: 'roll' })}>Roll</button>
        <button type="button" className="gm-btn" disabled={!myTurn || pts === 0} onClick={() => onMove({ action: 'hold' })}>Hold ({pts})</button>
      </div>
      <div className="gm-hint">First to 50 wins. The server rolls the die.</div>
    </div>
  );
}

/* ───────── Memory Match ───────── */
export function MemoryBoard({ room, myId, onMove }) {
  const { board, matched, scores, turn, winner } = room.state;
  const myTurn = turn === myId && !winner;
  return (
    <div className="gm-table">
      <Scores room={room} myId={myId} scores={scores} />
      <div className="gm-stage" style={{ maxWidth: 340 }}>
        <div className="gm-grid mem">
          {board.map((face, i) => (
            <button key={i} type="button" className={`gm-mem ${face ? 'up' : ''} ${matched[i] ? 'done' : ''}`} disabled={!myTurn || matched[i] || !!face} onClick={() => onMove({ cell: i })} aria-label={face || 'Hidden card'}>
              <span>{face || '❔'}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="gm-hint">A match keeps your turn. A miss passes it on.</div>
    </div>
  );
}

/* ───────── Trivia Duel ───────── */
export function TriviaBoard({ room, myId, onMove }) {
  const { question, index, total, scores, last, turn, winner } = room.state;
  const myTurn = turn === myId && !winner;
  return (
    <div className="gm-table">
      <Scores room={room} myId={myId} scores={scores} />
      <div className="gm-hint">Question {Math.min(index + 1, total)} of {total}</div>
      {last && <p className="gm-result">{last.by === myId ? 'You' : nameOf(room, last.by)} {last.correct ? 'got the last one right ✓' : 'missed the last one ✗'}</p>}
      {!winner && (
        <div className="gm-stage" style={{ maxWidth: 480 }}>
          <p className="gm-question">{question.q}</p>
          <div className="gm-options">
            {question.options.map((o, i) => <button key={o} type="button" className="gm-btn gm-opt" disabled={!myTurn} onClick={() => onMove({ choice: i })}>{o}</button>)}
          </div>
          <div className="gm-hint">{myTurn ? 'Your question!' : 'Waiting for your opponent to answer…'}</div>
        </div>
      )}
    </div>
  );
}

/* ───────── Card War ───────── */
export function WarBoard({ room, myId, onMove }) {
  const { scores, last, left, turn, winner, pot } = room.state;
  const opp = oppId(room, myId);
  const myTurn = turn === myId && !winner;
  return (
    <div className="gm-table">
      <Scores room={room} myId={myId} scores={scores} />
      <div className="gm-row gm-faceoff">
        <div><div className="gm-label">You</div>{last ? <PlayingCard card={last.cards[myId]} /> : <PlayingCard faceDown />}</div>
        <div className="gm-vs">VS</div>
        <div><div className="gm-label">{nameOf(room, opp)}</div>{last ? <PlayingCard card={last.cards[opp]} /> : <PlayingCard faceDown />}</div>
      </div>
      <p className="gm-result">{!last ? 'Flip a card!' : last.winner === 'war' ? `War! The next winner takes ${pot + 1} points.` : last.winner === myId ? 'You win the round!' : `${nameOf(room, opp)} wins the round.`}</p>
      <button type="button" className="gm-btn primary" disabled={!myTurn} onClick={() => onMove({ flip: true })}>{myTurn ? 'Flip!' : 'Waiting for your opponent…'}</button>
      <div className="gm-hint">{left} cards left. Players take turns flipping.</div>
    </div>
  );
}

/* ───────── Higher or Lower ───────── */
export function HiLoBoard({ room, myId, onMove }) {
  const { card, streak, alive, last, turn, winner } = room.state;
  const opp = oppId(room, myId);
  const myTurn = turn === myId && !winner && alive[myId];
  const msg = !last ? 'Will the next card be higher or lower?'
    : last.result === 'push' ? 'Same rank — a push!'
    : `${last.by === myId ? 'You' : nameOf(room, last.by)} guessed ${last.guess}: ${last.result === 'right' ? 'correct 🔥' : `wrong — it was ${last.to.r}`}`;
  return (
    <div className="gm-table">
      <Scores room={room} myId={myId} scores={streak} />
      <div className="gm-row">
        {last && <div><div className="gm-label">Before</div><PlayingCard card={last.from} small /></div>}
        <div><div className="gm-label">Now</div><PlayingCard card={card} /></div>
      </div>
      <p className="gm-result">{msg}</p>
      {!alive[myId] && !winner && <p className="gm-hint">You’re out — watching {nameOf(room, opp)} try to beat your streak of {streak[myId]}.</p>}
      <div className="gm-row">
        <button type="button" className="gm-btn primary" disabled={!myTurn} onClick={() => onMove({ guess: 'higher' })}>▲ Higher</button>
        <button type="button" className="gm-btn" disabled={!myTurn} onClick={() => onMove({ guess: 'lower' })}>▼ Lower</button>
      </div>
      <div className="gm-hint">A correct guess keeps your turn. One wrong guess and you’re out — longest streak wins.</div>
    </div>
  );
}

/* ───────── Simon ───────── */
const PADS = ['#ff5c93', '#26e0c9', '#ffb84d', '#3f6fe0'];
export function SimonBoard({ room, myId, onMove }) {
  const { seq, turn, round, last, winner } = room.state;
  const myTurn = turn === myId && !winner;
  const [phase, setPhase] = useState('show'); // show | input | wait
  const [lit, setLit] = useState(-1);
  const entered = useRef([]);
  const timers = useRef([]);
  useEffect(() => {
    timers.current.forEach(clearTimeout); timers.current = []; entered.current = [];
    if (winner) { setPhase('wait'); return undefined; }
    setPhase('show');
    const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
    seq.forEach((c, i) => { later(() => setLit(c), 600 + i * 650); later(() => setLit(-1), 600 + i * 650 + 400); });
    later(() => setPhase(myTurn ? 'input' : 'wait'), 600 + seq.length * 650);
    return () => timers.current.forEach(clearTimeout);
  }, [round, turn, winner]); // eslint-disable-line react-hooks/exhaustive-deps
  const press = (c) => {
    if (phase !== 'input') return;
    setLit(c); setTimeout(() => setLit(-1), 180);
    entered.current.push(c);
    if (entered.current.length === seq.length) { setPhase('wait'); onMove({ seq: entered.current.slice() }); }
  };
  return (
    <div className="gm-table">
      <div className="gm-statbar"><div className="gm-stat"><span>Round</span><b>{round}</b></div><div className="gm-stat"><span>Turn</span><b>{myTurn ? 'You' : nameOf(room, turn)}</b></div></div>
      <div className="gm-stage" style={{ maxWidth: 300 }}>
        <div className="gm-simon">{PADS.map((c, i) => <button key={i} type="button" aria-label={`Pad ${i + 1}`} disabled={phase !== 'input'} onClick={() => press(i)} className={`gm-pad ${lit === i ? 'lit' : ''}`} style={{ '--pad': c }} />)}</div>
      </div>
      <p className="gm-result">{winner ? '' : phase === 'show' ? 'Watch the pattern…' : phase === 'input' ? 'Your turn — repeat it!' : `Waiting for ${nameOf(room, turn)}…`}</p>
      {last && !winner && <div className="gm-hint">{last.by === myId ? 'You' : nameOf(room, last.by)} repeated it correctly. The pattern grows by one.</div>}
    </div>
  );
}

/* ───────── Truth or Dare ───────── */
export function TodBoard({ room, myId, onMove }) {
  const { turn, phase, kind, prompt, count } = room.state;
  const myTurn = turn === myId;
  return (
    <div className="gm-table">
      <div className="gm-bottle">{myTurn ? 'Your turn' : `${nameOf(room, turn)}’s turn`}</div>
      {phase === 'pick' ? (
        <>
          <p className="gm-result">{myTurn ? 'Truth or dare?' : `${nameOf(room, turn)} is choosing…`}</p>
          <div className="gm-row">
            <button type="button" className="gm-btn primary" disabled={!myTurn} onClick={() => onMove({ choose: 'truth' })}>Truth</button>
            <button type="button" className="gm-btn primary" disabled={!myTurn} onClick={() => onMove({ choose: 'dare' })}>Dare</button>
            <button type="button" className="gm-btn" disabled={!myTurn} onClick={() => onMove({ choose: 'random' })}>Surprise me</button>
          </div>
        </>
      ) : (
        <>
          <div className="gm-label">{kind}</div>
          <p className="gm-question" style={{ maxWidth: 420 }}>{prompt}</p>
          <div className="gm-row">
            <button type="button" className="gm-btn primary" disabled={!myTurn} onClick={() => onMove({ next: true })}>Done — next player</button>
            <button type="button" className="gm-btn" disabled={!myTurn} onClick={() => onMove({ skip: true })}>Skip prompt</button>
          </div>
        </>
      )}
      <div className="gm-hint">Round {count + 1}. Prompts are friendly and skippable. Talk on a call or in person while you play!</div>
    </div>
  );
}

/* ───────── Crazy Eights (you only ever receive your own hand) ───────── */
const SUITS = ['♠', '♥', '♦', '♣'];
const red = (s) => s === '♥' || s === '♦';
export function EightsBoard({ room, myId, onMove }) {
  const { hand = [], top, suit, counts, drawCount, turn, drew, last, winner } = room.state;
  const opp = oppId(room, myId);
  const myTurn = turn === myId && !winner;
  const [choosing, setChoosing] = useState(null);
  const playable = (c) => c.r === '8' || c.s === suit || c.r === top.r;
  const anyPlayable = hand.some(playable);
  useEffect(() => { if (!myTurn) setChoosing(null); }, [myTurn]);
  const msg = last ? (last.type === 'play' ? `${last.by === myId ? 'You' : nameOf(room, last.by)} played ${last.card.r}${last.card.s}${last.card.r === '8' ? ` and chose ${last.suit}` : ''}.` : last.type === 'pass' ? `${last.by === myId ? 'You' : nameOf(room, last.by)} passed.` : `${last.by === myId ? 'You' : nameOf(room, last.by)} drew a card.`) : 'Match the suit or the rank. Eights are wild.';
  return (
    <div className="gm-table">
      <div className="gm-statbar">
        <div className="gm-stat"><span>{nameOf(room, opp)}</span><b>{counts?.[opp] ?? 0} cards</b></div>
        <div className="gm-stat"><span>Draw pile</span><b>{drawCount}</b></div>
        <div className="gm-stat"><span>Suit</span><b style={{ color: red(suit) ? '#ff5c93' : undefined }}>{suit}</b></div>
      </div>
      <div className="gm-hand">{Array.from({ length: counts?.[opp] ?? 0 }).map((_, i) => <PlayingCard key={i} faceDown small />)}</div>
      <div className="gm-row"><PlayingCard faceDown small /><PlayingCard card={top} /></div>
      <p className="gm-result">{winner ? '' : myTurn ? (drew ? 'You drew a playable card — play it or pass.' : msg) : `${nameOf(room, turn)} is thinking…`}</p>
      {choosing && <div className="gm-row"><span className="gm-hint">Choose a suit:</span>{SUITS.map(s => <button key={s} type="button" className="gm-btn" style={{ color: red(s) ? '#ff5c93' : undefined, fontSize: 20 }} onClick={() => { onMove({ play: choosing, suit: s }); setChoosing(null); }}>{s}</button>)}</div>}
      <div className="gm-hand">
        {hand.map(c => <PlayingCard key={c.id} card={c} disabled={!myTurn || !playable(c) || !!choosing} highlight={myTurn && playable(c)} dim={myTurn && !playable(c)}
          onClick={() => (c.r === '8' ? setChoosing(c.id) : onMove({ play: c.id }))} />)}
      </div>
      <div className="gm-row">
        <button type="button" className="gm-btn" disabled={!myTurn || anyPlayable || drew || !!choosing} onClick={() => onMove({ draw: true })}>Draw a card</button>
        {drew && myTurn && <button type="button" className="gm-btn" onClick={() => onMove({ pass: true })}>Pass</button>}
      </div>
    </div>
  );
}
