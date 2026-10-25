// Online two-player engines for the turn-based party/board games.
//
// Engine contract (see gameEngine.js): init(players) -> state, applyMove(state, userId, move)
// -> { error } | { winner, keepTurn }.  Anything stored under `state.secret` is persisted but
// STRIPPED before the state is sent to clients (see roomDTO), so hidden information (face-down
// cards, a picked-but-not-revealed move, the correct trivia answer) can never be read by the
// opponent from the network traffic.
import { randomInt } from 'node:crypto';
import { TRIVIA } from './triviaData.js';

const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const ids = (players) => players.map((p) => p.user_id);
const byScore = (scores) => {
  const [a, b] = Object.keys(scores);
  return scores[a] === scores[b] ? 'draw' : scores[a] > scores[b] ? a : b;
};

/* ───────── Dots & Boxes (4×4 boxes) ───────── */
const N = 4;
const hIdx = (r, c) => r * N + c;
const vIdx = (r, c) => r * (N + 1) + c;
const sides = (h, v, r, c) => [h[hIdx(r, c)], h[hIdx(r + 1, c)], v[vIdx(r, c)], v[vIdx(r, c + 1)]].filter(Boolean).length;
export function dotsInit(players) {
  const [a, b] = ids(players);
  return { h: Array((N + 1) * N).fill(false), v: Array(N * (N + 1)).fill(false), boxes: Array(N * N).fill(null), scores: { [a]: 0, [b]: 0 }, turn: a, winner: null };
}
export function dotsApplyMove(state, userId, move) {
  const { kind, r, c } = move || {};
  const okH = kind === 'h' && Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r <= N && c >= 0 && c < N;
  const okV = kind === 'v' && Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < N && c >= 0 && c <= N;
  if (!okH && !okV) return { error: 'Invalid move.' };
  const arr = kind === 'h' ? state.h : state.v;
  const i = kind === 'h' ? hIdx(r, c) : vIdx(r, c);
  if (arr[i]) return { error: 'That line is already drawn.' };
  arr[i] = true;
  let got = 0;
  for (let br = 0; br < N; br++) for (let bc = 0; bc < N; bc++) {
    if (state.boxes[br * N + bc] === null && sides(state.h, state.v, br, bc) === 4) { state.boxes[br * N + bc] = userId; got++; }
  }
  state.scores[userId] += got;
  if (state.boxes.every((x) => x !== null)) return { winner: byScore(state.scores) };
  return { winner: null, keepTurn: got > 0 }; // closing a box earns another line
}

/* ───────── Rock Paper Scissors (first to 3, picks hidden until both are in) ───────── */
const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
export function rpsInit(players) {
  const [a, b] = ids(players);
  return { turn: a, round: 1, scores: { [a]: 0, [b]: 0 }, picked: { [a]: false, [b]: false }, last: null, winner: null, secret: { picks: {} } };
}
export function rpsApplyMove(state, userId, move) {
  const pick = move?.pick;
  if (!RPS_BEATS[pick]) return { error: 'Pick rock, paper or scissors.' };
  if (state.picked[userId]) return { error: 'You already picked this round.' };
  state.secret.picks[userId] = pick;
  state.picked[userId] = true;
  const [a, b] = Object.keys(state.scores);
  if (!(state.picked[a] && state.picked[b])) return { winner: null }; // waiting for the other player
  const pa = state.secret.picks[a], pb = state.secret.picks[b];
  const roundWinner = pa === pb ? 'tie' : RPS_BEATS[pa] === pb ? a : b;
  if (roundWinner !== 'tie') state.scores[roundWinner] += 1;
  state.last = { picks: { [a]: pa, [b]: pb }, winner: roundWinner };
  state.secret.picks = {}; state.picked = { [a]: false, [b]: false }; state.round += 1;
  if (state.scores[a] >= 3 || state.scores[b] >= 3) return { winner: state.scores[a] > state.scores[b] ? a : b };
  return { winner: null };
}

