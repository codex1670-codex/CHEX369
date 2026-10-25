// Catalog of the built-in games that run in the browser (no server needed).
// `modes` lists which player counts a game supports: 1 = solo / vs CPU, 2 = two players on one device.
import { lazy } from 'react';

const L = (loader, name) => lazy(() => loader().then((m) => ({ default: m[name] })));
const card = () => import('./cardGames.jsx');
const racing = () => import('./racingGames.jsx');
const arcade = () => import('./arcadeGames.jsx');
const puzzle = () => import('./puzzleGames.jsx');
const party = () => import('./partyGames.jsx');
const two = () => import('./twoPlayerGames.jsx');

export const LOCAL_CATEGORIES = ['Card', 'Racing', 'Arcade', 'Puzzle', 'Party', 'Two Player'];

export const LOCAL_GAMES = [
  // ── Card ──
  { id: 'blackjack', online: 'duel-blackjack', name: 'Blackjack', icon: '🃏', category: 'Card', modes: [1], time: '5–15 min', blurb: 'Beat the dealer to 21 without going bust. Blackjack pays 3 to 2.', Component: L(card, 'Blackjack') },
  { id: 'card-war', online: 'card-war', soloLabel: 'vs CPU', name: 'Card War', icon: '⚔️', category: 'Card', modes: [1, 2], time: '2 min', blurb: 'Flip a card each — the higher card wins the round. Ties start a war!', Component: L(card, 'CardWar') },
  { id: 'higher-lower', online: 'higher-lower', name: 'Higher or Lower', icon: '📈', category: 'Card', modes: [1, 2], time: '2–5 min', blurb: 'Will the next card be higher or lower? Build the longest streak.', Component: L(card, 'HigherLower') },
  { id: 'crazy-eights', online: 'crazy-eights', name: 'Crazy Eights', icon: '8️⃣', category: 'Card', modes: [1], time: '5–10 min', blurb: 'Match suit or rank and be first to empty your hand. Eights are wild.', Component: L(card, 'CrazyEights') },
  // ── Racing ──
  { id: 'traffic-dodge', online: 'duel-traffic-dodge', name: 'Traffic Dodge', icon: '🚗', category: 'Racing', modes: [1], time: '1–3 min', blurb: 'Weave through traffic on a three-lane highway. It gets faster and faster.', Component: L(racing, 'TrafficDodge') },
  { id: 'circuit-race', online: 'circuit-race', soloLabel: 'vs CPU', name: 'Circuit Race', icon: '🏎️', category: 'Racing', modes: [1, 2], time: '1–2 min', blurb: 'Three laps around the oval. Beat the CPU or race a friend on one screen.', Component: L(racing, 'CircuitRace') },
  { id: 'drag-race', online: 'drag-race', soloLabel: 'vs CPU', name: 'Drag Race', icon: '🏁', category: 'Racing', modes: [1, 2], time: '1 min', blurb: 'Wait for GO, then mash your key. Jump the start and you get a penalty.', Component: L(racing, 'DragRace') },
  { id: 'launch-control', online: 'launch-control', name: 'Launch Control', icon: '🚦', category: 'Racing', modes: [1, 2], time: '2 min', blurb: 'Five lights, then lights out! Test your reaction time off the line.', Component: L(racing, 'LaunchControl') },
  // ── Arcade ──
  { id: 'snake', online: 'duel-snake', name: 'Snake', icon: '🐍', category: 'Arcade', modes: [1], time: '2–10 min', blurb: 'Eat, grow and don’t bite yourself. The classic.', Component: L(arcade, 'Snake') },
  { id: 'breakout', online: 'duel-breakout', name: 'Breakout', icon: '🧱', category: 'Arcade', modes: [1], time: '5–10 min', blurb: 'Bounce the ball and smash every brick. Levels get harder.', Component: L(arcade, 'Breakout') },
  { id: 'flappy-hop', online: 'duel-flappy-hop', name: 'Flappy Hop', icon: '🐤', category: 'Arcade', modes: [1], time: '1–5 min', blurb: 'Tap to hop through the gaps. Simple, tricky, addictive.', Component: L(arcade, 'FlappyHop') },
  { id: 'pong', online: 'pong', soloLabel: 'vs CPU', name: 'Pong', icon: '🏓', category: 'Arcade', modes: [1, 2], time: '3–5 min', blurb: 'First to 7. Play the CPU or share the keyboard with a friend.', Component: L(arcade, 'Pong') },
  // ── Puzzle ──
  { id: '2048', online: 'duel-2048', name: '2048', icon: '🔢', category: 'Puzzle', modes: [1], time: '5–15 min', blurb: 'Slide and merge matching tiles to reach 2048.', Component: L(puzzle, 'Game2048') },
  { id: 'memory-match', online: 'memory-match', name: 'Memory Match', icon: '🧠', category: 'Puzzle', modes: [1, 2], time: '2–4 min', blurb: 'Flip cards and find all the pairs. Solo for fewest moves, or duel a friend.', Component: L(puzzle, 'MemoryMatch') },
  { id: 'slide-puzzle', online: 'duel-slide-puzzle', name: 'Sliding Puzzle', icon: '🧩', category: 'Puzzle', modes: [1], time: '3–10 min', blurb: 'Slide the tiles back into order. Choose 3×3 or 4×4.', Component: L(puzzle, 'SlidePuzzle') },
  { id: 'lights-out', online: 'duel-lights-out', name: 'Lights Out', icon: '💡', category: 'Puzzle', modes: [1], time: '3–10 min', blurb: 'Every tap flips its neighbours. Switch every light off.', Component: L(puzzle, 'LightsOut') },
  // ── Party ──
  { id: 'trivia', online: 'trivia-duel', name: 'Trivia Quiz', icon: '❓', category: 'Party', modes: [1, 2], time: '3 min', blurb: 'Ten general-knowledge questions. Go solo or take turns with a friend.', Component: L(party, 'Trivia') },
  { id: 'truth-dare', online: 'truth-dare', name: 'Truth or Dare', icon: '🎭', category: 'Party', modes: [2], playersLabel: '2–8 players', time: 'Open ended', blurb: 'Spin to pick a player, then choose truth or dare. Friendly prompts only.', Component: L(party, 'TruthDare') },
  { id: 'pig-dice', online: 'pig-dice', soloLabel: 'vs CPU', name: 'Pig Dice Duel', icon: '🎲', category: 'Party', modes: [1, 2], time: '5 min', blurb: 'Push your luck! Roll to build points, hold to bank them — but a 1 wipes your turn.', Component: L(party, 'PigDice') },
  { id: 'simon', online: 'simon', name: 'Simon Says Colours', icon: '🔴', category: 'Party', modes: [1, 2], time: '3–5 min', blurb: 'Watch the pattern and repeat it. One mistake and you’re out.', Component: L(party, 'Simon') },
  // ── Two Player (same device or vs CPU) ──
  { id: 'ttt-local', online: 'tic-tac-toe', soloLabel: 'vs CPU', name: 'Tic-Tac-Toe', icon: '⭕', category: 'Two Player', modes: [1, 2], time: '2 min', blurb: 'Three in a row wins. Take turns on one screen or beat the CPU.', Component: L(two, 'TicTacToe') },
  { id: 'c4-local', online: 'connect-four', soloLabel: 'vs CPU', name: 'Connect Four', icon: '🔴', category: 'Two Player', modes: [1, 2], time: '5 min', blurb: 'Drop discs and connect four in any direction.', Component: L(two, 'ConnectFour') },
  { id: 'dots-boxes', online: 'dots-and-boxes', soloLabel: 'vs CPU', name: 'Dots & Boxes', icon: '🔲', category: 'Two Player', modes: [1, 2], time: '5–10 min', blurb: 'Draw lines, close boxes, and go again when you score.', Component: L(two, 'DotsBoxes') },
  { id: 'rps', online: 'rock-paper-scissors', soloLabel: 'vs CPU', name: 'Rock Paper Scissors', icon: '✊', category: 'Two Player', modes: [1, 2], time: '2 min', blurb: 'First to three rounds. Two players pick in secret, hot-seat style.', Component: L(two, 'RockPaperScissors') },
];

export const playersText = (g) => g.playersLabel || (g.modes.length === 2 ? '1–2 players' : g.modes[0] === 1 ? '1 player' : '2 players');
