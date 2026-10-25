import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, act, fireEvent, cleanup } from '@testing-library/react';
import { Suspense } from 'react';
import { LOCAL_GAMES, LOCAL_CATEGORIES } from '../src/games/catalog.js';
import { handValue, settleBlackjack, ceStart, ceCpuMove } from '../src/games/cardGames.jsx';
import { slideLine, move2048, canMove2048, slideShuffle, isSolved, loGenerate, loPress } from '../src/games/puzzleGames.jsx';
import { tttResult, tttCpu, c4Drop, c4Result, c4Cpu, dbApply, dbCpu, dbMoves, rpsWinner } from '../src/games/twoPlayerGames.jsx';
import { TRIVIA, triviaRound } from '../src/games/partyGames.jsx';

const C = (r, s = '♠') => ({ r, s, id: r + s });

describe('catalog', () => {
  it('has exactly 4 games in each of Card, Racing, Arcade, Puzzle, Party and Two Player', () => {
    for (const cat of LOCAL_CATEGORIES) expect(LOCAL_GAMES.filter(g => g.category === cat), cat).toHaveLength(4);
    expect(new Set(LOCAL_GAMES.map(g => g.id)).size).toBe(LOCAL_GAMES.length);
  });
});

describe('card logic', () => {
  it('values hands with soft aces', () => {
    expect(handValue([C('A'), C('K')])).toBe(21);
    expect(handValue([C('A'), C('A'), C('9')])).toBe(21);
    expect(handValue([C('K'), C('Q'), C('5')])).toBe(25);
  });
  it('settles blackjack payouts', () => {
    const base = { deck: [C('2')], dealer: [C('10'), C('8')], stake: 10 };
    expect(settleBlackjack({ ...base, player: [C('10'), C('9')] }, false).pay).toBe(20); // 19 beats 18
    expect(settleBlackjack({ ...base, player: [C('10'), C('8')] }, false).pay).toBe(10); // push
    expect(settleBlackjack({ ...base, player: [C('10'), C('5'), C('9')] }, false).pay).toBe(0); // bust
    expect(settleBlackjack({ ...base, player: [C('A'), C('K')] }, true).pay).toBe(25); // 3:2
  });
  it('crazy eights deals 7 each and the CPU always makes a legal move', () => {
    for (let i = 0; i < 50; i++) {
      let s = ceStart();
      expect(s.you).toHaveLength(7); expect(s.cpu).toHaveLength(7); expect(s.pile[0].r).not.toBe('8');
      s = { ...s, turn: 'cpu' };
      const n = ceCpuMove(s);
      expect(n.turn === 'you' || n.over).toBeTruthy();
      expect(n.cpu.length + n.pile.length + n.draw.length + n.you.length).toBe(52);
    }
  });
});

describe('puzzle logic', () => {
  it('2048 merges once per pair and reports gained score', () => {
    expect(slideLine([2, 2, 2, 2])).toEqual({ line: [4, 4, 0, 0], gained: 8 });
    expect(slideLine([2, 0, 2, 4]).line).toEqual([4, 4, 0, 0]);
    const r = move2048([2, 0, 0, 2, ...Array(12).fill(0)], 'left');
    expect(r.board.slice(0, 4)).toEqual([4, 0, 0, 0]); expect(r.moved).toBe(true);
    expect(move2048([2, 4, 8, 16, ...Array(12).fill(0)], 'left').moved).toBe(false);
    expect(canMove2048([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2])).toBe(false);
  });
  it('sliding puzzle shuffles are never already solved and keep all tiles', () => {
    for (const n of [3, 4]) for (let i = 0; i < 30; i++) { const b = slideShuffle(n); expect(isSolved(b)).toBe(false); expect([...b].sort((a, c) => a - c)).toEqual([...Array(n * n).keys()]); }
  });
  it('lights out puzzles start unsolved and pressing twice undoes', () => {
    for (let l = 1; l < 8; l++) expect(loGenerate(l).some(Boolean)).toBe(true);
    const b = loGenerate(1); expect(loPress(loPress(b, 12), 12)).toEqual(b);
  });
});

