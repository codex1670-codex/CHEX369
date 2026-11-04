## v85 – Responsive pass (phones, tablets, desktop)
- New `frontend/src/responsive.css` (loaded last): nothing scrolls sideways, long words wrap, media/dialogs/sheets always fit the screen, fluid text sizes, reduced-motion support.
- Touch screens: buttons, chips, selects and links are at least 36-40px so they are easy to tap (post actions, game chips, sticky chips, Codex mini-bar, profile stats, login link, emoji picker).
- The floating "Ask Codex" bar is now wide enough to type in on phones; hidden on landscape phones.
- Very small phones (<=360px): tighter padding, smaller menu labels, no edge overflow.
- Desktop: Home, Notifications, Coins and Settings keep a readable width, centered.
- Checked at 320 / 360 / 390 / 768 / 1280 px on Home, Search, Reels, Notifications, Games, Settings, Coins, Stickies, My Life, Messages, Profile and Login: no horizontal overflow, no undersized phone tap targets.

## v84 – Glossy 3D emoji (like the reference)
- New `components/Emoji3D.jsx`: hand-drawn glossy "inflated" 3D emoji (shaded sphere, rim shadow, gloss highlight) – 14 faces (😀 😄 😍 🥰 😂 😋 😎 😉 🤩 🥳 😭 😢 😠 😮) and 9 objects (💖 ⭐ 🔥 🔔 ✨ 💎 🪙 🎈 🏆).
- Any other emoji the user types is shown on a matching glossy 3D pearl bubble, so every emoji looks 3D.
- Used in the falling/floating effect (gentle 3D wobble, sway, soft glow) and in Settings → Emoji effects (palette + chips). New default set: 😍 💖 ⭐ 🥳.

## v83 – Premium solid 3D emoji
- The falling/floating emoji are now small solid 3D objects (stacked, shaded depth layers that slowly turn), with a soft colored glow and smooth sway. Smaller and slower for a more premium feel.

## v82 – 3D emoji effects (Settings → Emoji effects)
- New Settings card: 3D emoji fall from the top and float up the screen when a new notification arrives. Switch it on/off, optionally keep gentle emoji floating in the background, and choose Falling / Floating / Both.
- Emoji are customizable: tap any from the palette, remove chips, or type/paste your own (up to 10). Preview button and Reset included. Saved on this device.
- Respects the phone's "reduce motion" setting.

## v81 – Full-screen games + 3D win animation
- While a game is being played (online room active/finished, and every built-in game) it now fills the whole screen. The room code / Copy code / Share invite block is hidden once the match starts; it only shows in the waiting lobby.
- New 3D win celebration (spinning trophy, extruded "YOU WIN!", tumbling confetti) for online wins and for every built-in game's win screen. Not shown for losses or "CPU wins".

## v80 – Game Store redesign
- Game Store rows now use one layout for every game: logo tile, title, details, **Start tournament** and **Play online**, grouped under Card / Racing / Arcade / Puzzle / Party / Board headers.
- Added 27 game logos in `frontend/public/game-logos/` (the 24 built-in games plus Checkers, Chess, Reversi).
- Removed the duplicate "clone" cards: each game appears once. Offline play (vs CPU / 2 players on one device) is kept as small chips under each row.

# My life: Alarm without a song (v79)

- The alarm song picker and song playback are removed. An alarm is now a notification: a phone / desktop notification when
  CHEX is closed, and a Stop / Snooze alarm card (chime + spoken alert) when CHEX is open.

# My life: Alarm notifications while the app is closed (v78)

- Every enabled alarm now has a server-side alert, so a **phone / desktop notification** goes out at the alarm time even
  when CHEX is closed (same Web Push as sticky reminders; tap it to open CHEX). Repeating alarms re-arm for their next day
  automatically; one-time alarms switch themselves off after they fire. The notification expires after 10 minutes so a
  late alarm never arrives hours afterwards.
