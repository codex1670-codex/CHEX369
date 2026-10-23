import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent, screen, act, cleanup } from '@testing-library/react';
import { Suspense } from 'react';
import { WarBoard, HiLoBoard, TodBoard, EightsBoard, SimonBoard } from '../src/games/onlineBoards.jsx';
import { PongLive, DragLive, LaunchLive, CircuitLive } from '../src/games/onlineLive.jsx';
import DuelBoard, { DUEL_CFG } from '../src/games/DuelBoard.jsx';
import { LOCAL_GAMES } from '../src/games/catalog.js';
import { seedRandom, newDeck, rnd } from '../src/games/ui.jsx';
import { ONLINE_GAMES } from '../../backend/src/gameCatalog.js';
import { DUELS } from '../../backend/src/gameEngines/more.js';

const me = 'u1', opp = 'u2';
const pl = (id, n) => ({ slot: 0, ready: true, user: { id, displayName: n, username: n } });
const room = (state, gameId = 'x') => ({ id: 'r', gameId, players: [pl(me, 'Me'), pl(opp, 'Rival')], state });
const C = (r, s) => ({ r, s, id: r + s });

describe('every game has an online version', () => {
  it('each local game maps to a game the server really offers', () => {
    const server = new Set(ONLINE_GAMES.map((g) => g.id));
    for (const g of LOCAL_GAMES) expect(server.has(g.online), `${g.name} -> ${g.online}`).toBe(true);
    expect(LOCAL_GAMES).toHaveLength(24);
    expect(ONLINE_GAMES.length).toBe(27);
  });
  it('every duel has a front-end config and a matching server limit', () => {
    for (const id of Object.keys(DUELS)) { expect(DUEL_CFG[id], id).toBeTruthy(); expect(LOCAL_GAMES.find((g) => g.id === DUEL_CFG[id].local)).toBeTruthy(); }
  });
  it('the same seed gives both players the identical shuffle (and clearing it restores randomness)', () => {
    seedRandom(1234); const a = newDeck().map((c) => c.id).join(); const r1 = rnd(1000);
    seedRandom(1234); const b = newDeck().map((c) => c.id).join(); const r2 = rnd(1000);
    expect(a).toBe(b); expect(r1).toBe(r2);
    seedRandom(99); expect(newDeck().map((c) => c.id).join()).not.toBe(a);
    seedRandom(null);
  });
});

