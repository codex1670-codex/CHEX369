// The online (server-authoritative, 2-player) game catalog.
//
// This used to be inserted only by `npm run seed`, which production never runs (the Docker
// image starts `node src/index.js`). A fresh deploy therefore had an EMPTY catalog and every
// "Play" button answered "That game is not available." Now it runs on every boot; INSERT OR
// IGNORE makes it idempotent and it never touches rows that already exist.
export const ONLINE_GAMES = [
  { id: 'tic-tac-toe', name: 'Tic-Tac-Toe', category: 'Board' },
  { id: 'connect-four', name: 'Connect Four', category: 'Board' },
  { id: 'checkers', name: 'Checkers', category: 'Board' },
  { id: 'chess', name: 'Chess', category: 'Board' },
  { id: 'reversi', name: 'Reversi', category: 'Board' },
  { id: 'dots-and-boxes', name: 'Dots & Boxes', category: 'Board' },
  { id: 'rock-paper-scissors', name: 'Rock Paper Scissors', category: 'Party' },
  { id: 'pig-dice', name: 'Pig Dice Duel', category: 'Party' },
  { id: 'memory-match', name: 'Memory Match', category: 'Puzzle' },
  { id: 'trivia-duel', name: 'Trivia Duel', category: 'Party' },
  // Card
  { id: 'card-war', name: 'Card War', category: 'Card' },
  { id: 'higher-lower', name: 'Higher or Lower', category: 'Card' },
  { id: 'crazy-eights', name: 'Crazy Eights', category: 'Card' },
  { id: 'duel-blackjack', name: 'Blackjack Duel', category: 'Card' },
  // Racing (live)
  { id: 'circuit-race', name: 'Circuit Race', category: 'Racing' },
  { id: 'drag-race', name: 'Drag Race', category: 'Racing' },
  { id: 'launch-control', name: 'Launch Control', category: 'Racing' },
  { id: 'duel-traffic-dodge', name: 'Traffic Dodge Duel', category: 'Racing' },
  // Arcade
  { id: 'pong', name: 'Pong', category: 'Arcade' },
  { id: 'duel-snake', name: 'Snake Duel', category: 'Arcade' },
  { id: 'duel-breakout', name: 'Breakout Duel', category: 'Arcade' },
  { id: 'duel-flappy-hop', name: 'Flappy Hop Duel', category: 'Arcade' },
  // Puzzle
  { id: 'duel-2048', name: '2048 Duel', category: 'Puzzle' },
  { id: 'duel-slide-puzzle', name: 'Sliding Puzzle Race', category: 'Puzzle' },
  { id: 'duel-lights-out', name: 'Lights Out Race', category: 'Puzzle' },
  // Party
  { id: 'simon', name: 'Simon Says Colours', category: 'Party' },
  { id: 'truth-dare', name: 'Truth or Dare', category: 'Party' },
];

export function seedGameCatalog(db) {
  const insert = db.prepare('INSERT OR IGNORE INTO games (id, name, category, min_players, max_players) VALUES (?, ?, ?, 2, 2)');
  for (const g of ONLINE_GAMES) insert.run(g.id, g.name, g.category);
}