/* ───────── Pig Dice (first to 50; the server rolls the die) ───────── */
export const PIG_GOAL = 50;
export function pigInit(players) {
  const [a, b] = ids(players);
  return { turn: a, scores: { [a]: 0, [b]: 0 }, pts: 0, roll: null, lastEvent: null, winner: null };
}
export function pigApplyMove(state, userId, move, rng = () => 1 + randomInt(6)) {
  if (move?.action === 'roll') {
    const r = rng();
    state.roll = r;
    if (r === 1) { state.pts = 0; state.lastEvent = { by: userId, type: 'bust' }; return { winner: null }; } // turn passes
    state.pts += r; state.lastEvent = { by: userId, type: 'roll', value: r };
    return { winner: null, keepTurn: true };
  }
  if (move?.action === 'hold') {
    if (state.pts === 0) return { error: 'Roll at least once before holding.' };
    state.scores[userId] += state.pts;
    state.lastEvent = { by: userId, type: 'hold', value: state.pts };
    state.pts = 0;
    if (state.scores[userId] >= PIG_GOAL) return { winner: userId };
    return { winner: null };
  }
  return { error: 'Invalid move.' };
}

/* ───────── Memory Match (8 pairs, a match keeps your turn) ───────── */
const FACES = ['🍕', '🚀', '🎸', '🐙', '🌈', '🍩', '⚽', '🦄'];
export function memoryInit(players) {
  const [a, b] = ids(players);
  return {
    board: Array(16).fill(null),          // what both players can see (face or null)
    matched: Array(16).fill(false),
    first: null,                          // index of the first card flipped this turn
    pending: [],                          // a mismatched pair left face-up until the next move
    scores: { [a]: 0, [b]: 0 }, turn: a, winner: null,
    secret: { faces: shuffle([...FACES, ...FACES]) },
  };
}
export function memoryApplyMove(state, userId, move) {
  const i = move?.cell;
  if (!Number.isInteger(i) || i < 0 || i > 15) return { error: 'Invalid card.' };
  // A mismatched pair from the previous turn is turned back over as soon as anyone moves.
  for (const p of state.pending) state.board[p] = null;
  state.pending = [];
  if (state.matched[i] || state.first === i) return { error: 'That card is already face up.' };
  state.board[i] = state.secret.faces[i];
  if (state.first === null) { state.first = i; return { winner: null, keepTurn: true }; }
  const f = state.first; state.first = null;
  if (state.secret.faces[f] === state.secret.faces[i]) {
    state.matched[f] = state.matched[i] = true;
    state.scores[userId] += 1;
    if (state.matched.every(Boolean)) return { winner: byScore(state.scores) };
    return { winner: null, keepTurn: true };
  }
  state.pending = [f, i]; // both stay visible for one turn change, then flip back
  return { winner: null };
}

/* ───────── Trivia Duel (10 questions, players alternate) ───────── */
const QUESTIONS = 10;
function pickQuestions() {
  return shuffle(TRIVIA).slice(0, QUESTIONS).map(([q, a, wrong]) => { const options = shuffle([a, ...wrong]); return { q, options, answer: options.indexOf(a) }; });
}
export function triviaInit(players) {
  const [a, b] = ids(players);
  const qs = pickQuestions();
  return { index: 0, total: QUESTIONS, question: { q: qs[0].q, options: qs[0].options }, scores: { [a]: 0, [b]: 0 }, last: null, turn: a, winner: null, secret: { qs } };
}
export function triviaApplyMove(state, userId, move) {
  const choice = move?.choice;
  if (!Number.isInteger(choice) || choice < 0 || choice > 3) return { error: 'Pick one of the four answers.' };
  const cur = state.secret.qs[state.index];
  const correct = choice === cur.answer;
  if (correct) state.scores[userId] += 1;
  state.last = { by: userId, choice, correct, answer: cur.answer };
  state.index += 1;
  if (state.index >= QUESTIONS) return { winner: byScore(state.scores) };
  const nq = state.secret.qs[state.index];
  state.question = { q: nq.q, options: nq.options };
  return { winner: null };
}