describe('turn-based online boards', () => {
  const base = { winner: null, scores: { [me]: 0, [opp]: 0 } };
  it('Card War flips only on your turn', () => {
    const onMove = vi.fn();
    const st = { ...base, turn: me, pot: 0, left: 52, last: null };
    const { rerender } = render(<WarBoard room={room(st)} myId={me} onMove={onMove} />);
    fireEvent.click(screen.getByText('Flip!')); expect(onMove).toHaveBeenCalledWith({ flip: true });
    rerender(<WarBoard room={room({ ...st, turn: opp, last: { cards: { [me]: C('K', '♠'), [opp]: C('2', '♥') }, winner: me, pot: 0 } })} myId={me} onMove={onMove} />);
    expect(screen.getByText(/Waiting for your opponent/).disabled).toBe(true); expect(screen.getByText(/You win the round/)).toBeTruthy();
  });
  it('Higher or Lower sends guesses and disables when you are out', () => {
    const onMove = vi.fn();
    const st = { ...base, turn: me, card: C('7', '♦'), streak: { [me]: 0, [opp]: 0 }, alive: { [me]: true, [opp]: true }, last: null };
    const { rerender } = render(<HiLoBoard room={room(st)} myId={me} onMove={onMove} />);
    fireEvent.click(screen.getByText(/Higher/)); expect(onMove).toHaveBeenCalledWith({ guess: 'higher' });
    rerender(<HiLoBoard room={room({ ...st, alive: { [me]: false, [opp]: true }, turn: opp })} myId={me} onMove={onMove} />);
    expect(screen.getByText(/Higher/).disabled).toBe(true); expect(screen.getByText(/You’re out/)).toBeTruthy();
  });
  it('Truth or Dare: pick, then done/skip', () => {
    const onMove = vi.fn();
    const { rerender } = render(<TodBoard room={room({ turn: me, phase: 'pick', count: 0 })} myId={me} onMove={onMove} />);
    fireEvent.click(screen.getByText('Truth')); expect(onMove).toHaveBeenCalledWith({ choose: 'truth' });
    rerender(<TodBoard room={room({ turn: me, phase: 'prompt', kind: 'dare', prompt: 'Do 10 jumping jacks right now.', count: 0 })} myId={me} onMove={onMove} />);
    fireEvent.click(screen.getByText(/Done/)); expect(onMove).toHaveBeenCalledWith({ next: true });
    fireEvent.click(screen.getByText(/Skip/)); expect(onMove).toHaveBeenCalledWith({ skip: true });
  });
  it('Crazy Eights shows ONLY my hand, plays legal cards, asks for a suit on an eight', () => {
    const onMove = vi.fn();
    const st = { turn: me, winner: null, hand: [C('5', '♠'), C('9', '♥'), C('8', '♣')], top: C('5', '♦'), suit: '♦', counts: { [me]: 3, [opp]: 4 }, drawCount: 30, drew: false, last: null };
    const { container } = render(<EightsBoard room={room(st)} myId={me} onMove={onMove} />);
    expect(container.querySelectorAll('.gm-card.back').length).toBe(4 + 1);          // rival's 4 hidden cards + draw pile
    fireEvent.click(screen.getByLabelText('5 of ♠')); expect(onMove).toHaveBeenCalledWith({ play: '5♠' });
    expect(screen.getByLabelText('9 of ♥').disabled).toBe(true);                      // not playable
    fireEvent.click(screen.getByLabelText('8 of ♣')); expect(screen.getByText('Choose a suit:')).toBeTruthy();
    fireEvent.click(screen.getByText('♥', { selector: 'button' })); expect(onMove).toHaveBeenCalledWith({ play: '8♣', suit: '♥' });
    expect(screen.getByText('Draw a card').disabled).toBe(true);                      // you have playable cards
  });
  it('Simon: replays the pattern, then sends the whole attempt', async () => {
    vi.useFakeTimers();
    const onMove = vi.fn();
    render(<SimonBoard room={room({ turn: me, seq: [2, 0], round: 2, winner: null, last: null })} myId={me} onMove={onMove} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    fireEvent.click(screen.getByLabelText('Pad 3')); expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Pad 1')); expect(onMove).toHaveBeenCalledWith({ seq: [2, 0] });
    cleanup(); vi.useRealTimers();
  });
});

describe('Score Duel wrapper', () => {
  const st = (extra) => ({ seed: 42, order: [me, opp], submitted: { [me]: false, [opp]: false }, result: null, winner: null, ...extra });
  it('shows waiting then final scores once both have submitted', () => {
    const { rerender } = render(<Suspense fallback={null}><DuelBoard room={room(st({ submitted: { [me]: true, [opp]: false } }), 'duel-snake')} myId={me} onMove={() => {}} /></Suspense>);
    expect(screen.getByText(/Score submitted/)).toBeTruthy(); expect(screen.getByText(/Waiting for Rival/)).toBeTruthy();
    rerender(<Suspense fallback={null}><DuelBoard room={room(st({ submitted: { [me]: true, [opp]: true }, result: { [me]: 120, [opp]: 90 }, winner: me }), 'duel-snake')} myId={me} onMove={() => {}} /></Suspense>);
    expect(screen.getByText('Final scores')).toBeTruthy(); expect(screen.getByText('120 pts')).toBeTruthy(); expect(screen.getByText('90 pts')).toBeTruthy();
  });
});

describe('live boards send inputs and render frames', () => {
  const order = { order: [me, opp], winner: null, realtime: true };
  beforeAll(async () => { await import('../src/games/racingGames.jsx'); });
  it('Pong sends direction changes from the keyboard, ignores typing', () => {
    const send = vi.fn();
    const { container, unmount } = render(<PongLive room={room(order, 'pong')} myId={me} frame={{ t: 'pong', y: [100, 130], ball: { x: 200, y: 130 }, score: [2, 3] }} send={send} />);
    expect(container.textContent).toMatch(/You \(left\)/);
    fireEvent.keyDown(window, { key: 's' }); expect(send).toHaveBeenLastCalledWith({ dir: 1 });
    fireEvent.keyUp(window, { key: 's' }); expect(send).toHaveBeenLastCalledWith({ dir: 0 });
    fireEvent.keyDown(window, { key: 'ArrowUp' }); expect(send).toHaveBeenLastCalledWith({ dir: -1 });
    fireEvent.keyUp(window, { key: 'ArrowUp' });
    const input = document.createElement('input'); document.body.appendChild(input);
    send.mockClear(); fireEvent.keyDown(input, { key: 'w' }); expect(send).not.toHaveBeenCalled();
    unmount();
  });
  it('Drag Race taps and shows both lanes', () => {
    const send = vi.fn();
    const { container } = render(<DragLive room={room(order, 'drag-race')} myId={me} frame={{ t: 'drag', phase: 'go', msg: 'GO!', pos: [10, 30], len: 60 }} send={send} />);
    expect(container.querySelectorAll('.gm-lane').length).toBe(2);
    fireEvent.pointerDown(screen.getByText(/TAP!/)); expect(send).toHaveBeenCalledWith({ tap: true });
    fireEvent.keyDown(window, { key: ' ' }); expect(send).toHaveBeenCalledTimes(2);
  });
  it('Launch Control shows lit lights and sends a press', () => {
    const send = vi.fn();
    const { container } = render(<LaunchLive room={room(order, 'launch-control')} myId={me} frame={{ t: 'launch', phase: 'lights', lit: 3, msg: 'Wait for it…', wins: [1, 0], round: 2 }} send={send} />);
    expect(container.querySelectorAll('.gm-light.on').length).toBe(3);
    fireEvent.pointerDown(screen.getByText(/HIT IT/)); expect(send).toHaveBeenCalledWith({ press: true });
  });
  it('Circuit Race (online) streams my car to the server and copies the rival from frames', async () => {
    vi.useFakeTimers();
    let raf = []; vi.stubGlobal('requestAnimationFrame', (cb) => raf.push(cb)); vi.stubGlobal('cancelAnimationFrame', () => {});
    const send = vi.fn();
    const frame = { t: 'circuit', phase: 'go', cd: 0, cars: { [opp]: { x: 210, y: 40, h: 0, progress: 1.5 } } };
    render(<Suspense fallback={null}><CircuitLive room={room(order, 'circuit-race')} myId={me} frame={frame} send={send} /></Suspense>);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    fireEvent.keyDown(window, { key: 'd' });
    let t = 0;
    for (let i = 0; i < 120; i++) { t += 16; const cbs = raf; raf = []; await act(async () => { cbs.forEach((cb) => cb(t)); }); }
    const cars = send.mock.calls.map((c) => c[0].car).filter(Boolean);
    expect(cars.length).toBeGreaterThan(10);
    expect(cars.at(-1)).toEqual(expect.objectContaining({ x: expect.any(Number), progress: expect.any(Number) }));
    expect(cars.at(-1).x).not.toBe(cars[0].x); // my car is moving
    cleanup(); vi.useRealTimers(); vi.unstubAllGlobals();
  });
});
