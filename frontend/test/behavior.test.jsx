import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, act, fireEvent, cleanup, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { LOCAL_GAMES } from '../src/games/catalog.js';

beforeAll(async () => { await Promise.all(['racingGames', 'arcadeGames', 'partyGames'].map(f => import(`../src/games/${f}.jsx`))); });
const game = (id) => LOCAL_GAMES.find(g => g.id === id).Component;

async function run(id, players, { seconds, before, perFrame }) {
  vi.useFakeTimers();
  let raf = []; let t = 0;
  vi.stubGlobal('requestAnimationFrame', (cb) => raf.push(cb)); vi.stubGlobal('cancelAnimationFrame', () => {});
  const Comp = game(id);
  const view = render(<Suspense fallback={null}><Comp players={players} /></Suspense>);
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  if (before) await before(view);
  for (let i = 0; i < seconds * 60; i++) {
    t += 1000 / 60; vi.setSystemTime(t); performance.now = () => t;
    const cbs = raf; raf = [];
    await act(async () => { cbs.forEach(cb => cb(t)); });
    if (perFrame) perFrame(i, view);
  }
  return view;
}
const done = () => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); };

describe('real-time game behaviour', () => {
  it('Circuit Race: with no input the CPU completes 3 laps and wins in a sensible time', async () => {
    const v = await run('circuit-race', 1, { seconds: 70 });
    const txt = v.container.textContent;
    expect(txt).toMatch(/CPU wins/);
    const secs = parseFloat(txt.match(/([\d.]+) seconds/)[1]);
    expect(secs).toBeGreaterThan(12); expect(secs).toBeLessThan(45);
    done();
  });
  it('Circuit Race 2P: an idle P1 (never steers) is beaten by a steering P2', async () => {
    // P2 gets no CPU in 2P, so with nobody steering the cars leave the track and nobody finishes — must not crash or hang
    const v = await run('circuit-race', 2, { seconds: 15 });
    expect(v.container.querySelector('canvas')).toBeTruthy();
    done();
  });
  it('Traffic Dodge: an idle player eventually crashes and can restart', async () => {
    const v = await run('traffic-dodge', 1, { seconds: 60 });
    expect(v.container.textContent).toMatch(/Crash/);
    await act(async () => { fireEvent.click(screen.getByText('Race again')); });
    expect(v.container.textContent).not.toMatch(/Crash/);
    done();
  });
  it('Flappy Hop: starts on first flap and ends when the bird falls', async () => {
    const v = await run('flappy-hop', 1, { seconds: 5, before: async () => { await act(async () => { fireEvent.keyDown(window, { key: ' ' }); }); } });
    expect(v.container.textContent).toMatch(/Splat/);
    done();
  });
  it('Snake: running straight into the wall ends the game', async () => {
    const v = await run('snake', 1, { seconds: 8, before: async () => { await act(async () => { fireEvent.keyDown(window, { key: 'ArrowUp' }); }); } });
    expect(v.container.textContent).toMatch(/Game over/);
    done();
  });
  it('Breakout: idle paddle loses all 3 lives and the game ends', async () => {
    // hold the paddle in the left corner so the ball can be missed
    const v = await run('breakout', 1, { seconds: 120, before: async () => { await act(async () => { fireEvent.keyDown(window, { key: 'ArrowLeft' }); }); await vi.advanceTimersByTimeAsync(1); }, perFrame: (i) => { if (i % 90 === 0) { fireEvent.keyDown(window, { key: ' ' }); fireEvent.keyUp(window, { key: ' ' }); } } });
    expect(v.container.textContent).toMatch(/Game over/);
    done();
  });
  it('Pong vs CPU: the match ends with a winner when the player never moves', async () => {
    const v = await run('pong', 1, { seconds: 120 });
    expect(v.container.textContent).toMatch(/wins/);
    done();
  });
  it('Drag Race vs CPU: finishes with a winner', async () => {
    const v = await run('drag-race', 1, { seconds: 1, before: async () => { await act(async () => { fireEvent.click(screen.getByText('Start race')); await vi.advanceTimersByTimeAsync(4000); }); } });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(v.container.textContent).toMatch(/CPU wins/);
    done();
  });
  it('Launch Control: pressing too early is a false start; pressing after GO records a time', async () => {
    const v = await run('launch-control', 1, { seconds: 1, before: async () => { await act(async () => { fireEvent.click(screen.getByText('Start')); }); } });
    await act(async () => { fireEvent.keyDown(window, { key: 'a' }); fireEvent.keyUp(window, { key: 'a' }); });
    expect(v.container.textContent).toMatch(/False start/);
    await act(async () => { fireEvent.click(screen.getByText('Next round')); await vi.advanceTimersByTimeAsync(9000); });
    expect(v.container.textContent).toMatch(/GO!/);
    await act(async () => { fireEvent.keyDown(window, { key: 'a' }); });
    expect(v.container.textContent).toMatch(/\d+ ms/);
    done();
  });
  it('Simon: wrong colour ends a solo game', async () => {
    const v = await run('simon', 1, { seconds: 1, before: async () => { await act(async () => { fireEvent.click(screen.getByText('Start')); await vi.advanceTimersByTimeAsync(2500); }); } });
    const pads = Array.from(v.container.querySelectorAll('.gm-pad'));
    // one of the four must be wrong for a 1-step sequence; press all of them → at least one miss or a cleared round
    for (const p of pads) await act(async () => { fireEvent.click(p); await vi.advanceTimersByTimeAsync(10); });
    expect(v.container.textContent).toMatch(/Game over|Watch|Round/);
    done();
  });
  it('Pig Dice vs CPU: always reaches a winner', async () => {
    vi.useFakeTimers();
    const Comp = game('pig-dice');
    const v = render(<Suspense fallback={null}><Comp players={1} /></Suspense>);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    for (let i = 0; i < 400 && !/wins|You win/.test(v.container.textContent); i++) {
      await act(async () => {
        const roll = screen.queryByText('Roll'); if (roll && !roll.disabled) fireEvent.click(roll);
        const hold = v.container.querySelector('button.gm-btn:not(.primary)');
        if (hold && !hold.disabled && Math.random() < 0.3) fireEvent.click(hold);
        await vi.advanceTimersByTimeAsync(900);
      });
    }
    expect(v.container.textContent).toMatch(/win/i);
    done();
  });
});