- When CHEX is open the song plays as before and no duplicate notification or voice alert is shown.
- The Alarm tab shows whether notifications are on and has an **Enable notifications** button.
- A notification cannot play your chosen song itself (browsers don't allow it); it uses the device's notification sound
  and vibration. If you tap it and CHEX opens within 2 minutes of the alarm time, the song then starts playing.

# My life: Alarm (v77)

- New **Alarm** tab in My life. Set a time, a label and repeat days (once / weekdays / every day / custom), then pick
  **any song** from the same Tamil + English search used in Notes (trending list, song / lyrics / artist / movie search,
  ▶ preview before choosing). At the alarm time the song plays on a loop with a full-screen **Stop** / **Snooze 5 min**
  card, anywhere in the app. No song chosen (or the song cannot play) → chime + spoken alert.
- One-time alarms switch themselves off after ringing; each alarm has an On/Off switch.
- Backend: `life_items.kind` accepts `alarm` (30 per person, https-only song links). Existing databases are migrated
  automatically on boot (table rebuilt once, rows kept).
- The song is a ~30 s catalog preview, looped. The app must be open (or installed) for the alarm to ring.

# My life: alerts on every tab + Home button removed (v76)

- **Every tab now notifies, with voice.** Anything with a time becomes a linked reminder on the same scheduler as sticky notes, so it is read aloud, shown as a ringing card (Done / Snooze / replay / Dismiss) and sent as a phone notification, even with the app closed:
  - 📅 Planner task with a time → at that time.
  - 🗓️ Class → **10 minutes before it starts**, repeating every week.
  - 📚 Assignment with a due date → **8:00 am on the due date** (not if already done).
  - 🔥 Habit with a new "remind me every day at" time → daily; if already ticked today, it waits until tomorrow.
  - 🎯 Focus timer → alert when the session ends (cancelled when you stop; the open app speaks it itself).
  - ⏰ Smart reminders / 📌 Sticky notes → unchanged.
  Editing, ticking done or deleting an item moves or removes its alert. Alert cards show the tab name (Planner, Class, Assignment, Habit, Focus timer); notifications open My life.
- **Home:** the "🌟 My life" button is gone from the Home page. My life is still in the ＋ menu, Settings and via Codex ("open my life").
- Server: new `backend/src/lifeAlerts.js`; `POST/DELETE /api/life/focus-alert`; habits gain `remindTime`; linked alerts are hidden from the Sticky notes board and don't count towards its 100-note limit. Tests extended in `life.test.mjs` and `myLife.test.jsx`.

# My life hub (v75)

- **🌟 My life** (Home → "🌟 My life", the ＋ menu, Settings, or tell Codex "open my life" / "planner" / "habit tracker"): one page with seven sections.
  - **⏰ Smart reminders** – reminders with a time (Once / Every day / Every week), spoken aloud with a phone notification, as before; Codex still makes them from "remind me to … at 5pm".
  - **📌 Sticky notes** – the existing coloured note board.
  - **📅 Daily planner** – tasks per day with optional time and priority, tick-off, progress bar, "Move to today" for missed tasks.
  - **🗓️ Study timetable** – weekly grid (Monday first, today highlighted) with subject, start/end, room and colour.
  - **📚 Assignments** – To do / In progress / Done columns, due dates with Overdue / Due today / Due soon labels.
  - **🎯 Focus timer** – 25 / 45 / 5 / 15 min presets or custom, ring progress, chime + voice at the end; keeps counting if you leave the page or reload; finished focus sessions add up to "today".
  - **🔥 Habit tracker** – tick the last 7 days, current and best streak.
- **Server:** new table `life_items` (kind + JSON), API `GET/POST /api/life`, `PATCH/DELETE /api/life/:id`; all input validated, private per user, per-kind limits. Codex navigate screen `mylife`.
- New: `backend/src/routes/life.js`, `frontend/src/pages/MyLife.jsx`, `lifeUtils.js`, `life.css`; tests `backend/test/life.test.mjs`, `frontend/test/myLife.test.jsx`. `Stickies` gained `embedded` and `mode` props; the old Sticky notes page still works.

# Sticky notes with voice reminders + Codex (v74)

- **📌 Sticky notes** page (Home → "📌 Sticky notes", Settings, the ＋ menu, or ask Codex): coloured notes with an optional reminder time, **Once / Every day / Every week**, quick chips (In 10 min · In 1 hour · Tonight 8 pm · Tomorrow 9 am), edit, done/undo, delete and a Done list.
- **Voice:** when a reminder comes due CHEX plays a chime and **reads it out loud** ("Reminder. Call mom"), shows a ringing note card with **Done · Snooze 10 min · 🔊 replay · Dismiss**, and repeats it every 45 s (up to 4 times) until you act. Own **🔊 Voice reminders on/off** switch and a **Test voice** button, independent of the "AI alerts" switch. Tamil/Hindi text picks a matching voice when the phone has one.
- **Phone notification:** a due reminder also goes out as a Web Push (stays on screen until tapped, opens the notes page); skipped while the app is open and speaking. Reminders that rang while the app was closed are read out the moment you open it.
- **Codex makes them for you** — "remind me to call mom at 5pm", "remind me tomorrow 9am to submit the report", "sticky note: buy milk in 30 minutes", "remind me every day at 8am to take medicine", "remind me every monday 7am to water the plants", "remind me to pay rent on 5 nov at 10am". Understands in 10 minutes / an hour / half an hour, at 5pm / 17:30 / "at 5", noon, midnight, tonight, morning/evening, weekdays, dates, daily/weekly. No time = a plain sticky note. "open my sticky notes" opens the board. Times are read in the **device's time zone** (sent with every Codex command). Works with or without an AI key.
- **Server:** a scheduler checks every 10 s, rings each note once, advances repeating notes, honours snooze without losing the repeat schedule, and catches up after a restart. API: `GET/POST /api/stickies`, `PATCH/DELETE /api/stickies/:id`, `POST /api/stickies/:id/snooze|dismiss`, `GET /api/stickies/ringing`; socket event `sticky:due`; Codex tool `create_reminder`. Max 100 active notes, 200 characters each; notes are private to their owner. New table `sticky_notes`.
- New: `backend/src/reminders.js`, `routes/stickies.js`, `frontend/src/pages/Stickies.jsx`, `components/StickyAlerts.jsx`, `stickyVoice.js`, `stickies.css`; tests `backend/test/reminders.test.mjs`, `frontend/test/stickies.test.jsx`.

# Premium animated profile frames (v73)

- **12 animated profile frames** — Golden Halo, Aurora Spin, Neon Pulse, Royal Crown, Emerald Flame, Rainbow Orbit, Diamond Sparkle, Inferno, Ocean Wave, Cherry Blossom, Cyber Glitch, Galaxy Orbit. Pure CSS (transform/opacity only), so they stay light on phones; they stop when **Animations off** or the phone's reduce-motion is on.
- **Prices:** frames are a one-time **2,000 CHEX coins** unlock (all 12); premium themes stay a one-time **1,000 CHEX coins** unlock (all 9). Both are charged on the server, atomically, and can't be bought twice.
- **Pick a frame:** Settings → Appearance → 🖼️ Premium profile frames (locked cards open the CHEX Coins store). "Remove my frame" clears it.
- **Shown everywhere your avatar appears** — posts, comments, stories, messages, search, notifications, game rooms — and around the big picture on your profile page, for every viewer.
- API: `POST /api/coins/frame` `{ frame: id | null }`; `GET /api/coins/me` now includes `frame`; new store item `premium-frames`; users gain `profile_frame` and public user objects carry `frame`. Frame ids live in `PROFILE_FRAMES` (`backend/src/coins.js`) and `src/profileFrames.js`; artwork in `src/frames.css`.
- New test in `backend/test/coins.test.mjs`.

# 30-day posting streak (v72)

- **Settings → 🔥 30-day posting streak** with a **Start** button. Pressing it makes today **Day 1**. Share a post or a reel every day for 30 days in a row → **100 CHEX coins** (paid the moment day 30 is done; you can run it again afterwards).
- **One missed day ends it** and the card shows "Start again" — it restarts from Day 1. A post/reel you already shared earlier on the start day counts for Day 1.
- Days follow the time zone of the device when Start was pressed. Repeated or copied posts/reels, and deleted ones, don't count.
- Reels now get the same repeat/copy check as posts (same video again, or a video someone else posted first); a post and a reel with the same video also match.
- The card shows 30 dots (done / today / ahead), today's status and best run; the CHEX Coins store mentions it too. A toast appears when the streak is completed.
- API: `POST /api/coins/streak/start`; `GET /api/coins/me` now includes `streak`. New table `coin_streaks`; reels gain `media_hash`, `coin_eligible`, `coin_skip_reason`. Rules in `COIN_RULES` (`streakDays`, `streakReward`).

# Game-win coins + repeated/copied post rules (v71)

- **Game wins pay 1 CHEX coin** (every game that ends with a real winner, including tournament matches). Once per game, up to **20 a day**; draws, solo rooms and walk-over wins (opponent left) don't pay. The winner sees a "🪙 +1 CHEX coin" toast instantly.
- **Repeated / copied posts don't count toward the 30-public-posts goal.** The post is still published; the poster is told why. Rules: the same picture/video again (or, for text posts, the same words again) = *repeat*; the same picture/video, or a long identical text (25+ letters), that someone else posted first = *copy*. Case, spacing, emoji and links are ignored for text. Only exact matches are caught, and only against content already on CHEX — real copyright checking against the outside world isn't possible here.
- Existing posts are fingerprinted in the background on first start, so older posts count as originals.
- Tunable in `backend/src/coins.js` → `COIN_RULES` (`gameWinReward`, `gameWinDailyCap`, `copiedCaptionMinLength`, monthly goal/reward).
- New: `backend/src/contentHash.js`; posts gain `caption_hash`, `media_hash`, `coin_eligible`, `coin_skip_reason`; new tests in `backend/test/coins.test.mjs`.

# CHEX Coins store (v70.1)

- **Fix:** "CHEX hit an unexpected problem" screen after login. The coin-unlock check hook sat below App's early splash/login returns, so React saw a different number of hooks once you were signed in. Moved above them; `test/appHooksOrder.test.jsx` now guards against it.

- **CHEX Coins store** (Settings → Appearance → "Open CHEX Coins store"): balance, progress to this month's reward, the store, and recent activity.
- **Premium themes & animations are locked** until unlocked once for **1,000 CHEX coins** (all 9 themes). Locked cards show a 🔒 and open the store. The unlock is charged on the server (atomic, can't be bought twice, can't go below zero) and is tied to the account.
- **Earning**: share **30 public posts in a calendar month (UTC)** → **100 CHEX coins**, once per month. Followers-only posts and deleted posts don't count. A "🪙 You earned 100 CHEX coins" note shows after the post that reaches 30. Tunable in `backend/src/coins.js` (`COIN_RULES`, `STORE_ITEMS`).
- **Removed** from Appearance: Colour combinations, Make your own (colour pickers, gradient direction), the contrast checker and "Reset to … default". Light/Dark, premium themes, Animations on/off and 3D/Flat stay.
- Logging in on a browser that still has a premium theme saved from an account that hasn't unlocked it drops back to plain Light/Dark.
- API: `GET /api/coins/me`, `POST /api/coins/unlock`; new tables `coin_ledger`, `coin_unlocks`; test `backend/test/coins.test.mjs`.

# Premium animated themes (v69)

- **Amber Noir** and **Teal Slate** themes, styled after the supplied references: warm black-brown glow with frosted cards and a floating rounded dock; soft slate raised surfaces with teal→blue gradient bubbles, pill search/input and rounded send button. Styling only: no buttons, text or components added or removed.

- **Settings → Appearance → ✨ Premium themes**: 7 one-tap themes — Aurora, Obsidian Gold, Neon Noir, Emerald Velvet (dark) and Sunset Glass, Rose Quartz, Ocean Pearl (light). Each card shows a live animated preview.
- **Motion**: drifting colour-orb background with light sheen and film grain, Instagram-style **rotating gradient story rings**, flowing-gradient buttons and active tabs, glass cards with gradient hairlines and hover lift, animated gradient wordmark/titles, springy mobile nav, glowing heart-like pop, pulsing online/unread dots, staggered page entrance and scroll-reveal for posts.
- **Animations on/off** switch in Settings; also honours the phone's "reduce motion". Motion uses transforms/opacity only.
- Light / Dark / custom colours are unchanged; tapping Dark, Light or a colour combination leaves the premium theme.
- New: `src/premiumThemes.js`, `src/premium.css`; changed: `AppBackground.jsx`, `theme.js`, `main.jsx`, `pages/Settings.jsx`.

# Compact home composer and Game Store join (v66)

- Home: the post box is collapsed into a **＋ Post** button; tap it to open the composer (a Close button collapses it again, and it closes after posting).
- Game Store → Discover: the "Have a room code?" box is now a **🔑 Join** button at the start of the category row; tap it to show the room-code field.

# Unread badges in Messages (v65)

- Each chat in the Messages list now shows a count badge for messages you haven't opened yet (99+ cap; grey when the chat is muted). The chat's name and preview turn bold while it has unread messages.
- Backend: `GET /messages/conversations` returns `unreadCount` per chat (other people's visible messages newer than your last read). New `POST /messages/conversations/:id/read` marks a chat read.
- The badge clears as soon as you open the chat, and stays at zero while a new message arrives in the chat you have open.
- Test: `backend/test/unreadBadges.test.mjs`.

# Unreleased — Codex questions, search shortcuts, white & gold default

- **Default theme is white & gold** (light). Dark (navy & gold) is unchanged and still saved if chosen. New "White gold" colour preset.
- **Codex follows the theme**: its mini box, reply card and panel use theme colours instead of a fixed dark box.
- **`search <userid>`** opens that profile (exact username or your nickname); other text opens the Search screen. Previously the word "search" matched the Google app alias and opened Google.
- **`search reel`** opens Reels; **`search reel <words>`** plays the best matching reel (blocked/private users excluded). Search page has All / People / Reels chips.
- **Questions go to Google in any language** (`what is…`, `python enna`, `kya hai…`, `என்ன…`, `qué es…`, `open <unknown>`): new `ask_google` action, opened in a new tab (falls back to the same tab if blocked). Small talk ("how are you", "what's up") is answered, not searched.
- Test change: "what time is it" now opens Google instead of being ignored.

# Changes in v57

## Added
- **Delete a post.** Your own posts now have a ⋯ menu (Edit · Save · Share · Delete). Delete asks first, then removes the
  post for everyone — feed, profile, saved lists, shared cards — and deletes its photo/video file. Others see Report instead.
- **Long-press a chat in Messages** (right-click on desktop, ⋯ on hover): **Delete chat · Mute · Block · Restrict**.
  - *Delete chat* clears it for you only; the other person keeps theirs and it returns if either of you writes again.
  - *Mute* silences alerts for that chat only (messages still arrive). *Restrict* silences that person's chat alerts.
  - *Block* now also closes the existing chat for both people (before, a blocked person could keep messaging an old chat).
    The chat shows "You blocked …" with an Unblock button.
- **Message menu.** Long-press (or right-click) any message: react, Copy, Pin, Edit (yours), **Delete for me**, **Unsend** (yours).
  Unsend and edits now also update live for the other person.
- **Group chats.** "New group" in Messages (pick 2+ people, optional name). Group rows show stacked avatars; messages show who
  sent them. Group info: rename, add people, remove people (admins), mute, leave. If the last admin leaves, the next member is
  promoted. Groups hold up to 50 people. Delete chat in a group means leave.

## Changed — phone layout
- Posts are edge-to-edge like Instagram with one ⋯ button; Save moved next to like/comment/share.
- Buttons no longer break into one letter per line; the composer, tabs and rows wrap cleanly; no sideways scrolling on any page
  from 320px to 430px wide. Buttons are flat and borders thin on phones. Profile header is compact.
- Chat opens full screen; the floating Ask bar is hidden inside a chat and no longer covers the end of long pages.

## Fixed
- After a long-press, the next normal tap on the same item was swallowed.

## Database
- Upgrades itself on first start (adds `muted` / `cleared_at` to chat members and a `message_hidden` table). Nothing is lost.

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

## Royal Gold look (all pages + games)
- New `frontend/src/royal.css` (loaded last): navy backgrounds, royal-blue banners, glossy gold frames/buttons, gold game-icon tiles.
- Violet accents recoloured to royal blue across styles.css, mobile.css and every game file; navy default dark colours + "Royal gold" preset in colors.js.
- Devices with a saved custom colour scheme keep it: Settings → Appearance → "Royal gold" (or reset) to adopt the new navy.

## App catalog — "open <app>" opens the phone app (v63)
- `backend/src/appCatalog.js`: 130+ apps (social, streaming, Google, shopping, UPI, travel, AI, games) seeded on every boot with Android package + iOS scheme + website. Previously the catalog table was never filled, so "open <app>" had nothing to resolve.
- `frontend/src/appLauncher.js`: Android opens the installed app by package (Chrome intent) and lands on a Google search if it isn't installed; iPhone tries the URL scheme then falls back to Google; computers open the website (or Google).
- Apps not in the list also go to Google. "open youtube and search X" opens the app on that search where the app supports it.
