import { Suspense, lazy, useEffect, useState } from 'react';
import { api } from '../api.js';
import Avatar from '../components/Avatar.jsx';
import { useAuth } from '../AuthContext.jsx';
import { connectSocket } from '../socket.js';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import { DotsBoxesBoard, RpsBoard, PigDiceBoard, MemoryBoard, TriviaBoard, WarBoard, HiLoBoard, SimonBoard, TodBoard, EightsBoard } from '../games/onlineBoards.jsx';

// Heavier boards (canvas / real-time / solo-game duels) load only when a room needs them.
const live = (name) => lazy(() => import('../games/onlineLive.jsx').then((m) => ({ default: m[name] })));
const PongLive = live('PongLive'), DragLive = live('DragLive'), LaunchLive = live('LaunchLive'), CircuitLive = live('CircuitLive');
const DuelBoard = lazy(() => import('../games/DuelBoard.jsx'));
import { LOCAL_GAMES, LOCAL_CATEGORIES, playersText } from '../games/catalog.js';

const TABS = ['discover', '2players', 'friends', 'mine', 'tournaments'];


const GAME_META = {
  'tic-tac-toe': { icon: '⭕', category: 'Board', estTime: '2–5 min', name: 'Tic-Tac-Toe' },
  'connect-four': { icon: '🔴', category: 'Board', estTime: '5–10 min', name: 'Connect Four' },
  'checkers': { icon: '⚫', category: 'Board', estTime: '10–20 min', name: 'Checkers' },
  'chess': { icon: '♞', category: 'Board', estTime: '15–40 min', name: 'Chess' },
  'reversi': { icon: '⚪', category: 'Board', estTime: '10–20 min', name: 'Reversi' },
  'dots-and-boxes': { icon: '🔲', category: 'Board', estTime: '5–10 min', name: 'Dots & Boxes' },
  'rock-paper-scissors': { icon: '✊', category: 'Party', estTime: '2 min', name: 'Rock Paper Scissors' },
  'pig-dice': { icon: '🎲', category: 'Party', estTime: '5 min', name: 'Pig Dice Duel' },
  'memory-match': { icon: '🧠', category: 'Puzzle', estTime: '3–5 min', name: 'Memory Match' },
  'trivia-duel': { icon: '❓', category: 'Party', estTime: '3 min', name: 'Trivia Duel' },
};

// Every local game has an online twin (its id is in `online`). Reuse the icon/time so the
// online list and room header show the right thing without a second table.
for (const g of LOCAL_GAMES) {
  if (g.online && !GAME_META[g.online]) GAME_META[g.online] = { icon: g.icon, category: g.category, estTime: g.time, name: g.name };
}
const LIVE_IDS = new Set(['pong', 'drag-race', 'launch-control', 'circuit-race']);
const kindLabel = (id) => (id.startsWith('duel-') ? 'Score duel · same run on your own devices' : LIVE_IDS.has(id) ? 'Live head-to-head' : 'Turn-based · 2 players');
const ONLINE_ORDER = ['Card', 'Racing', 'Arcade', 'Puzzle', 'Party', 'Board'];
function gameName(gameId) { return GAME_META[gameId]?.name || gameId; }

function TicTacToeBoard({ room, myId, onMove }) {
  const { board, turn, marks } = room.state;
  const myTurn = turn === myId && !room.state.winner;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 84px)', gap: 8, justifyContent: 'center' }}>
      {board.map((cell, i) => (
        <button key={i} onClick={() => !cell && myTurn && onMove(i)}
          style={{ width: 84, height: 84, borderRadius: 14, fontSize: 32, fontWeight: 700,
            background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-soft)',
            color: cell === marks[myId] ? 'var(--violet-bright)' : 'var(--pink)',
            cursor: !cell && myTurn ? 'pointer' : 'default' }}>
          {cell}
        </button>
      ))}
    </div>
  );
}

