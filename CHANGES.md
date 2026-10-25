# Changes in v56

## Changed
- **Login / sign-up:** field hints are now plain words (Username, Password, Email, Display name) instead of sample values,
  and the "Demo accounts" line is gone.

## Fixed — voice & video calls now really work between two phones
- The call screen was never connected to the live connection (so nothing rang), the caller never learned its call id,
  network candidates that arrived early were thrown away, and the video elements did not exist when the streams arrived.
  All rewritten: the call screen now ringtones, asks for microphone/camera first, connects phone-to-phone (same wifi works
  directly), shows a full-screen video call with a small self-view, mute / camera-off / end buttons and a timer.
- Cancelling or missing a call now closes the other person's ringing screen; calls from your own notes chat are refused.
- `GET /api/calls/ice` serves the connection helpers. For calls across different networks / mobile data, set `TURN_URL`
  (and `TURN_USERNAME`, `TURN_CREDENTIAL`) on the server.
- Note: browsers only allow camera/microphone on **https** (or localhost) — the deployed https site is fine; plain
  `http://192.168.x.x` addresses are blocked by the phone's browser.

# Changes in v55

## Added
- **Profile posts as a grid.** Posts (and saved posts) show as a 3-column grid of square thumbnails — photo, video (▶ badge)
  or the caption for text posts. Tap a tile to open the full post (like, comment, react, share) in a popup.
- **Note → Open conversation** now opens the chat with the person who posted the note (their existing conversation if you
  already have one, otherwise a new chat). The same applies to people you pick from the Messages search.
- **Self chat.** A pinned "You" row at the top of Messages opens a private chat with yourself (notes, links, shared reels).
  Backend: `POST /api/messages/self`; messaging your own username now opens it instead of failing.
- **Share posts and reels.** New ↗ Share button on every post and reel. It lists the people you follow and who follow you
  (plus yourself), has search (also finds anyone else), supports picking several people and an optional message, and sends a
  tappable card into each chat. Tapping the card opens the post (popup) or the reel. Backend: `POST /api/messages/share`,
  `messages.shared_kind/shared_id` columns. People you haven't chatted with get it as a message request (text only).
- **Reels: press and hold** anywhere on a reel (or right-click on desktop) opens its comments.
- Tests: 4 backend + 3 frontend.

# Changes in v50

## Added: safety lists, story highlights and history in Settings
- **Settings → Blocked, muted & restricted.** Three tabs listing everyone you've limited, with a one-tap Unblock / Unmute /
  Unrestrict. Muted and restricted people also have a View button. Lists are always your own — nobody can see who limited them.
  API: `GET /api/users/me/blocked | muted | restricted`.
- **Settings → Story highlights.** Create, rename, add/remove stories, pick a cover, or delete highlights. Highlights stay on your
  profile after the 24 hours are up; deleting a highlight never deletes the stories. Highlights show on every profile and respect
  each story's audience (everyone / followers / close friends), blocks and private accounts.
  API: `/api/highlights` (`GET /archive`, `GET /user/:username`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`).
- **Settings → History** (private to you): story archive (expired stories are kept for you), reels watched / liked / saved / posted, and call log.
- **Profile menu (•••) now remembers.** Mute / Restrict show the saved state (Unmute / Unrestrict) when you reopen a profile, with a
  Muted / Restricted tag. Block asks first, then shows an Undo screen with a link to Settings. Profiles now return `isMuted`,
  `isRestricted`, `isCloseFriend` (only ever about *your own* choices).
- **Muting someone now also hides their stories** from your story tray (it already hid their posts and notes).
- New DB tables `story_highlights`, `story_highlight_items` (created automatically on boot). Files: `routes/highlights.js`,
  `components/SafetyLists.jsx`, `HighlightsRow.jsx`, `HighlightEditor.jsx`, `HistoryPanel.jsx`.
- Tests: `backend/test/safetyHighlights.test.mjs`, `frontend/test/safety.test.jsx`.

# Changes in v44

## Added
- **Live camera in Messages.** The ＋ → Camera button now opens a full-screen live camera inside CHEX instead of the phone's
  camera app. Choose Photo or Video, tap the round button (video: tap to start, tap again to stop, up to 10:00), flip front/back
  camera, then Retake or Use. The result lands in the message box like any attachment, with an optional caption, and sends as usual.
  If the browser can't open a live camera (no https, camera blocked) it offers the phone camera app instead.
  Files: `components/CameraCapture.jsx`, `pages/Messages.jsx`.
- Server note: video recordings arrive as `video/webm;codecs=...`; the upload check already ignores the codec part (v42).

# Changes in v43

## Added / fixed: screen fit on phone and desktop
- **Phone menu is now a horizontal bar at the bottom** (Home, Search, Reels, Messages, Alerts, Games, Profile, with unread badges).
  The old side rail and floating ＋ menu are hidden on phones, every page gets full width, and content has room above the
  bar so no page or button is covered. It respects the phone's bottom safe area.
- **Messages on phone:** the list shows alone; tapping a person opens the chat **full screen** (list, notes and menu bar hidden)
  with a ← button back to the list. The keyboard now resizes the page so the message box is never hidden behind it.
- **Desktop:** the menu rail sits at the left edge and pages use the whole screen (content up to 1180px, Messages full width)
  instead of a narrow centered column. Message bubbles are wider and wrap long words.
- Phones: inputs use 16px text (no zoom-on-focus), bigger tap targets, wrapping profile header, chess/board grid shrinks to fit narrow screens.
- Settings has a **Log out** button (the rail's Log out is not visible on phones).
- Pages use dynamic viewport height so mobile browser bars don't cut the page.

# Changes in v42

## Added
- **Voice notes in Messages.** When the message box is empty the send button becomes a 🎤. Tap it to record
  (timer + delete + send, auto-sends at 5:00, cancelled if you leave the chat). Voice notes show a play/pause
  bubble with progress and length, only one plays at a time, and chat previews say "🎤 Voice note".
  Files: `components/VoiceRecorder.jsx`, `components/VoiceNotePlayer.jsx`, `pages/Messages.jsx`.
- Server: `/messages/send-media` now also accepts audio (webm/ogg/m4a/mp3/wav, max 25 MB, header-checked),
  stores its length in a new `messages.media_seconds` column (added automatically). Posts, stories and reels still refuse audio.
- Like photos and videos, a first voice note to someone who hasn't accepted you yet is blocked until they accept.

# Changes in v41

## Added
- **Phone permissions.** A first-run sheet (after the splash) asks for notifications, microphone, camera, location,
  clipboard and persistent storage, with an "Allow all" button. The same list lives in **Settings -> Phone permissions**
  with live status (Allowed / Blocked / Not asked) and help for re-enabling blocked ones. Replaces the old
  notifications-only prompt. Files: `src/permissions.js`, `components/PermissionsPanel.jsx`, `components/PermissionsPrompt.jsx`.
- Gallery needs no permission on the web: the upload buttons open the phone gallery/camera directly.
- Server `Permissions-Policy` now allows geolocation and clipboard for the app itself (was blocking location).
- Note: a web app cannot open the phone dialer permission or contact list; CHEX calls run in-app on mic + camera.

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
