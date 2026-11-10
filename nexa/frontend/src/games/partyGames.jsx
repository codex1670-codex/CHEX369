import { useEffect, useRef, useState } from 'react';
import { Overlay, Stat, StatBar, pick, rnd, shuffle, useBest, useTimeouts, rand } from './ui.jsx';

/* ───────────────────────── Trivia Quiz ───────────────────────── */
// [question, correct answer, three wrong answers]
export const TRIVIA = [
  ['What is the capital of Australia?', 'Canberra', ['Sydney', 'Melbourne', 'Perth']],
  ['Which planet is known as the Red Planet?', 'Mars', ['Venus', 'Jupiter', 'Mercury']],
  ['How many continents are there?', '7', ['5', '6', '8']],
  ['Which is the largest ocean?', 'Pacific Ocean', ['Atlantic Ocean', 'Indian Ocean', 'Arctic Ocean']],
  ['Who painted the Mona Lisa?', 'Leonardo da Vinci', ['Pablo Picasso', 'Vincent van Gogh', 'Michelangelo']],
  ['What is the chemical symbol for gold?', 'Au', ['Ag', 'Gd', 'Go']],
  ['What is the hardest natural substance?', 'Diamond', ['Quartz', 'Granite', 'Steel']],
  ['Which is the largest mammal?', 'Blue whale', ['African elephant', 'Giraffe', 'Great white shark']],
  ['Which is the fastest land animal?', 'Cheetah', ['Lion', 'Horse', 'Leopard']],
  ['How many sides does a hexagon have?', '6', ['5', '7', '8']],
  ['Which gas do plants absorb from the air?', 'Carbon dioxide', ['Oxygen', 'Nitrogen', 'Helium']],
  ['What is the capital of Japan?', 'Tokyo', ['Kyoto', 'Osaka', 'Seoul']],
  ['Who wrote "Romeo and Juliet"?', 'William Shakespeare', ['Charles Dickens', 'Mark Twain', 'Jane Austen']],
  ['What is the smallest prime number?', '2', ['0', '1', '3']],
  ['Which planet is famous for its rings?', 'Saturn', ['Mars', 'Neptune', 'Mercury']],
  ['Which river flows through Egypt?', 'Nile', ['Amazon', 'Danube', 'Ganges']],
  ['How many strings does a standard guitar have?', '6', ['4', '5', '8']],
  ['Which is the tallest mountain above sea level?', 'Mount Everest', ['K2', 'Mount Kilimanjaro', 'Mont Blanc']],
  ['What is the capital of India?', 'New Delhi', ['Mumbai', 'Kolkata', 'Chennai']],
  ['Who is known as the Father of the Nation in India?', 'Mahatma Gandhi', ['Jawaharlal Nehru', 'Subhas Chandra Bose', 'Sardar Patel']],
  ['What is the currency of Japan?', 'Yen', ['Won', 'Yuan', 'Ringgit']],
  ['How many days are in a leap year?', '366', ['365', '364', '367']],
  ['Which organ pumps blood around the body?', 'Heart', ['Liver', 'Lungs', 'Kidney']],
  ['Which is the largest hot desert in the world?', 'Sahara', ['Gobi', 'Kalahari', 'Thar']],
  ['Which country gave the Statue of Liberty to the USA?', 'France', ['England', 'Spain', 'Italy']],
  ['The Great Wall is in which country?', 'China', ['Japan', 'India', 'Mongolia']],
  ['Which is the largest planet in our solar system?', 'Jupiter', ['Saturn', 'Earth', 'Uranus']],
  ['Mixing blue and yellow paint makes which colour?', 'Green', ['Purple', 'Orange', 'Brown']],
  ['How many minutes are in a day?', '1440', ['1240', '1640', '2400']],
  ['Which sport uses a shuttlecock?', 'Badminton', ['Tennis', 'Squash', 'Table tennis']],
  ['What is the square root of 144?', '12', ['14', '11', '16']],
  ['Which element has atomic number 1?', 'Hydrogen', ['Helium', 'Oxygen', 'Carbon']],
  ['Which animal is called the "Ship of the Desert"?', 'Camel', ['Horse', 'Elephant', 'Donkey']],
  ['How many bones does an adult human have?', '206', ['186', '256', '312']],
  ['Which planet is closest to the Sun?', 'Mercury', ['Venus', 'Earth', 'Mars']],
  ['Who developed the theory of relativity?', 'Albert Einstein', ['Isaac Newton', 'Galileo Galilei', 'Nikola Tesla']],
  ['What is the national flower of India?', 'Lotus', ['Rose', 'Marigold', 'Jasmine']],
  ['Which festival is known as the Festival of Lights?', 'Diwali', ['Holi', 'Eid', 'Pongal']],
  ['Who was the first person to walk on the Moon?', 'Neil Armstrong', ['Buzz Aldrin', 'Yuri Gagarin', 'Michael Collins']],
  ['Which instrument has black and white keys?', 'Piano', ['Violin', 'Flute', 'Drums']],
];
export function triviaRound(n = 10) {
  return shuffle(TRIVIA).slice(0, n).map(([q, a, w]) => ({ q, a, options: shuffle([a, ...w]) }));
}
export function Trivia({ players = 1 }) {
  const fresh = () => ({ qs: triviaRound(10), i: 0, scores: [0, 0], chosen: null, over: false });
  const [g, setG] = useState(fresh);
  const [best, submitBest] = useBest('trivia');
  const later = useTimeouts();
  const q = g.qs[g.i];
  const who = players === 2 ? g.i % 2 : 0;

  const answer = (opt) => {
    if (g.chosen !== null) return;
    const right = opt === q.a;
    const scores = g.scores.slice(); if (right) scores[who] += 1;
    setG({ ...g, chosen: opt, scores });
    later(() => setG(p => {
      const last = p.i + 1 >= p.qs.length;
      if (last && players === 1) submitBest(p.scores[0]);
      return { ...p, i: last ? p.i : p.i + 1, chosen: null, over: last };
    }), 1100);
  };
  const [s0, s1] = g.scores;
  return (
    <div className="gm-table">
      <StatBar>{players === 2 ? <><Stat label={`P1${who === 0 && !g.over ? ' ◀' : ''}`} value={s0} /><Stat label={`P2${who === 1 && !g.over ? ' ◀' : ''}`} value={s1} /></> : <><Stat label="Score" value={s0} /><Stat label="Best" value={best ?? 0} /></>}<Stat label="Question" value={`${Math.min(g.i + 1, g.qs.length)}/${g.qs.length}`} /></StatBar>
      <div className="gm-stage" style={{ maxWidth: 480 }}>
        <p className="gm-question">{players === 2 && <span className="gm-hint">Player {who + 1}: </span>}{q.q}</p>
        <div className="gm-options">
          {q.options.map(o => (
            <button key={o} type="button" disabled={g.chosen !== null} onClick={() => answer(o)}
              className={`gm-btn gm-opt ${g.chosen !== null && o === q.a ? 'right' : ''} ${g.chosen === o && o !== q.a ? 'wrong' : ''}`}>{o}</button>
          ))}
        </div>
        {g.over && <Overlay title={players === 2 ? (s0 === s1 ? 'Draw!' : `P${s0 > s1 ? 1 : 2} wins! 🎉`) : `${s0} / ${g.qs.length} correct`} sub={players === 2 ? `${s0} – ${s1}` : (s0 >= 8 ? 'Quiz champion! 🧠' : s0 >= 5 ? 'Nicely done.' : 'Try another round!')}
          actions={<button type="button" className="gm-btn primary" onClick={() => setG(fresh())}>New round</button>} />}
      </div>
    </div>
  );
}

