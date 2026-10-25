import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, act, fireEvent, screen, cleanup } from '@testing-library/react';
import { Suspense } from 'react';
import { LOCAL_GAMES } from '../src/games/catalog.js';

beforeAll(async () => { await Promise.all(['cardGames', 'racingGames', 'arcadeGames', 'puzzleGames'].map(f => import(`../src/games/${f}.jsx`))); });
const game = (id) => LOCAL_GAMES.find(g => g.id === id).Component;

async function play(id, seconds, setup) {
  vi.useFakeTimers();
  let raf = [], t = 0;
  vi.stubGlobal('requestAnimationFrame', (cb) => raf.push(cb)); vi.stubGlobal('cancelAnimationFrame', () => {});
  const duel = { onScore: vi.fn(), onEnd: vi.fn() };
  const Comp = game(id);
  const view = render(<Suspense fallback={null}><Comp players={1} duel={duel} /></Suspense>);
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  if (setup) await setup(view);
  for (let i = 0; i < seconds * 60 && !duel.onEnd.mock.calls.length; i++) { t += 1000 / 60; performance.now = () => t; const cbs = raf; raf = []; await act(async () => { cbs.forEach(cb => cb(t)); }); }
  return { duel, view };
}
const done = () => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); };

describe('solo games report their final score to a Score Duel', () => {
  it('Snake', async () => {
    const { duel } = await play('snake', 10, async () => { await act(async () => { fireEvent.keyDown(window, { key: 'ArrowUp' }); }); });
    expect(duel.onEnd).toHaveBeenCalledTimes(1); expect(typeof duel.onEnd.mock.calls[0][0]).toBe('number'); done();
  });
  it('Flappy Hop', async () => {
    const { duel } = await play('flappy-hop', 10, async () => { await act(async () => { fireEvent.keyDown(window, { key: ' ' }); }); });
    expect(duel.onEnd).toHaveBeenCalledTimes(1); done();
  });
  it('Traffic Dodge', async () => {
    const { duel } = await play('traffic-dodge', 90);
    expect(duel.onEnd).toHaveBeenCalledTimes(1); expect(duel.onEnd.mock.calls[0][0]).toBeGreaterThan(0); done();
  });
  it('Blackjack ends after exactly 10 hands with the chip count', async () => {
    vi.useFakeTimers();
    const duel = { onScore: vi.fn(), onEnd: vi.fn() };
    const Comp = game('blackjack');
    render(<Suspense fallback={null}><Comp duel={duel} /></Suspense>);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    for (let hand = 0; hand < 10; hand++) {
      await act(async () => { fireEvent.click(screen.getByText('Deal')); });
      for (let k = 0; k < 12 && screen.queryByText('Stand'); k++) await act(async () => { fireEvent.click(screen.getByText('Stand')); });
      if (hand < 9) await act(async () => { const b = screen.queryByText('Next hand'); if (b) fireEvent.click(b); });
    }
    expect(duel.onEnd).not.toHaveBeenCalled();                        // brief delay so the last result is visible
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(duel.onEnd).toHaveBeenCalledTimes(1); expect(typeof duel.onEnd.mock.calls[0][0]).toBe('number');
    expect(duel.onScore).toHaveBeenCalledTimes(10);
    cleanup(); vi.useRealTimers();
  });
  it('2048 reports its score as tiles merge', async () => {
    const { duel } = await play('2048', 1, async () => { for (let i = 0; i < 300; i++) await act(async () => { fireEvent.keyDown(window, { key: ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'][i % 4] }); fireEvent.keyUp(window, { key: ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'][i % 4] }); }); });
    expect(duel.onScore.mock.calls.some(c => c[0] > 0)).toBe(true); done();
  });
  it('Sliding puzzle and Lights Out hide the free-play buttons in a duel', async () => {
    for (const id of ['slide-puzzle', 'lights-out']) {
      const { view } = await play(id, 0);
      expect(screen.queryByText('Shuffle')).toBeNull(); expect(screen.queryByText('New puzzle')).toBeNull(); done();
    }
  });
});
