// More server-validated engines: Card War, Higher or Lower, Simon, Truth or Dare, Crazy Eights,
// and a generic "Score Duel" used to play any solo game head-to-head online.
import { randomInt } from 'node:crypto';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const rankValue = (r) => (r === 'A' ? 14 : r === 'K' ? 13 : r === 'Q' ? 12 : r === 'J' ? 11 : Number(r));
const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const newDeck = () => shuffle(SUITS.flatMap((s) => RANKS.map((r) => ({ r, s, id: r + s }))));
const ids = (players) => players.map((p) => p.user_id);
const other = (state, id) => state.order.find((x) => x !== id);
const byScore = (scores) => { const [a, b] = Object.keys(scores); return scores[a] === scores[b] ? 'draw' : scores[a] > scores[b] ? a : b; };

/* ───────── Card War ───────── */
export function warInit(players) {
  const [a, b] = ids(players);
  return { order: [a, b], turn: a, scores: { [a]: 0, [b]: 0 }, pot: 0, last: null, left: 52, winner: null, secret: { deck: newDeck() } };
}
export function warApplyMove(state, userId, move) {
  if (!move?.flip) return { error: 'Flip a card.' };
  const deck = state.secret.deck;
  const [a, b] = state.order;
  const ca = deck.pop(), cb = deck.pop();
  const va = rankValue(ca.r), vb = rankValue(cb.r);
  let roundWinner = 'war';
  if (va === vb) state.pot += 1;
  else { roundWinner = va > vb ? a : b; state.scores[roundWinner] += 1 + state.pot; state.last = null; }
  state.last = { cards: { [a]: { r: ca.r, s: ca.s }, [b]: { r: cb.r, s: cb.s } }, winner: roundWinner, pot: state.pot };
  if (roundWinner !== 'war') state.pot = 0;
  state.left = deck.length;
  if (deck.length < 2) return { winner: byScore(state.scores) };
  return { winner: null };
}

/* ───────── Higher or Lower (a correct guess keeps your turn; a wrong one knocks you out) ───────── */
const randCard = () => ({ r: RANKS[randomInt(13)], s: SUITS[randomInt(4)] });
export function hiloInit(players) {
  const [a, b] = ids(players);
  return { order: [a, b], turn: a, card: randCard(), streak: { [a]: 0, [b]: 0 }, alive: { [a]: true, [b]: true }, last: null, winner: null };
}
export function hiloApplyMove(state, userId, move, draw = randCard) {
  if (move?.guess !== 'higher' && move?.guess !== 'lower') return { error: 'Guess higher or lower.' };
  const next = draw();
  const a = rankValue(state.card.r), b = rankValue(next.r);
  let result;
  if (a === b) result = 'push';
  else result = (move.guess === 'higher') === (b > a) ? 'right' : 'wrong';
  state.last = { from: state.card, to: next, by: userId, guess: move.guess, result };
  state.card = next;
  if (result === 'push') return { winner: null, keepTurn: true };
  if (result === 'right') { state.streak[userId] += 1; return { winner: null, keepTurn: true }; }
  state.alive[userId] = false;
  const opp = other(state, userId);
  if (!state.alive[opp]) return { winner: byScore(state.streak) };
  return { winner: null }; // opponent takes over
}

/* ───────── Simon (shared pattern; whoever misses loses) ───────── */
export function simonInit(players) {
  const [a, b] = ids(players);
  return { order: [a, b], turn: a, seq: [randomInt(4)], round: 1, last: null, winner: null };
}
export function simonApplyMove(state, userId, move) {
  const attempt = move?.seq;
  if (!Array.isArray(attempt) || attempt.length !== state.seq.length || !attempt.every((c) => Number.isInteger(c) && c >= 0 && c < 4)) return { error: 'Repeat the whole pattern.' };
  if (attempt.every((c, i) => c === state.seq[i])) {
    state.last = { by: userId, ok: true };
    state.seq = [...state.seq, randomInt(4)]; state.round += 1;
    return { winner: null };
  }
  state.last = { by: userId, ok: false };
  return { winner: other(state, userId) };
}