/* ───────────────────────── Truth or Dare ───────────────────────── */
const TRUTHS = [
  'What is the most embarrassing song on your playlist?', 'What is your biggest fear?', 'What was your most awkward moment at school or work?',
  'What is the silliest thing you have ever cried about?', 'Which talent do you secretly wish you had?', 'What is the worst gift you have ever received?',
  'What is the weirdest food combination you actually enjoy?', 'Who in this room would you want as a teammate in a survival game, and why?',
  'What is a habit of yours that you think is strange?', 'What is the last thing you searched for online?', 'What is your most-used emoji, and what does it say about you?',
  'What is the funniest nickname you have ever had?', 'If you could swap lives with anyone for a day, who would it be?', 'What is a childhood memory that still makes you laugh?',
  'What is the most spontaneous thing you have ever done?', 'Which movie have you pretended to like but actually did not?', 'What is a skill you are surprisingly bad at?',
  'What is the best compliment you have ever received?', 'What would you do with a million dollars in the first hour?', 'What is something small that instantly makes your day better?',
];
const DARES = [
  'Speak in an accent of your choice until your next turn.', 'Do your best impression of someone in this room.', 'Sing the chorus of any song, as dramatically as you can.',
  'Do 10 jumping jacks right now.', 'Balance a spoon (or any object) on your nose for 10 seconds.', 'Tell a joke. If nobody laughs, tell another.',
  'Walk like a model across the room and back.', 'Talk without using the letter "S" until your next turn.', 'Let the group pick a funny pose for you to hold for 15 seconds.',
  'Show the last photo in your gallery and explain it.', 'Act out a movie scene without speaking — the others must guess.', 'Say the alphabet backwards as fast as you can.',
  'Do your best dance move for 15 seconds.', 'Make up a 4-line poem about the person on your left.', 'Draw a portrait of someone here with your eyes closed.',
  'Narrate everything you do like a sports commentator for the next minute.', 'Speak only in questions until your next turn.', 'Pretend to be a news anchor and report on something that just happened.',
  'Hold a plank for 20 seconds.', 'Give a 20-second motivational speech to an object nearby.',
];
export function TruthDare({ players = 1 }) {
  const [names, setNames] = useState(['Player 1', 'Player 2']);
  const [draft, setDraft] = useState('');
  const [cur, setCur] = useState(null);
  const [mode, setMode] = useState(null); // null | 'pick' | 'prompt'
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState('');
  const [spinning, setSpinning] = useState(false);
  const iv = useRef(null);
  useEffect(() => () => clearInterval(iv.current), []);

  const add = (e) => { e.preventDefault(); const n = draft.trim().slice(0, 16); if (n && names.length < 8 && !names.includes(n)) setNames([...names, n]); setDraft(''); };
  const spin = () => {
    if (names.length < 2) return;
    setSpinning(true); setMode(null); let ticks = 0, last = cur;
    clearInterval(iv.current);
    iv.current = setInterval(() => {
      ticks++;
      let n; do { n = rnd(names.length); } while (n === last && names.length > 1);
      last = n; setCur(n);
      if (ticks >= 14) { clearInterval(iv.current); setSpinning(false); setMode('pick'); }
    }, 90);
  };
  const choose = (k) => { const real = k === 'random' ? (rand() < 0.5 ? 'truth' : 'dare') : k; setKind(real); setPrompt(pick(real === 'truth' ? TRUTHS : DARES)); setMode('prompt'); };
  return (
    <div className="gm-table">
      <div className="gm-stage" style={{ maxWidth: 440 }}>
        <div className="gm-chips">
          {names.map((n, i) => (
            <span key={n} className={`gm-chip ${cur === i ? 'on' : ''}`}>{n}{names.length > 2 && mode === null && !spinning && <button type="button" aria-label={`Remove ${n}`} onClick={() => { setNames(names.filter((_, j) => j !== i)); setCur(null); }}>×</button>}</span>
          ))}
        </div>
        {names.length < 8 && (
          <form onSubmit={add} className="gm-row"><input className="gm-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a player" maxLength={16} /><button type="submit" className="gm-btn">Add</button></form>
        )}
        <div className="gm-bottle" aria-live="polite">
          {cur === null ? 'Ready?' : spinning ? `🎲 ${names[cur]}…` : mode === 'prompt' ? `${names[cur]}'s ${kind}` : `${names[cur]}, truth or dare?`}
        </div>
        {mode === 'pick' && (
          <div className="gm-row"><button type="button" className="gm-btn primary" onClick={() => choose('truth')}>Truth</button><button type="button" className="gm-btn primary" onClick={() => choose('dare')}>Dare</button><button type="button" className="gm-btn" onClick={() => choose('random')}>Surprise me</button></div>
        )}
        {mode === 'prompt' && <p className="gm-question" style={{ marginTop: 6 }}>{prompt}</p>}
        {(mode === null || mode === 'prompt') && <div className="gm-row"><button type="button" className="gm-btn primary" onClick={spin} disabled={spinning}>{cur === null ? 'Spin' : mode === 'prompt' ? 'Done — next player' : 'Spin'}</button>{mode === 'prompt' && <button type="button" className="gm-btn" onClick={() => setPrompt(pick(kind === 'truth' ? TRUTHS : DARES))}>Skip prompt</button>}</div>}
        <p className="gm-hint">All prompts are friendly and skippable. Play with the people in the room!</p>
      </div>
    </div>
  );
}

