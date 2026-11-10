import { useEffect, useRef, useState } from 'react';
import { PlayingCard, Overlay, Stat, StatBar, newDeck, rankValue, rnd, shuffle, SUITS, useBest } from './ui.jsx';

/* ───────────────────────── Blackjack ───────────────────────── */
export function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    if (c.r === 'A') { aces++; total += 11; } else if (c.r === 'J' || c.r === 'Q' || c.r === 'K') total += 10; else total += Number(c.r);
  }
  while (total > 21 && aces) { total -= 10; aces--; }
  return total;
}

export function settleBlackjack(st, playerBJ) {
  const deck = st.deck.slice(), dealer = st.dealer.slice();
  const pv = handValue(st.player);
  if (pv <= 21 && !playerBJ) while (handValue(dealer) < 17) dealer.push(deck.pop());
  const dv = handValue(dealer);
  const dealerBJ = dealer.length === 2 && dv === 21;
  let pay = 0, msg;
  if (pv > 21) msg = 'Bust! You lose.';
  else if (playerBJ && !dealerBJ) { pay = Math.floor(st.stake * 2.5); msg = 'Blackjack! Pays 3 to 2.'; }
  else if (playerBJ && dealerBJ) { pay = st.stake; msg = 'Both have blackjack: push.'; }
  else if (dealerBJ) msg = 'Dealer has blackjack.';
  else if (dv > 21) { pay = st.stake * 2; msg = 'Dealer busts. You win!'; }
  else if (pv > dv) { pay = st.stake * 2; msg = 'You win!'; }
  else if (pv === dv) { pay = st.stake; msg = 'Push.'; }
  else msg = 'Dealer wins.';
  return { pay, state: { ...st, deck, dealer, phase: 'done', msg } };
}

export const DUEL_HANDS = 10;
export function Blackjack({ duel }) {
  const [chips, setChips] = useState(100);
  const [hands, setHands] = useState(0);
  const [bet, setBet] = useState(10);
  const [s, setS] = useState({ phase: 'bet', deck: [], player: [], dealer: [], stake: 0, msg: '' });
  const [best, submitBest] = useBest('blackjack');

  const finish = (st, playerBJ, chipsNow) => {
    const { pay, state } = settleBlackjack(st, playerBJ);
    const total = chipsNow + pay;
    setChips(total); submitBest(total); setS(state);
    if (duel) { setHands(h => h + 1); duel.onScore?.(total); }
  };
  const duelOver = !!duel && s.phase === 'done' && (hands >= DUEL_HANDS || chips <= 0);
  useEffect(() => {
    if (!duelOver) return undefined;
    const t = setTimeout(() => duel.onEnd(chips), 1800);
    return () => clearTimeout(t);
  }, [duelOver]); // eslint-disable-line react-hooks/exhaustive-deps
  const deal = () => {
    const stake = Math.min(bet, chips);
    const deck = newDeck();
    const st = { phase: 'play', deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], stake, msg: '' };
    const left = chips - stake;
    setChips(left);
    if (handValue(st.player) === 21) finish(st, true, left); else setS(st);
  };
  const hit = () => {
    const deck = s.deck.slice(); const player = [...s.player, deck.pop()];
    const st = { ...s, deck, player };
    const v = handValue(player);
    if (v >= 21) finish(st, false, chips); else setS(st);
  };
  const stand = () => finish(s, false, chips);
  const double = () => {
    const deck = s.deck.slice(); const player = [...s.player, deck.pop()];
    finish({ ...s, deck, player, stake: s.stake * 2 }, false, chips - s.stake);
  };

  const bust = s.phase === 'done' && chips <= 0;
  const hideHole = s.phase === 'play';
  return (
    <div className="gm-table">
      <StatBar><Stat label="Chips" value={chips} />{duel ? <Stat label="Hand" value={`${Math.min(hands + (s.phase === 'done' ? 0 : 1), DUEL_HANDS)}/${DUEL_HANDS}`} /> : <Stat label="Best" value={best ?? '—'} />}{s.phase !== 'bet' && <Stat label="Bet" value={s.stake} />}</StatBar>
      {s.phase === 'bet' ? (
        <div className="gm-center">
          <p className="gm-hint">Place your bet</p>
          <div className="gm-row">{[10, 25, 50].map(b => (
            <button key={b} type="button" className={`gm-btn ${bet === b ? 'on' : ''}`} disabled={b > chips} onClick={() => setBet(b)}>{b}</button>
          ))}</div>
          <button type="button" className="gm-btn primary" onClick={deal}>Deal</button>
        </div>
      ) : (
        <>
          <div className="gm-label">Dealer {hideHole ? '' : `· ${handValue(s.dealer)}`}</div>
          <div className="gm-hand">{s.dealer.map((c, i) => <PlayingCard key={c.id} card={c} faceDown={hideHole && i === 1} />)}</div>
          <div className="gm-label">You · {handValue(s.player)}</div>
          <div className="gm-hand">{s.player.map(c => <PlayingCard key={c.id} card={c} />)}</div>
          {s.phase === 'play' && (
            <div className="gm-row">
              <button type="button" className="gm-btn primary" onClick={hit}>Hit</button>
              <button type="button" className="gm-btn" onClick={stand}>Stand</button>
              {s.player.length === 2 && chips >= s.stake && <button type="button" className="gm-btn" onClick={double}>Double</button>}
            </div>
          )}
          {s.phase === 'done' && !bust && !duelOver && (
            <div className="gm-center"><p className="gm-result">{s.msg}</p>
              <button type="button" className="gm-btn primary" onClick={() => setS({ phase: 'bet', deck: [], player: [], dealer: [], stake: 0, msg: '' })}>Next hand</button></div>
          )}
        </>
      )}
      {bust && !duel && <Overlay title="Out of chips" sub={s.msg} actions={<button type="button" className="gm-btn primary" onClick={() => { setChips(100); setBet(10); setS({ phase: 'bet', deck: [], player: [], dealer: [], stake: 0, msg: '' }); }}>New bankroll</button>} />}
    </div>
  );
}