/* ───────── Truth or Dare (no winner; friendly prompts) ───────── */
const TRUTHS = ['What is the most embarrassing song on your playlist?', 'What is your biggest fear?', 'What was your most awkward moment at school or work?', 'What is the silliest thing you have ever cried about?', 'Which talent do you secretly wish you had?', 'What is the worst gift you have ever received?', 'What is the weirdest food combination you actually enjoy?', 'What is a habit of yours that you think is strange?', 'What is your most-used emoji, and what does it say about you?', 'What is the funniest nickname you have ever had?', 'If you could swap lives with anyone for a day, who would it be?', 'What is a childhood memory that still makes you laugh?', 'What is the most spontaneous thing you have ever done?', 'Which movie have you pretended to like but actually did not?', 'What is a skill you are surprisingly bad at?', 'What is the best compliment you have ever received?', 'What would you do with a million dollars in the first hour?', 'What is something small that instantly makes your day better?'];
const DARES = ['Speak in an accent of your choice until your next turn.', 'Do your best impression of a famous person.', 'Sing the chorus of any song, as dramatically as you can.', 'Do 10 jumping jacks right now.', 'Balance a spoon (or any object) on your nose for 10 seconds.', 'Tell a joke. If nobody laughs, tell another.', 'Walk like a model across the room and back.', 'Talk without using the letter "S" until your next turn.', 'Show the last photo in your gallery and explain it.', 'Act out a movie scene without speaking and let your friend guess.', 'Say the alphabet backwards as fast as you can.', 'Do your best dance move for 15 seconds.', 'Make up a 4-line poem about your friend.', 'Narrate everything you do like a sports commentator for the next minute.', 'Speak only in questions until your next turn.', 'Hold a plank for 20 seconds.', 'Give a 20-second motivational speech to an object nearby.'];
const promptFor = (kind) => { const l = kind === 'truth' ? TRUTHS : DARES; return l[randomInt(l.length)]; };
export function todInit(players) {
  const [a, b] = ids(players);
  return { order: [a, b], turn: a, phase: 'pick', kind: null, prompt: null, count: 0, winner: null };
}
export function todApplyMove(state, userId, move) {
  if (state.phase === 'pick') {
    const c = move?.choose;
    if (!['truth', 'dare', 'random'].includes(c)) return { error: 'Choose truth or dare.' };
    state.kind = c === 'random' ? (randomInt(2) ? 'truth' : 'dare') : c;
    state.prompt = promptFor(state.kind); state.phase = 'prompt';
    return { winner: null, keepTurn: true };
  }
  if (move?.skip) { state.prompt = promptFor(state.kind); return { winner: null, keepTurn: true }; }
  if (move?.next) { state.phase = 'pick'; state.kind = null; state.prompt = null; state.count += 1; return { winner: null }; }
  return { error: 'Finish this prompt first.' };
}