/* ───────────────────────── Pig Dice Duel ───────────────────────── */
const PIG_GOAL = 50;
const FACE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
export function PigDice({ players = 1 }) {
  const fresh = () => ({ scores: [0, 0], turn: 0, pts: 0, roll: null, winner: null, msg: 'Roll the die. Roll a 1 and you lose the turn’s points!', n: 0 });
  const [g, setG] = useState(fresh);
  const names = ['P1', players === 2 ? 'P2' : 'CPU'];
  const cpuTurn = players === 1 && g.turn === 1 && g.winner === null;

  const roll = () => setG(p => {
    if (p.winner !== null) return p;
    const r = 1 + rnd(6);
    if (r === 1) return { ...p, roll: 1, pts: 0, turn: 1 - p.turn, n: p.n + 1, msg: `${names[p.turn]} rolled a 1 — turn lost!` };
    return { ...p, roll: r, pts: p.pts + r, n: p.n + 1, msg: `${names[p.turn]} rolled a ${r}.` };
  });
  const hold = () => setG(p => {
    if (p.winner !== null || p.pts === 0) return p;
    const scores = p.scores.slice(); scores[p.turn] += p.pts;
    if (scores[p.turn] >= PIG_GOAL) return { ...p, scores, pts: 0, winner: p.turn, msg: '' };
    return { ...p, scores, pts: 0, turn: 1 - p.turn, n: p.n + 1, msg: `${names[p.turn]} banked ${p.pts}.` };
  });
  useEffect(() => {
    if (!cpuTurn) return undefined;
    const t = setTimeout(() => { if (g.pts >= 18 || (g.pts > 0 && g.scores[1] + g.pts >= PIG_GOAL)) hold(); else roll(); }, 850);
    return () => clearTimeout(t);
  }, [cpuTurn, g.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = g.turn === 0 || players === 2;
  return (
    <div className="gm-table">
      <StatBar><Stat label={`${names[0]}${g.turn === 0 && g.winner === null ? ' ◀' : ''}`} value={g.scores[0]} /><Stat label="This turn" value={g.pts} /><Stat label={`${names[1]}${g.turn === 1 && g.winner === null ? ' ◀' : ''}`} value={g.scores[1]} /></StatBar>
      <div className="gm-die" aria-label={g.roll ? `Rolled ${g.roll}` : 'No roll yet'}>{g.roll ? FACE[g.roll - 1] : '🎲'}</div>
      <p className="gm-result">{g.winner === null && cpuTurn ? 'CPU is rolling…' : g.msg}</p>
      <div className="gm-row">
        <button type="button" className="gm-btn primary" onClick={roll} disabled={!mine || g.winner !== null}>Roll</button>
        <button type="button" className="gm-btn" onClick={hold} disabled={!mine || g.pts === 0 || g.winner !== null}>Hold ({g.pts})</button>
      </div>
      <p className="gm-hint">First to {PIG_GOAL} wins.{players === 2 ? ` ${names[g.turn]}'s turn.` : ''}</p>
      {g.winner !== null && <Overlay title={players === 1 ? (g.winner === 0 ? 'You win! 🎉' : 'CPU wins') : `${names[g.winner]} wins! 🎉`} sub={`${g.scores[0]} – ${g.scores[1]}`} actions={<button type="button" className="gm-btn primary" onClick={() => setG(fresh())}>Play again</button>} />}
    </div>
  );
}

/* ───────────────────────── Simon (colour memory) ───────────────────────── */
const PADS = [{ c: '#ff5c93', n: 'Pink' }, { c: '#26e0c9', n: 'Teal' }, { c: '#ffb84d', n: 'Amber' }, { c: '#3f6fe0', n: 'Violet' }];
export function Simon({ players = 1 }) {
  const [phase, setPhase] = useState('idle'); // idle | show | input | over
  const [lit, setLit] = useState(-1);
  const [round, setRound] = useState(0);
  const [turn, setTurn] = useState(0);
  const [loser, setLoser] = useState(null);
  const seq = useRef([]); const pos = useRef(0);
  const timers = useRef([]);
  const [best, submitBest] = useBest('simon');
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clear, []);
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));

  const play = (s, nextTurn) => {
    setPhase('show'); pos.current = 0; clear();
    s.forEach((c, i) => { later(() => setLit(c), 700 + i * 650); later(() => setLit(-1), 700 + i * 650 + 400); });
    later(() => setPhase('input'), 700 + s.length * 650);
    setTurn(nextTurn);
  };
  const start = () => { clear(); seq.current = [rnd(4)]; setRound(1); setLoser(null); play(seq.current, 0); };
  const press = (c) => {
    if (phase !== 'input') return;
    setLit(c); later(() => setLit(-1), 180);
    if (seq.current[pos.current] !== c) {
      clear(); setPhase('over'); setLoser(turn);
      if (players === 1) submitBest(round - 1);
      return;
    }
    pos.current += 1;
    if (pos.current === seq.current.length) {
      seq.current = [...seq.current, rnd(4)];
      setRound(r => r + 1);
      setPhase('show'); later(() => play(seq.current, players === 2 ? 1 - turn : 0), 700);
    }
  };
  return (
    <div className="gm-table">
      <StatBar><Stat label="Round" value={round || '—'} />{players === 2 ? <Stat label="Turn" value={phase === 'idle' ? '—' : `P${turn + 1}`} /> : <Stat label="Best" value={best ?? 0} />}</StatBar>
      <div className="gm-stage" style={{ maxWidth: 300 }}>
        <div className="gm-simon">
          {PADS.map((p, i) => <button key={i} type="button" aria-label={p.n} disabled={phase !== 'input'} onClick={() => press(i)} className={`gm-pad ${lit === i ? 'lit' : ''}`} style={{ '--pad': p.c }} />)}
        </div>
        {phase === 'over' && <Overlay title={players === 2 ? `P${2 - loser} wins! 🎉` : `Game over — round ${round}`} sub={players === 2 ? `P${loser + 1} missed the pattern.` : `You remembered ${Math.max(0, round - 1)} step${round - 1 === 1 ? '' : 's'}.`} actions={<button type="button" className="gm-btn primary" onClick={start}>Play again</button>} />}
      </div>
      <p className="gm-result">{phase === 'idle' ? 'Watch the pattern, then repeat it.' : phase === 'show' ? 'Watch…' : phase === 'input' ? (players === 2 ? `Player ${turn + 1}: your turn!` : 'Your turn!') : ''}</p>
      {phase === 'idle' && <button type="button" className="gm-btn primary" onClick={start}>Start</button>}
    </div>
  );
}