function ConnectFourBoard({ room, myId, onMove }) {
  const { board, turn, marks } = room.state;
  const myTurn = turn === myId && !room.state.winner;
  const COLS = 7, ROWS = 6;
  return (
    <div style={{ display: 'inline-grid', gridTemplateColumns: `repeat(${COLS}, 36px)`, gap: 4, background: 'rgba(124,92,255,0.12)', padding: 8, borderRadius: 12 }}>
      {Array.from({ length: ROWS * COLS }).map((_, i) => {
        const col = i % COLS;
        const cell = board[i];
        const color = cell === marks[myId] ? 'var(--violet-bright)' : cell ? 'var(--pink)' : 'rgba(255,255,255,0.08)';
        return (
          <button key={i} onClick={() => myTurn && onMove(col)} disabled={!myTurn}
            style={{ width: 36, height: 36, borderRadius: '50%', background: color, border: 'none', cursor: myTurn ? 'pointer' : 'default' }} />
        );
      })}
    </div>
  );
}

function CheckersBoard({ room, myId, onMove }) {
  const [selected, setSelected] = useState(null);
  const { board, turn, marks } = room.state;
  const myMark = marks[myId];
  const myTurn = turn === myId && !room.state.winner;

  const isMine = (piece) => piece && piece.toLowerCase() === myMark;

  const handleClick = (i) => {
    if (!myTurn) return;
    if (selected === null) {
      if (isMine(board[i])) setSelected(i);
      return;
    }
    if (i === selected) { setSelected(null); return; }
    if (isMine(board[i])) { setSelected(i); return; }
    onMove({ from: selected, to: i });
    setSelected(null);
  };

  return (
    <div style={{ display: 'inline-grid', gridTemplateColumns: 'repeat(8, 40px)', gap: 0, border: '2px solid var(--border-soft)', borderRadius: 8, overflow: 'hidden' }}>
      {board.map((cell, i) => {
        const row = Math.floor(i / 8), col = i % 8;
        const dark = (row + col) % 2 === 1;
        const isKing = cell && cell === cell.toUpperCase() && cell.toLowerCase() !== cell;
        return (
          <div key={i} onClick={() => dark && handleClick(i)}
            style={{
              width: 40, height: 40, background: dark ? (selected === i ? 'rgba(124,92,255,0.35)' : 'rgba(255,255,255,0.05)') : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: dark && myTurn ? 'pointer' : 'default',
            }}>
            {cell && (
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: cell.toLowerCase() === myMark ? 'var(--violet-bright)' : 'var(--pink)',
                border: isKing ? '2px solid gold' : 'none',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

const CHESS_GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

// Chess board. The server stores white on rows 0–1 and files a–h as columns 0–7. Each player
// should see their own pieces at the bottom with the standard orientation (a1 bottom-left for
// white, h8 bottom-left for black), so white's view flips the ROWS and black's view flips the
// COLUMNS. (A 180° rotation for white would draw a mirror-image board with king and queen
// swapped.) `toActual` maps a displayed square back to the real board index before anything is
// sent to the server.
function ChessBoard({ room, myId, onMove }) {
  const [selected, setSelected] = useState(null); // actual board index
  const { board, turn, colors, check, winner } = room.state;
  const myColor = colors[myId];
  const myTurn = turn === myId && !winner;
  const flipped = myColor === 'w';
  const toActual = (d) => {
    const dr = Math.floor(d / 8), dc = d % 8;
    return flipped ? (7 - dr) * 8 + dc : dr * 8 + (7 - dc);
  };

  const handleClick = (displayIdx) => {
    if (!myTurn) return;
    const i = toActual(displayIdx);
    const piece = board[i];
    if (selected === null) { if (piece && piece.color === myColor) setSelected(i); return; }
    if (i === selected) { setSelected(null); return; }
    if (piece && piece.color === myColor) { setSelected(i); return; }
    onMove({ from: [Math.floor(selected / 8), selected % 8], to: [Math.floor(i / 8), i % 8] });
    setSelected(null);
  };

  const kingInCheckIdx = check ? board.findIndex(p => p && p.type === 'k' && p.color === check) : -1;
  return (
    <div>
      <div style={{ display: 'inline-grid', gridTemplateColumns: 'repeat(8, min(44px, calc((100vw - 56px) / 8)))', border: '2px solid var(--border-soft)', borderRadius: 8, overflow: 'hidden' }}>
        {Array.from({ length: 64 }, (_, d) => {
          const i = toActual(d);
          const piece = board[i];
          const row = Math.floor(d / 8), col = d % 8;
          const dark = (row + col) % 2 === 1;
          const bg = i === selected ? 'rgba(124,92,255,0.55)' : i === kingInCheckIdx ? 'rgba(255,92,147,0.55)' : dark ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.02)';
          return (
            <div key={d} onClick={() => handleClick(d)}
              style={{ width: 44, height: 44, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, lineHeight: 1, cursor: myTurn ? 'pointer' : 'default', userSelect: 'none' }}>
              {piece && (
                <span style={{ color: piece.color === 'w' ? '#f4f1ff' : '#150f24', textShadow: piece.color === 'w' ? '0 0 2px #000, 0 1px 3px rgba(0,0,0,0.7)' : '0 0 2px #cbb8ff, 0 0 4px rgba(203,184,255,0.7)' }}>
                  {CHESS_GLYPH[piece.type]}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--text-mid)' }}>
        You play {myColor === 'w' ? 'white' : 'black'}.{check && !winner ? (check === myColor ? ' ⚠️ You are in check!' : ' Check!') : ''}
        <div style={{ opacity: 1, marginTop: 4 }}>Simplified rules: no castling or en passant, and pawns always promote to a queen.</div>
      </div>
    </div>
  );
}

// Reversi: the server sends the list of legal squares for whoever's turn it is.
function ReversiBoard({ room, myId, onMove }) {
  const { board, turn, marks, winner, moves = [], score = { B: 2, W: 2 } } = room.state;
  const myMark = marks[myId];
  const myTurn = turn === myId && !winner;
  return (
    <div>
      <div className="gm-rv" role="grid" aria-label="Reversi board">
        {board.map((cell, i) => {
          const legal = myTurn && moves.includes(i);
          return (
            <button key={i} type="button" className={`gm-rv-cell ${legal ? 'legal' : ''}`} disabled={!legal} onClick={() => onMove(i)} aria-label={cell ? (cell === 'B' ? 'Black disc' : 'White disc') : legal ? 'Legal move' : 'Empty'}>
              {cell && <span className={`gm-disc ${cell === 'B' ? 'black' : 'white'}`} />}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--text-mid)' }}>
        You play {myMark === 'B' ? 'black (moves first)' : 'white'} · Black {score.B} – White {score.W}
        <div style={{ marginTop: 4 }}>Flip at least one disc each turn. If you have no move you are skipped automatically.</div>
      </div>
    </div>
  );
}

function LocalGameView({ game, players, onExit }) {
  const [round, setRound] = useState(0);
  const C = game.Component;
  return (
    <div>
      <button className="btn-ghost" style={{ marginBottom: 16 }} onClick={onExit}>← Back to Game Store</button>
      <div className="glass-card gm-frame">
        <div className="gm-head">
          <div>
            <div className="gm-title">{game.icon} {game.name}</div>
            <div className="gm-sub">{players === 2 ? (game.playersLabel || '2 players · same device') : '1 player'} · {game.category}</div>
          </div>
          <button className="btn-ghost" onClick={() => setRound(r => r + 1)}>↺ Restart</button>
        </div>
        <ErrorBoundary key={round} title="This game hit a problem." onReset={() => setRound(r => r + 1)}>
          <Suspense fallback={<div className="empty-state"><span className="loading-dot" /></div>}>
            <C key={round} players={players} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}

function LocalGameCard({ g, onPlay, onOnline }) {
  const solo = g.modes.includes(1), duo = g.modes.includes(2);
  return (
    <div className="glass-card gm-listing">
      <div className="gm-listing-icon" aria-hidden="true">{g.icon}</div>
      <div style={{ flex: 1, minWidth: 170 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 15.5 }}>{g.name}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-mid)', margin: '2px 0' }}>{g.blurb}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-low)' }}>{playersText(g)} · {g.time}</div>
      </div>
      {solo && <button className="btn-primary" style={{ width: 'auto', padding: '9px 16px' }} onClick={() => onPlay(g, 1)}>{duo ? (g.soloLabel || '1 Player') : 'Play'}</button>}
      {g.online && onOnline && <button className="btn-ghost" onClick={() => onOnline(g.online)} title="Create a room and send the code to a friend">🌐 Online</button>}
      {duo && <button className={solo ? 'btn-ghost' : 'btn-primary'} style={solo ? undefined : { width: 'auto', padding: '9px 16px' }} onClick={() => onPlay(g, 2)}>{solo ? '2 Players' : 'Play'}</button>}
    </div>
  );
}

function RoomView({ room: initialRoom, onLeave }) {
  const { user } = useAuth();
  const [room, setRoom] = useState(initialRoom);
  const [error, setError] = useState('');
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteStatus, setInviteStatus] = useState('');
  const [frame, setFrame] = useState(null); // latest live frame (real-time games)

  useEffect(() => {
    const socket = connectSocket();
    const onState = (r) => { if (r.id === room.id) setRoom(r); };
    const onFrame = (f) => { if (f.roomId === room.id) setFrame(f); };
    const onErr = (e) => setError(e.message);
    socket.on('game:state', onState);
    socket.on('game:error', onErr);
    socket.on('game:frame', onFrame);
    socket.emit('game:join', { roomId: room.id });
    return () => { socket.off('game:state', onState); socket.off('game:error', onErr); socket.off('game:frame', onFrame); };
    // eslint-disable-next-line
  }, [room.id]);

  const ready = () => connectSocket().emit('game:ready', { roomId: room.id });
  const move = (payload) => {
    if (payload && typeof payload === 'object') {
      connectSocket().emit('game:move', { roomId: room.id, move: payload });
    } else {
      connectSocket().emit('game:move', { roomId: room.id, cell: payload });
    }
  };
  const sendInput = (input) => connectSocket().emit('game:input', { roomId: room.id, input });
  const leave = () => { connectSocket().emit('game:leave', { roomId: room.id }); onLeave(); };
  const sendInvite = async (e) => {
    e.preventDefault();
    try {
      const res = await api.inviteToGameRoom(room.id, inviteUsername.trim());
      setInviteStatus(res.status === 'sent' ? `Invited @${inviteUsername}.` : res.message);
      setInviteUsername('');
    } catch (err) { setInviteStatus(err.message); }
  };

  const [copied, setCopied] = useState('');
  const flash = (what) => { setCopied(what); setTimeout(() => setCopied(''), 1800); };
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch { return false; }
    }
  };
  const copyCode = async () => { if (await copyText(room.inviteCode)) flash('code'); else setError(`Couldn't copy. The code is ${room.inviteCode}.`); };
  const shareRoom = async () => {
    const link = `${window.location.origin}/?join=${room.inviteCode}`;
    const text = `Join my ${gameName(room.gameId)} game on CHEX! Room code: ${room.inviteCode}`;
    if (navigator.share) { try { await navigator.share({ title: 'CHEX game invite', text, url: link }); return; } catch (err) { if (err?.name === 'AbortError') return; } }
    if (await copyText(`${text}\n${link}`)) flash('link'); else setError(`Couldn't copy. Share this: ${text} ${link}`);
  };

  const me = room.players.find(p => p.user.id === user.id);
  const isFull = room.players.length === room.capacity;
  const meta = GAME_META[room.gameId] || {};

  return (
    <div>
      <button className="btn-ghost" style={{ marginBottom: 16 }} onClick={leave}>← Leave game</button>
      <div className="glass-card" style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginBottom: 4 }}>{meta.icon} {gameName(room.gameId)}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-low)', marginBottom: 6 }}>Room code</div>
        <div className="gm-code" aria-label={`Room code ${room.inviteCode.split('').join(' ')}`}>{room.inviteCode}</div>
        <div className="gm-row" style={{ marginBottom: 18 }}>
          <button type="button" className="btn-ghost" onClick={copyCode}>{copied === 'code' ? '✓ Copied' : 'Copy code'}</button>
          <button type="button" className="btn-ghost" onClick={shareRoom}>{copied === 'link' ? '✓ Link copied' : 'Share invite'}</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
          {room.players.map(p => (
            <div key={p.user.id} style={{ textAlign: 'center' }}>
              <Avatar user={p.user} size={44} />
              <div style={{ fontSize: 12.5, marginTop: 6 }}>{p.user.displayName}</div>
              {room.status === 'waiting' && <div style={{ fontSize: 11, color: p.ready ? 'var(--teal)' : 'var(--text-low)' }}>{p.ready ? 'Ready' : 'Not ready'}</div>}
            </div>
          ))}
          {!isFull && <div style={{ textAlign: 'center', color: 'var(--text-low)', fontSize: 12.5 }}>Waiting for a<br />second player…</div>}
        </div>

        {error && <div className="error-banner">{error}</div>}

        {room.status === 'waiting' && !isFull && (
          <form onSubmit={sendInvite} style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 14 }}>
            <input value={inviteUsername} onChange={e => setInviteUsername(e.target.value)} placeholder="Invite by username"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '8px 12px', color: 'var(--text-hi)', fontSize: 13, outline: 'none' }} />
            <button className="btn-ghost" type="submit">Invite</button>
          </form>
        )}
        {inviteStatus && <div className="request-banner" style={{ marginBottom: 14 }}>{inviteStatus}</div>}

        {room.status === 'waiting' && isFull && (
          <button className="btn-primary" style={{ width: 'auto', padding: '10px 24px' }} disabled={me?.ready} onClick={ready}>
            {me?.ready ? 'Waiting for opponent…' : "I'm ready"}
          </button>
        )}
        {room.status === 'waiting' && !isFull && (
          <div style={{ fontSize: 13, color: 'var(--text-mid)' }}>Send the code <b>{room.inviteCode}</b> to your friend. They open <b>Games</b>, type it under “Have a room code?”, or tap your invite link.</div>
        )}
        {(room.status === 'active' || room.status === 'finished') && (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 12 }}>
              {room.state.winner === 'draw' && "It's a draw!"}
              {room.state.winner && room.state.winner !== 'draw' && (room.state.winner === user.id ? 'You won! 🎉' : 'You lost this round.')}
              {!room.state.winner && (room.state.turn === user.id ? 'Your turn' : 'Waiting for opponent…')}
            </div>
            {room.gameId === 'tic-tac-toe' && <TicTacToeBoard room={room} myId={user.id} onMove={move} />}
            {room.gameId === 'connect-four' && <ConnectFourBoard room={room} myId={user.id} onMove={move} />}
            {room.gameId === 'checkers' && <CheckersBoard room={room} myId={user.id} onMove={move} />}
            {room.gameId === 'chess' && <ChessBoard room={room} myId={user.id} onMove={move} />}
            {room.gameId === 'reversi' && <ReversiBoard room={room} myId={user.id} onMove={move} />}
            {room.gameId === 'dots-and-boxes' && <DotsBoxesBoard room={room} myId={user.id} onMove={move} />}
            {room.gameId === 'rock-paper-scissors' && <RpsBoard room={room} myId={user.id} onMove={move} />}
            {room.gameId === 'pig-dice' && <PigDiceBoard room={room} myId={user.id} onMove={move} />}
            {room.gameId === 'memory-match' && <MemoryBoard room={room} myId={user.id} onMove={move} />}
            {room.gameId === 'trivia-duel' && <TriviaBoard room={room} myId={user.id} onMove={move} />}
            {room.gameId === 'card-war' && <WarBoard room={room} myId={user.id} onMove={move} />}
            {room.gameId === 'higher-lower' && <HiLoBoard room={room} myId={user.id} onMove={move} />}
            {room.gameId === 'simon' && <SimonBoard room={room} myId={user.id} onMove={move} />}
            {room.gameId === 'truth-dare' && <TodBoard room={room} myId={user.id} onMove={move} />}
            {room.gameId === 'crazy-eights' && <EightsBoard room={room} myId={user.id} onMove={move} />}
            <Suspense fallback={<div className="empty-state"><span className="loading-dot" /></div>}>
              {room.gameId === 'pong' && <PongLive room={room} myId={user.id} frame={frame} send={sendInput} />}
              {room.gameId === 'drag-race' && <DragLive room={room} myId={user.id} frame={frame} send={sendInput} />}
              {room.gameId === 'launch-control' && <LaunchLive room={room} myId={user.id} frame={frame} send={sendInput} />}
              {room.gameId === 'circuit-race' && <CircuitLive room={room} myId={user.id} frame={frame} send={sendInput} />}
              {room.gameId.startsWith('duel-') && <DuelBoard key={room.state.seed} room={room} myId={user.id} onMove={move} />}
            </Suspense>
          </>
        )}
        {room.status === 'finished' && (
          <button className="btn-ghost" style={{ marginTop: 16 }} onClick={leave}>Back to Game Store</button>
        )}
      </div>
    </div>
  );
}

function TournamentView({ tournament: initial, onBack, myId }) {
  const [t, setT] = useState(initial);
  const [error, setError] = useState('');

  const refresh = async () => { try { setT((await api.getTournament(t.id)).tournament); } catch { /* try again on the next tick */ } };
  useEffect(() => { const id = setInterval(refresh, 3000); return () => clearInterval(id); }, [t.id]);

  const start = async () => {
    setError('');
    try { setT((await api.startTournament(t.id)).tournament); } catch (err) { setError(err.message); }
  };
  const join = async () => {
    setError('');
    try { setT((await api.joinTournament(t.id)).tournament); } catch (err) { setError(err.message); }
  };

  const iJoined = t.participants.some(p => p.user.id === myId);

  return (
    <div>
      <button className="btn-ghost" style={{ marginBottom: 16 }} onClick={onBack}>← Back to Game Store</button>
      <div className="glass-card" style={{ padding: 20 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, marginBottom: 4 }}>{t.name}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-low)', marginBottom: 16 }}>{t.game.name} · {t.status}</div>
        {error && <div className="error-banner">{error}</div>}

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-low)', marginBottom: 6, textTransform: 'uppercase' }}>Standings</div>
          {t.participants.map(p => (
            <div key={p.user.id} className="convo-item" style={{ padding: 8 }}>
              <Avatar user={p.user} size={30} />
              <div className="last">{p.user.displayName} — {p.wins}W {p.losses}L</div>
            </div>
          ))}
        </div>

        {t.status === 'open' && !iJoined && <button className="btn-primary" style={{ width: 'auto', padding: '9px 18px' }} onClick={join}>Join tournament</button>}
        {t.status === 'open' && iJoined && t.hostId === myId && (
          <button className="btn-primary" style={{ width: 'auto', padding: '9px 18px' }} onClick={start} disabled={t.participants.length < 2}>
            {t.participants.length < 2 ? 'Need at least 2 players' : `Start (${t.participants.length} joined)`}
          </button>
        )}
        {t.status === 'open' && iJoined && t.hostId !== myId && <div style={{ fontSize: 13, color: 'var(--text-mid)' }}>Waiting for the host to start…</div>}

        {t.status !== 'open' && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-low)', marginBottom: 6, textTransform: 'uppercase' }}>Matches</div>
            {t.matches.map(m => (
              <div key={m.id} className="convo-item" style={{ padding: 8 }}>
                <div className="last">
                  Room {m.inviteCode} · {m.roomStatus}
                  {m.winnerId && ` · winner: ${t.participants.find(p => p.user.id === m.winnerId)?.user.displayName || '—'}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Games({ initialTab, onConsumeInitialTab, initialJoinCode, onConsumeJoinCode }) {
  const { user } = useAuth();
  const [tab, setTab] = useState(initialTab && TABS.includes(initialTab) ? initialTab : 'discover');
  const [games, setGames] = useState(null);
  const [myRooms, setMyRooms] = useState(null);
  const [friendsRooms, setFriendsRooms] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [room, setRoom] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [openTournaments, setOpenTournaments] = useState(null);
  const [myTournaments, setMyTournaments] = useState(null);
  const [local, setLocal] = useState(null); // { game, players } while a built-in game is open
  const [loadError, setLoadError] = useState('');

  // Deep-link support: Codex's `navigate` action can jump straight to a tab, e.g.
  // "open my tournaments" or "show my games".
  useEffect(() => {
    if (!initialTab) return;
    if (TABS.includes(initialTab)) setTab(initialTab);
    onConsumeInitialTab?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  // Each list loads on its own, so one failing request can't leave the whole store blank.
  const loadAll = async () => {
    setLoadError('');
    const run = (call, apply) => call().then(apply).catch((err) => { setLoadError(err.message || 'Could not load everything.'); apply(null); });
    await Promise.all([
      run(api.games, (r) => setGames(r?.games || [])),
      run(api.myGameRooms, (r) => setMyRooms(r?.rooms || [])),
      run(api.gamesFriendsRooms, (r) => setFriendsRooms(r?.rooms || [])),
      run(api.openTournaments, (r) => setOpenTournaments(r?.tournaments || [])),
      run(api.myTournaments, (r) => setMyTournaments(r?.tournaments || [])),
    ]);
  };
  useEffect(() => { loadAll(); }, []);

  const create = async (gameId) => {
    setError('');
    try {
      const res = await api.createGameRoom(gameId);
      setRoom(res.room);
    } catch (err) { setError(err.message); }
  };

  const createTournamentFor = async (gameId, gameName) => {
    setError('');
    try {
      const res = await api.createTournament(gameId, `${gameName} Tournament`);
      setTournament(res.tournament);
    } catch (err) { setError(err.message); }
  };

  const join = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.joinGameRoom(joinCode.trim());
      setRoom(res.room);
    } catch (err) { setError(err.message); }
  };

  const renderOnline = (g) => {
    const meta = GAME_META[g.id] || {};
    return (
      <div key={g.id} className="glass-card gm-listing">
        <div className="gm-listing-icon" aria-hidden="true">{meta.icon}</div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 15.5 }}>{g.name}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-mid)' }}>{kindLabel(g.id)} · {meta.estTime} · {g.openRooms} open room{g.openRooms === 1 ? '' : 's'}</div>
        </div>
        {g.id !== 'truth-dare' && <button className="btn-ghost" onClick={() => createTournamentFor(g.id, g.name)}>Start tournament</button>}
        <button className="btn-primary" style={{ width: 'auto', padding: '9px 18px' }} onClick={() => create(g.id)}>Play online</button>
      </div>
    );
  };
  // Opened from an invite link (/?join=CODE): join that room as soon as the app is ready.
  useEffect(() => {
    if (!initialJoinCode) return;
    (async () => {
      try { setRoom((await api.joinGameRoom(initialJoinCode)).room); }
      catch (err) { setError(err.message); }
      finally { onConsumeJoinCode?.(); }
    })();
    // eslint-disable-next-line
  }, [initialJoinCode]);

  const renderOnlineGroups = () => ONLINE_ORDER.map((cat) => {
    const list = (games || []).filter((g) => g.category === cat);
    return list.length ? <div key={cat}><div className="gm-subtitle">{cat}</div>{list.map(renderOnline)}</div> : null;
  });
  const playLocal = (game, players) => setLocal({ game, players });
  if (local) return <LocalGameView game={local.game} players={local.players} onExit={() => setLocal(null)} />;
  if (room) return <RoomView room={room} onLeave={() => { setRoom(null); loadAll(); }} />;
  if (tournament) return <TournamentView tournament={tournament} myId={user.id} onBack={() => { setTournament(null); loadAll(); }} />;

  return (
    <div>
      <h2 className="page-title">Game Store</h2>

      <div className="feed-tabs">
        <button className={tab === 'discover' ? 'active' : ''} onClick={() => setTab('discover')}>Discover</button>
        <button className={tab === '2players' ? 'active' : ''} onClick={() => setTab('2players')}>2 Players</button>
        <button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}>Friends</button>
        <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>My Games</button>
        <button className={tab === 'tournaments' ? 'active' : ''} onClick={() => setTab('tournaments')}>Tournaments</button>
      </div>

      {tab === 'discover' && (
        <>
          <form className="glass-card" style={{ padding: 20, marginBottom: 16 }} onSubmit={join}>
            <div style={{ fontSize: 13.5, marginBottom: 10, color: 'var(--text-mid)' }}>Have a room code?</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="e.g. XYZ123"
                style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '9px 12px', color: 'var(--text-hi)', outline: 'none', fontSize: 14, textTransform: 'uppercase' }} />
              <button className="btn-primary" style={{ width: 'auto', padding: '9px 18px' }} type="submit">Join</button>
            </div>
            {error && <div className="error-banner" style={{ marginTop: 10 }}>{error}</div>}
          </form>

          {loadError && <div className="error-banner" style={{ marginBottom: 12 }}>{loadError}</div>}
          <div className="gm-cats">
            {['Online', ...LOCAL_CATEGORIES].map(cat => (
              <button key={cat} type="button" className="gm-chipbtn" onClick={() => document.getElementById(`cat-${cat}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{cat}</button>
            ))}
          </div>

          <div id="cat-Online" className="gm-cat-title">Online · play with friends</div>
          {games === null && <div className="empty-state"><span className="loading-dot" /></div>}
          {games?.length === 0 && <div className="empty-state" style={{ padding: 20 }}>Online games are unavailable right now. The built-in games below still work.</div>}
          {renderOnlineGroups()}

          {LOCAL_CATEGORIES.map(cat => (
            <div key={cat}>
              <div id={`cat-${cat}`} className="gm-cat-title">{cat} <span>· {LOCAL_GAMES.filter(g => g.category === cat).length} games</span></div>
              {LOCAL_GAMES.filter(g => g.category === cat).map(g => <LocalGameCard key={g.id} g={g} onPlay={playLocal} onOnline={create} />)}
            </div>
          ))}
        </>
      )}

      {tab === '2players' && (
        <>
          <div className="gm-cat-title" style={{ marginTop: 0 }}>Online · each on your own device</div>
          {games === null && <div className="empty-state"><span className="loading-dot" /></div>}
          {renderOnlineGroups()}
          <div className="gm-cat-title">Same device · pass the keyboard or phone</div>
          {LOCAL_GAMES.filter(g => g.modes.includes(2)).map(g => <LocalGameCard key={g.id} g={g} onPlay={playLocal} onOnline={create} />)}
        </>
      )}

      {tab === 'friends' && (
        <div>
          {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}
          {friendsRooms === null && <div className="empty-state"><span className="loading-dot" /></div>}
          {friendsRooms?.length === 0 && <div className="empty-state">No open rooms from people you follow right now.</div>}
          {friendsRooms?.map(r => {
            const meta = GAME_META[r.gameId] || {};
            const host = r.players[0]?.user;
            return (
              <div key={r.id} className="glass-card" style={{ padding: 16, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar user={host} size={38} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14 }}>{host?.displayName}'s {meta.icon} {gameName(r.gameId)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-low)' }}>Waiting for a player</div>
                </div>
                <button className="btn-ghost" onClick={async () => { setError(''); try { const res = await api.joinGameRoom(r.inviteCode); setRoom(res.room); } catch (err) { setError(err.message); } }}>Join</button>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'mine' && (
        <div>
          {myRooms === null && <div className="empty-state"><span className="loading-dot" /></div>}
          {myRooms?.length === 0 && <div className="empty-state">No active games. Head to Discover to start one.</div>}
          {myRooms?.map(r => {
            const meta = GAME_META[r.gameId] || {};
            return (
              <div key={r.id} className="glass-card convo-item" style={{ padding: 14, marginBottom: 8 }} onClick={() => setRoom(r)}>
                <div className="last">{meta.icon} {gameName(r.gameId)} · room {r.inviteCode} · {r.status}</div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'tournaments' && (
        <div>
          {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}
          <div style={{ fontSize: 12, color: 'var(--text-low)', marginBottom: 8, textTransform: 'uppercase' }}>My tournaments</div>
          {myTournaments === null && <div className="empty-state"><span className="loading-dot" /></div>}
          {myTournaments?.length === 0 && <div className="empty-state" style={{ padding: 16 }}>None yet — tap "Start tournament" on a game in Discover.</div>}
          {myTournaments?.map(t => (
            <div key={t.id} className="glass-card convo-item" style={{ padding: 14, marginBottom: 8 }} onClick={() => setTournament(t)}>
              <div className="last">{t.name} · {t.game.name} · {t.status} · {t.participants.length} player{t.participants.length === 1 ? '' : 's'}</div>
            </div>
          ))}

          <div style={{ fontSize: 12, color: 'var(--text-low)', margin: '20px 0 8px', textTransform: 'uppercase' }}>Open tournaments from people you follow</div>
          {openTournaments?.length === 0 && <div className="empty-state" style={{ padding: 16 }}>None open right now.</div>}
          {openTournaments?.map(t => (
            <div key={t.id} className="glass-card convo-item" style={{ padding: 14, marginBottom: 8 }} onClick={() => setTournament(t)}>
              <div className="last">{t.name} · {t.game.name} · {t.participants.length} joined</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