/* ───────── Crazy Eights (hidden hands live in state.secret; see gameViews.js) ───────── */
const canPlay = (c, top, suit) => c.r === '8' || c.s === suit || c.r === top.r;
const refill = (secret) => {
  if (secret.draw.length > 0 || secret.pile.length <= 1) return;
  const top = secret.pile[secret.pile.length - 1];
  secret.draw = shuffle(secret.pile.slice(0, -1)); secret.pile = [top];
};
const sync = (state) => {
  const s = state.secret; const top = s.pile[s.pile.length - 1];
  state.top = { r: top.r, s: top.s }; state.drawCount = s.draw.length;
  state.counts = Object.fromEntries(state.order.map((u) => [u, s.hands[u].length]));
};
export function eightsInit(players) {
  const [a, b] = ids(players);
  const deck = newDeck();
  const hands = { [a]: deck.splice(0, 7), [b]: deck.splice(0, 7) };
  let top = deck.shift();
  while (top.r === '8') { deck.push(top); top = deck.shift(); }
  const state = { order: [a, b], turn: a, suit: top.s, drew: false, last: null, winner: null, secret: { draw: deck, pile: [top], hands } };
  sync(state);
  return state;
}
export function eightsApplyMove(state, userId, move) {
  const s = state.secret, hand = s.hands[userId], top = s.pile[s.pile.length - 1];
  if (move?.play !== undefined) {
    const card = hand.find((c) => c.id === move.play);
    if (!card) return { error: 'You do not have that card.' };
    if (!canPlay(card, top, state.suit)) return { error: 'That card cannot be played now.' };
    if (card.r === '8' && !SUITS.includes(move.suit)) return { error: 'Choose a suit for your eight.' };
    s.hands[userId] = hand.filter((c) => c.id !== card.id);
    s.pile.push(card);
    state.suit = card.r === '8' ? move.suit : card.s; state.drew = false;
    state.last = { by: userId, type: 'play', card: { r: card.r, s: card.s }, suit: state.suit };
    sync(state);
    if (!s.hands[userId].length) return { winner: userId };
    return { winner: null };
  }
  if (move?.draw) {
    if (state.drew) return { error: 'You already drew — play it or pass.' };
    if (hand.some((c) => canPlay(c, top, state.suit))) return { error: 'You have a playable card.' };
    refill(s);
    if (!s.draw.length) { state.last = { by: userId, type: 'pass' }; sync(state); return { winner: null }; }
    const drawn = s.draw.pop(); hand.push(drawn);
    sync(state);
    if (canPlay(drawn, top, state.suit)) { state.drew = true; state.last = { by: userId, type: 'draw-playable' }; return { winner: null, keepTurn: true }; }
    state.last = { by: userId, type: 'draw' };
    return { winner: null };
  }
  if (move?.pass) {
    if (!state.drew) return { error: 'You can only pass after drawing a playable card.' };
    state.drew = false; state.last = { by: userId, type: 'pass' };
    return { winner: null };
  }
  return { error: 'Invalid move.' };
}

/* ───────── Score Duel: both players play the same solo game on their own device ─────────
   Everyone gets the same random seed. Each player submits one final score; the higher
   score wins (or the lower one for timed puzzles). Scores stay hidden until both are in.
   NOTE: the score is reported by the player's browser, so this is for friendly play. */
export const DUELS = {
  'duel-blackjack': { max: 3000 }, 'duel-traffic-dodge': { max: 50000 }, 'duel-snake': { max: 4000 },
  'duel-breakout': { max: 50000 }, 'duel-flappy-hop': { max: 3000 }, 'duel-2048': { max: 4000000 },
  'duel-slide-puzzle': { max: 7200, min: 3, lower: true }, 'duel-lights-out': { max: 7200, min: 2, lower: true },
};
export function duelEngine(gameId) {
  const cfg = DUELS[gameId];
  return {
    simultaneous: true,
    init(players) {
      const [a, b] = ids(players);
      return { order: [a, b], seed: randomInt(2 ** 31), lower: !!cfg.lower, submitted: { [a]: false, [b]: false }, result: null, winner: null, secret: { scores: {} } };
    },
    applyMove(state, userId, move) {
      const score = move?.score;
      if (typeof score !== 'number' || !Number.isFinite(score) || score < (cfg.min ?? 0) || score > cfg.max) return { error: 'That score is not valid.' };
      if (state.submitted[userId]) return { error: 'You already finished this game.' };
      state.submitted[userId] = true; state.secret.scores[userId] = score;
      const [a, b] = state.order;
      if (!(state.submitted[a] && state.submitted[b])) return { winner: null };
      const sa = state.secret.scores[a], sb = state.secret.scores[b];
      state.result = { [a]: sa, [b]: sb };
      if (sa === sb) return { winner: 'draw' };
      return { winner: (cfg.lower ? sa < sb : sa > sb) ? a : b };
    },
  };
}