describe('two-player logic', () => {
  it('tic-tac-toe detects wins/draws and the CPU wins or blocks when it can', () => {
    expect(tttResult(['X', 'X', 'X', null, null, null, null, null, null]).mark).toBe('X');
    expect(tttResult(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']).mark).toBe('draw');
    expect(tttCpu(['O', 'O', null, 'X', 'X', null, null, null, null])).toBe(2);   // win first
    expect(tttCpu(['X', 'X', null, 'O', null, null, null, null, null])).toBe(2);  // then block
  });
  it('connect four drops, detects 4-in-a-row and the CPU blocks', () => {
    let b = Array(42).fill(null);
    for (let i = 0; i < 4; i++) b = c4Drop(b, i, 'R').board;
    expect(c4Result(b).mark).toBe('R');
    let b2 = Array(42).fill(null);
    for (let i = 0; i < 3; i++) b2 = c4Drop(b2, i, 'R').board;
    expect(c4Cpu(b2)).toBe(3);
    let full = Array(42).fill(null); for (let i = 0; i < 6; i++) full = c4Drop(full, 0, 'R')?.board ?? full;
    expect(c4Drop(full, 0, 'Y')).toBeNull();
  });
  it('dots & boxes completes boxes, grants another go, and the CPU finishes a full game', () => {
    let s = { h: Array(20).fill(false), v: Array(20).fill(false), boxes: Array(16).fill(null) };
    for (const [k, r, c] of [['h', 0, 0], ['h', 1, 0], ['v', 0, 0]]) s = { ...s, ...dbApply(s, k, r, c, 0) };
    const done = dbApply(s, 'v', 0, 1, 0);
    expect(done.got).toBe(1); expect(done.boxes[0]).toBe(0);
    let g = { h: Array(20).fill(false), v: Array(20).fill(false), boxes: Array(16).fill(null) }, turn = 0, guard = 0;
    while (g.boxes.some(b => b === null) && guard++ < 100) {
      const [k, r, c] = dbCpu(g); const n = dbApply(g, k, r, c, turn); g = { h: n.h, v: n.v, boxes: n.boxes }; if (!n.got) turn = 1 - turn;
    }
    expect(g.boxes.every(b => b !== null)).toBe(true); expect(dbMoves(g)).toHaveLength(0);
  });
  it('rock paper scissors rules', () => {
    expect(rpsWinner('rock', 'scissors')).toBe(0); expect(rpsWinner('rock', 'paper')).toBe(1); expect(rpsWinner('paper', 'paper')).toBe(-1);
  });
});

describe('trivia data', () => {
  it('every question has 4 distinct options including the answer', () => {
    for (const [q, a, w] of TRIVIA) { expect(q).toBeTruthy(); expect(new Set([a, ...w]).size).toBe(4); }
    expect(triviaRound(10)).toHaveLength(10);
  });
});

beforeAll(async () => { await Promise.all(['cardGames', 'racingGames', 'arcadeGames', 'puzzleGames', 'partyGames', 'twoPlayerGames'].map(f => import(`../src/games/${f}.jsx`))); });

// ── Smoke-test every game: render, click everything, press keys, run animation frames ──
describe.each(LOCAL_GAMES.flatMap(g => g.modes.map(m => [g.name, m, g])))('%s (%i player)', (_n, players, game) => {
  it('renders, accepts input and runs frames without crashing', async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let raf = []; vi.stubGlobal('requestAnimationFrame', (cb) => raf.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const Comp = game.Component;
    const view = render(<Suspense fallback={null}><Comp players={players} /></Suspense>);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    await act(async () => { await Promise.resolve(); });
    expect(view.container.innerHTML.length).toBeGreaterThan(50);
    const frames = async (n) => { for (let i = 0; i < n; i++) { const cbs = raf; raf = []; await act(async () => { cbs.forEach(cb => cb(performance.now() + i * 16)); }); } };
    for (let round = 0; round < 3; round++) {
      for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'a', 'd', 'w', 's', 'l']) { fireEvent.keyDown(window, { key: k }); fireEvent.keyUp(window, { key: k }); }
      for (const b of Array.from(view.container.querySelectorAll('button:not([disabled])')).slice(0, 12)) {
        await act(async () => { fireEvent.pointerDown(b); fireEvent.click(b); fireEvent.pointerUp(b); });
      }
      const cv = view.container.querySelector('canvas');
      if (cv) await act(async () => { fireEvent.pointerDown(cv, { clientX: 100, clientY: 100 }); fireEvent.pointerMove(cv, { clientX: 150, clientY: 120 }); fireEvent.pointerUp(cv); });
      await frames(40);
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    }
    expect(errors.mock.calls.filter(c => /Warning|Error|Uncaught/.test(String(c[0])))).toEqual([]);
    cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); errors.mockRestore();
  });
});
