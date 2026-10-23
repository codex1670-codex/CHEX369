# Changes in v40

## Added
- **Notifications auto-delete beyond 100.** Each person keeps their newest 100 notifications; older ones are removed
  automatically whenever a new one arrives (database trigger), and existing accounts over 100 are trimmed on startup.
  The Notifications page now shows up to 100 (was 50). New backend test (90 total).

# Changes in v39

## Changed
- The notification chime is now **one-time** (no more repeating every 4 seconds).

## Added
- **Live spoken summary.** When the app opens it chimes once and says who is waiting, e.g.
  "Message from user-1, user-2 and user-3". New arrivals while the app is open get one chime + one spoken line.
  Mute (🔕) still silences the chime and the voice. (Browsers only allow sound after the first tap, so a summary
  that arrives before that is held and played on the first tap.)
- **Phone home-screen notifications (Web Push).** A small "Allow notifications" prompt asks for permission; once
  allowed, new messages / notifications show on the phone's home screen / notification shade even when CHEX is closed.
  Tapping one opens Messages or Notifications. Skipped while the app is open (the app chimes + speaks itself).
  Backend: `web-push`, `push_subscriptions` table, `/api/push/*`. VAPID keys are derived from NEXA_ACCESS_SECRET
  (or set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). iPhone: add CHEX to the Home Screen first (iOS 16.4+).

# Changes in v24

## Fixed
- **Game catalog was empty on every fresh deploy** (only `npm run seed` inserted it, production never runs it) —
  every "Play" button said "That game is not available". It is now seeded automatically on boot.
- Joining a room after another player left crashed with a 500 (UNIQUE room/slot clash); leaving a waiting
  room now frees the seat, hands over host, and deletes empty rooms. Re-joining a room you left now works.
- Checkers: a player with no legal moves now loses (previously the game could hang).
- Server-side guard when a move arrives for a room whose engine is missing; abandoned lobbies purged after 12h.
- Security: `npm audit fix` resolved the critical `proxy-addr` advisory (affects `trust proxy` / rate limiting).
- Frontend: React error boundary (one crash no longer white-screens the app), Game Store loads each list
  independently, unhandled promise rejections fixed, PWA shortcuts (`/?open=messages`) now work.

## Added
- 24 browser games (Card, Racing, Arcade, Puzzle, Party, Two Player — 4 each), 1P/vs-CPU and 2-player modes.
- Online Reversi (server engine with automatic pass handling).
- Tests: 7 new backend tests (61 total) and 50 frontend tests (logic + smoke test of every game/mode).