/* ───────────────────────── Card War ───────────────────────── */
export function CardWar({ players = 1 }) {
  const names = ['You', players === 2 ? 'Player 2' : 'CPU'];
  const fresh = () => ({ deck: newDeck(), a: null, b: null, pot: 0, scores: [0, 0], msg: 'Flip a card!', flips: 0 });
  const [g, setG] = useState(fresh);
  const over = g.deck.length < 2;

  const flip = () => setG(prev => {
    if (prev.deck.length < 2) return prev;
    const deck = prev.deck.slice(); const a = deck.pop(), b = deck.pop();
    const va = rankValue(a.r), vb = rankValue(b.r);
    const scores = prev.scores.slice(); let pot = prev.pot; let msg;
    if (va === vb) { pot += 1; msg = `War! Tie on ${a.r}. Next winner takes ${pot + 1} points.`; }
    else { const w = va > vb ? 0 : 1; scores[w] += 1 + pot; msg = `${names[w]} win${w === 0 && names[0] === 'You' ? '' : 's'} ${1 + pot} point${pot ? 's' : ''}.`; pot = 0; }
    return { deck, a, b, pot, scores, msg, flips: prev.flips + 1 };
  });

  const [w0, w1] = g.scores;
  return (
    <div className="gm-table">
      <StatBar><Stat label={names[0]} value={w0} /><Stat label="Cards left" value={g.deck.length} /><Stat label={names[1]} value={w1} /></StatBar>
      <div className="gm-row gm-faceoff">
        <div><div className="gm-label">{names[0]}</div>{g.a ? <PlayingCard card={g.a} /> : <PlayingCard faceDown />}</div>
        <div className="gm-vs">VS</div>
        <div><div className="gm-label">{names[1]}</div>{g.b ? <PlayingCard card={g.b} /> : <PlayingCard faceDown />}</div>
      </div>
      <p className="gm-result">{g.msg}</p>
      <button type="button" className="gm-btn primary" onClick={flip} disabled={over}>Flip!</button>
      {over && <Overlay title={w0 === w1 ? 'Draw!' : (w0 > w1 ? `${names[0] === 'You' ? 'You win' : names[0] + ' wins'}! 🎉` : `${names[1]} wins!`)} sub={`Final score ${w0} – ${w1}`}
        actions={<button type="button" className="gm-btn primary" onClick={() => setG(fresh())}>Play again</button>} />}
    </div>
  );
}

