import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { DotsBoxesBoard, RpsBoard, PigDiceBoard, MemoryBoard, TriviaBoard } from '../src/games/onlineBoards.jsx';

const me = 'u1', opp = 'u2';
const player = (id, name) => ({ slot: 0, ready: true, user: { id, displayName: name, username: name } });
const room = (state) => ({ id: 'r', players: [player(me, 'Me'), player(opp, 'Rival')], state });
const base = { scores: { [me]: 0, [opp]: 0 }, winner: null };

describe('online boards render server state and send the right moves', () => {
  it('Dots & Boxes: only clickable on your turn, sends line coordinates', () => {
    const state = { ...base, turn: me, h: Array(20).fill(false), v: Array(20).fill(false), boxes: Array(16).fill(null) };
    const onMove = vi.fn();
    const { container, rerender } = render(<DotsBoxesBoard room={room(state)} myId={me} onMove={onMove} />);
    const edges = container.querySelectorAll('.gm-edge'); expect(edges.length).toBe(40);
    fireEvent.click(edges[0]); expect(onMove).toHaveBeenCalledWith({ kind: 'h', r: 0, c: 0 });
    rerender(<DotsBoxesBoard room={room({ ...state, turn: opp })} myId={me} onMove={onMove} />);
    expect(container.querySelectorAll('.gm-edge').length).toBe(0);
  });
  it('Rock Paper Scissors: sends a pick, locks after picking, shows the revealed round', () => {
    const state = { ...base, turn: me, round: 1, picked: { [me]: false, [opp]: false }, last: null };
    const onMove = vi.fn();
    const { rerender } = render(<RpsBoard room={room(state)} myId={me} onMove={onMove} />);
    fireEvent.click(screen.getByLabelText('paper')); expect(onMove).toHaveBeenCalledWith({ pick: 'paper' });
    rerender(<RpsBoard room={room({ ...state, turn: opp, picked: { [me]: true, [opp]: false } })} myId={me} onMove={onMove} />);
    expect(screen.getByLabelText('rock').disabled).toBe(true);
    expect(screen.getByText(/Locked in/)).toBeTruthy();
    rerender(<RpsBoard room={room({ ...state, round: 2, last: { picks: { [me]: 'rock', [opp]: 'scissors' }, winner: me } })} myId={me} onMove={onMove} />);
    expect(screen.getByText(/You won the last round/)).toBeTruthy();
  });
  it('Pig Dice: roll/hold payloads, hold disabled with no points', () => {
    const onMove = vi.fn();
    const { rerender } = render(<PigDiceBoard room={room({ ...base, turn: me, pts: 0, roll: null, lastEvent: null })} myId={me} onMove={onMove} />);
    expect(screen.getByText(/Hold/).disabled).toBe(true);
    fireEvent.click(screen.getByText('Roll')); expect(onMove).toHaveBeenCalledWith({ action: 'roll' });
    rerender(<PigDiceBoard room={room({ ...base, turn: me, pts: 9, roll: 4, lastEvent: { by: me, type: 'roll', value: 4 } })} myId={me} onMove={onMove} />);
    fireEvent.click(screen.getByText(/Hold/)); expect(onMove).toHaveBeenCalledWith({ action: 'hold' });
  });
  it('Memory Match: shows revealed faces, sends card index, disables matched cards', () => {
    const board = Array(16).fill(null); board[3] = '🍕'; const matched = Array(16).fill(false); matched[5] = matched[6] = true; board[5] = board[6] = '🚀';
    const onMove = vi.fn();
    const { container } = render(<MemoryBoard room={room({ ...base, turn: me, board, matched })} myId={me} onMove={onMove} />);
    const cards = container.querySelectorAll('.gm-mem');
    expect(cards[3].textContent).toBe('🍕'); expect(cards[5].disabled).toBe(true);
    fireEvent.click(cards[0]); expect(onMove).toHaveBeenCalledWith({ cell: 0 });
  });
  it('Trivia Duel: shows the question, sends the option index, waits on opponent turn', () => {
    const state = { ...base, turn: me, index: 0, total: 10, question: { q: 'Capital of France?', options: ['Paris', 'Rome', 'Oslo', 'Bern'] }, last: null };
    const onMove = vi.fn();
    const { rerender } = render(<TriviaBoard room={room(state)} myId={me} onMove={onMove} />);
    fireEvent.click(screen.getByText('Rome')); expect(onMove).toHaveBeenCalledWith({ choice: 1 });
    rerender(<TriviaBoard room={room({ ...state, turn: opp, last: { by: opp, correct: true } })} myId={me} onMove={onMove} />);
    expect(screen.getByText('Rome').disabled).toBe(true); expect(screen.getByText(/Rival got the last one right/)).toBeTruthy();
  });
});
