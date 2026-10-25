// Reversi / Othello. 8x8, index = row*8 + col. Black ('B') moves first.
// A player with no legal move is skipped automatically (the engine returns keepTurn);
// when neither side can move the player with more discs wins.
const SIZE = 8;
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const other = (m) => (m === 'B' ? 'W' : 'B');

function flipsFor(board, cell, mark) {
  if (board[cell] !== null) return [];
  const r0 = Math.floor(cell / SIZE), c0 = cell % SIZE;
  const out = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let r = r0 + dr, c = c0 + dc;
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r * SIZE + c] === other(mark)) {
      line.push(r * SIZE + c); r += dr; c += dc;
    }
    if (line.length && r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r * SIZE + c] === mark) out.push(...line);
  }
  return out;
}
export function reversiMoves(board, mark) {
  const moves = [];
  for (let i = 0; i < SIZE * SIZE; i++) if (flipsFor(board, i, mark).length) moves.push(i);
  return moves;
}
const count = (board, m) => board.filter((x) => x === m).length;

export function reversiInit(players) {
  const board = Array(64).fill(null);
  board[27] = 'W'; board[36] = 'W'; board[28] = 'B'; board[35] = 'B';
  const marks = { [players[0].user_id]: 'B', [players[1].user_id]: 'W' };
  return { board, turn: players[0].user_id, marks, winner: null, moves: reversiMoves(board, 'B'), score: { B: 2, W: 2 } };
}

export function reversiApplyMove(state, userId, move) {
  const cell = move?.cell;
  const mark = state.marks[userId];
  if (!Number.isInteger(cell) || cell < 0 || cell > 63) return { error: 'Invalid move.' };
  const flips = flipsFor(state.board, cell, mark);
  if (!flips.length) return { error: 'You must flip at least one disc.' };
  state.board[cell] = mark;
  for (const f of flips) state.board[f] = mark;
  state.score = { B: count(state.board, 'B'), W: count(state.board, 'W') };

  const opp = other(mark);
  const oppMoves = reversiMoves(state.board, opp);
  const myMoves = reversiMoves(state.board, mark);
  if (!oppMoves.length && !myMoves.length) {
    state.moves = [];
    const mine = state.score[mark], theirs = state.score[opp];
    return { winner: mine === theirs ? 'draw' : mine > theirs ? userId : Object.keys(state.marks).find((u) => state.marks[u] === opp) };
  }
  if (!oppMoves.length) { state.moves = myMoves; return { winner: null, keepTurn: true }; }
  state.moves = oppMoves;
  return { winner: null };
}