/* ───────────────────────── Higher or Lower ───────────────────────── */
const randCard = () => { const d = newDeck(); return d[rnd(d.length)]; };
export function HigherLower({ players = 1 }) {
  const fresh = () => ({ card: randCard(), streak: Array(players).fill(0), alive: Array(players).fill(true), turn: 0, msg: 'Will the next card be higher or lower?', last: null });
  const [g, setG] = useState(fresh);
  const [best, submitBest] = useBest('higher-lower');
  const over = g.alive.every(a => !a);

  const nextAlive = (alive, from) => { for (let i = 1; i <= alive.length; i++) { const n = (from + i) % alive.length; if (alive[n]) return n; } return from; };
  const guess = (dir) => {
    const next = randCard();
    const a = rankValue(g.card.r), b = rankValue(next.r);
    const streak = g.streak.slice(), alive = g.alive.slice();
    let msg, turn = g.turn;
    if (a === b) msg = `Same rank (${next.r}) — it's a push. Go again!`;
    else if ((dir === 'higher') === (b > a)) { streak[turn]++; msg = 'Correct! 🔥'; submitBest(streak[turn]); }
    else {
      alive[turn] = false; msg = `Wrong — it was ${next.r}.`;
      if (alive.some(Boolean)) turn = nextAlive(alive, turn);
    }
    setG({ card: next, streak, alive, turn, msg, last: g.card });
  };
  const winner = over ? (players === 2 ? (g.streak[0] === g.streak[1] ? -1 : g.streak[0] > g.streak[1] ? 0 : 1) : 0) : null;
  return (
    <div className="gm-table">
      <StatBar>
        {g.streak.map((s, i) => <Stat key={i} label={players === 2 ? `Player ${i + 1}${g.turn === i && !over ? ' ◀' : ''}` : 'Streak'} value={s} />)}
        <Stat label="Best" value={best ?? 0} />
      </StatBar>
      <div className="gm-row">
        {g.last && <div><div className="gm-label">Before</div><PlayingCard card={g.last} small /></div>}
        <div><div className="gm-label">Now</div><PlayingCard card={g.card} /></div>
      </div>
      <p className="gm-result">{players === 2 && !over ? `Player ${g.turn + 1}: ` : ''}{g.msg}</p>
      <div className="gm-row">
        <button type="button" className="gm-btn primary" disabled={over} onClick={() => guess('higher')}>▲ Higher</button>
        <button type="button" className="gm-btn" disabled={over} onClick={() => guess('lower')}>▼ Lower</button>
      </div>
      {over && <Overlay title={players === 2 ? (winner === -1 ? 'Draw!' : `Player ${winner + 1} wins! 🎉`) : `Streak ended at ${g.streak[0]}`}
        sub={players === 2 ? `${g.streak[0]} – ${g.streak[1]}` : undefined}
        actions={<button type="button" className="gm-btn primary" onClick={() => setG(fresh())}>Play again</button>} />}
    </div>
  );
}

/* ───────────────────────── Crazy Eights (vs CPU) ───────────────────────── */
const canPlay = (c, top, suit) => c.r === '8' || c.s === suit || c.r === top.r;
function refill(st) {
  if (st.draw.length > 0 || st.pile.length <= 1) return st;
  const top = st.pile[st.pile.length - 1];
  return { ...st, draw: shuffle(st.pile.slice(0, -1)), pile: [top] };
}
export function ceStart() {
  const deck = newDeck();
  const you = deck.splice(0, 7), cpu = deck.splice(0, 7);
  let top = deck.shift();
  while (top.r === '8') { deck.push(top); top = deck.shift(); }
  return { draw: deck, pile: [top], you, cpu, turn: 'you', suit: top.s, msg: 'Match the suit or the rank. Eights are wild.', over: null, choosing: null, drew: false };
}
function ceDoPlay(st, who, card, suit) {
  const hand = st[who].filter(c => c.id !== card.id);
  const next = { ...st, [who]: hand, pile: [...st.pile, card], suit: card.r === '8' ? suit : card.s, choosing: null, drew: false };
  if (!hand.length) return { ...next, over: who, msg: who === 'you' ? 'You went out. You win! 🎉' : 'CPU went out.' };
  return { ...next, turn: who === 'you' ? 'cpu' : 'you', msg: card.r === '8' ? `${who === 'you' ? 'You' : 'CPU'} chose ${suit}.` : '' };
}
export function ceCpuMove(st) {
  if (st.turn !== 'cpu' || st.over) return st;
  const top = st.pile[st.pile.length - 1];
  const choose = (s) => {
    const playable = s.cpu.filter(c => canPlay(c, top, s.suit));
    return playable.find(c => c.r !== '8') || playable[0];
  };
  const bestSuit = (hand) => { const n = {}; hand.forEach(c => { n[c.s] = (n[c.s] || 0) + 1; }); return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || SUITS[rnd(4)]; };
  let s = st, card = choose(s);
  if (!card) {
    s = refill(s);
    if (!s.draw.length) return { ...s, turn: 'you', msg: 'CPU had to pass.' };
    const drawn = s.draw[s.draw.length - 1];
    s = { ...s, draw: s.draw.slice(0, -1), cpu: [...s.cpu, drawn] };
    if (!canPlay(drawn, top, s.suit)) return { ...s, turn: 'you', msg: 'CPU drew a card.' };
    card = drawn;
  }
  return ceDoPlay(s, 'cpu', card, bestSuit(s.cpu.filter(c => c.id !== card.id)));
}
export function CrazyEights() {
  const [g, setG] = useState(ceStart);
  const top = g.pile[g.pile.length - 1];
  const myPlayable = g.you.filter(c => canPlay(c, top, g.suit));
  const yourTurn = g.turn === 'you' && !g.over;

  useEffect(() => {
    if (g.turn !== 'cpu' || g.over) return undefined;
    const t = setTimeout(() => setG(ceCpuMove), 850);
    return () => clearTimeout(t);
  }, [g.turn, g.over]);

  const play = (card) => {
    if (!yourTurn || !canPlay(card, top, g.suit)) return;
    if (card.r === '8') setG({ ...g, choosing: card }); else setG(ceDoPlay(g, 'you', card));
  };
  const draw = () => {
    let s = refill(g);
    if (!s.draw.length) { setG({ ...s, turn: 'cpu', msg: 'Nothing to draw — you pass.' }); return; }
    const drawn = s.draw[s.draw.length - 1];
    s = { ...s, draw: s.draw.slice(0, -1), you: [...s.you, drawn] };
    if (canPlay(drawn, top, s.suit)) setG({ ...s, drew: true, msg: 'You drew a playable card — play it or pass.' });
    else setG({ ...s, turn: 'cpu', msg: 'You drew a card.' });
  };
  const red = (s) => s === '♥' || s === '♦';
  return (
    <div className="gm-table">
      <StatBar><Stat label="CPU cards" value={g.cpu.length} /><Stat label="Draw pile" value={g.draw.length} /><Stat label="Suit" value={<span style={{ color: red(g.suit) ? '#ff5c93' : 'inherit' }}>{g.suit}</span>} /></StatBar>
      <div className="gm-hand">{g.cpu.map(c => <PlayingCard key={c.id} faceDown small />)}</div>
      <div className="gm-row"><PlayingCard faceDown small /><PlayingCard card={top} /></div>
      <p className="gm-result">{g.over ? g.msg : g.turn === 'cpu' ? 'CPU is thinking…' : (g.msg || 'Your turn')}</p>
      {g.choosing && (
        <div className="gm-row"><span className="gm-hint">Choose a suit:</span>{SUITS.map(s => (
          <button key={s} type="button" className="gm-btn" style={{ color: red(s) ? '#ff5c93' : undefined, fontSize: 20 }} onClick={() => setG(ceDoPlay(g, 'you', g.choosing, s))}>{s}</button>))}</div>
      )}
      <div className="gm-hand">{g.you.map(c => <PlayingCard key={c.id} card={c} onClick={() => play(c)} disabled={!yourTurn || !canPlay(c, top, g.suit) || !!g.choosing} highlight={yourTurn && canPlay(c, top, g.suit)} dim={yourTurn && !canPlay(c, top, g.suit)} />)}</div>
      <div className="gm-row">
        <button type="button" className="gm-btn" onClick={draw} disabled={!yourTurn || myPlayable.length > 0 || g.drew || !!g.choosing}>Draw a card</button>
        {g.drew && yourTurn && <button type="button" className="gm-btn" onClick={() => setG({ ...g, turn: 'cpu', drew: false, msg: 'You passed.' })}>Pass</button>}
      </div>
      {g.over && <Overlay title={g.over === 'you' ? 'You win! 🎉' : 'CPU wins'} sub={g.msg} actions={<button type="button" className="gm-btn primary" onClick={() => setG(ceStart())}>Play again</button>} />}
    </div>
  );
}
