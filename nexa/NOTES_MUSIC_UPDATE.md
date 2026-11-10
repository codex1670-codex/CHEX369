# CHEX369 Notes Music Update (v57)

## What changed
- Replaced the hardcoded demo-track catalog with live song search through Apple's public iTunes Search API (India catalog).
- Search is performed by the CHEX369 backend, not directly by the browser.
- Shows track title, artist, album artwork, and provider preview when available.
- Added preview play/pause and song attach actions.
- Existing note create/edit/remove flow remains in place; selected track metadata is saved with the note.
- Music never plays by itself on page load. Tapping someone's note plays their song preview (the tap is the user gesture browsers require); closing the note, opening the song picker or closing the composer stops it.
- Legacy notes that used demo instrumental URLs are prevented from playing those demo URLs as if they were the actual song.

## Important limitations
- Not every catalog result has a preview URL. Such results can be attached to a note but cannot be previewed in CHEX369.
- These are short catalog previews, not full-song streaming.
- Follow Apple's current API terms and any applicable artwork/preview attribution and usage rules before public release. API availability, results and preview availability are controlled by Apple.
- Song search needs backend network access to `itunes.apple.com`.

## Deploy to Render
1. Back up your current GitHub repository / working folder.
2. Unzip this project and copy the updated `nexa` contents into your project folder (or use the provided full project archive as a separate working copy).
3. From the `nexa` directory run:
   - `npm --prefix backend install`
   - `npm --prefix frontend install`
   - `npm --prefix frontend run build`
   - `node --check backend/src/songs.js`
   - `node --check backend/src/routes/notes.js`
4. Test locally with the normal backend/frontend run scripts. Sign in, open Notes, type at least two characters into the music search, switch Tamil/English, play/pause a preview if available, attach a song, save a note, then edit/remove the song.
5. Commit and push the changes to the branch connected to Render (previously `main`):
   - `git add .`
   - `git commit -m "Add live song search and previews to Notes"`
   - `git push origin main`
6. In Render, open the existing CHEX369 service and choose **Manual Deploy → Deploy latest commit**. Watch the build/deploy logs.
7. After deployment, test the same flow on desktop and an Android phone. If search fails, check backend logs and confirm outbound HTTPS access to `itunes.apple.com`.

## Files changed
- `backend/src/songs.js`
- `backend/src/routes/notes.js`
- `frontend/src/api.js`
- `frontend/src/components/NotesBar.jsx`
- `NOTES_MUSIC_UPDATE.md`

## Verification status
Backend JavaScript syntax checks passed with Node.js v22.16.0. A full Vite production build could not be completed in this environment because frontend dependencies were not available/installation timed out; run the build locally before deploying.

## Fixes after review (v59)
- Song search now requires sign-in (it was open to anyone and could be used as a free proxy to Apple's API).
- Editing a note's text no longer fails with "Pick a song from the list" after the server restarts or sleeps; the song already on your note is always accepted.
- Choosing "No mood" while editing a note now really clears the mood.
- The in-memory song cache is capped at 2000 entries (it used to grow forever).
- Preview buttons now show the true play/pause state; there is a single audio player instead of two fighting over one reference.
- Saving, replying to and removing a note show an error message instead of failing silently; the Save button is disabled while saving.
- New tests: `backend/test/notesMusic.test.mjs`, `frontend/test/notesMusic.test.jsx`.

## Search upgrade (v60): song name, lyrics line, artist/movie + trending first
- The song picker now opens on **🔥 Trending now** (Apple's India "most played" chart; Tamil tab shows Tamil songs, English tab the rest).
- One search box finds songs by **song name, artist, album/movie, or a line of lyrics**.
- Trending songs are listed first in search results and get a 🔥 badge; songs found by lyrics show "🎤 lyrics match" (and come first when you type a long, lyric-like line).
- Lyrics lookup uses Genius' public search by default. For better accuracy set `MUSIXMATCH_API_KEY` in Render (free key from developer.musixmatch.com); it is used automatically when present.
- Everything extra is best-effort: if the chart or lyrics service is down, normal name/artist search still works.
- Files: `backend/src/songs.js`, `backend/src/routes/notes.js`, `frontend/src/components/NotesBar.jsx`, `frontend/src/api.js`, both notesMusic tests.
- Not tested against the live Apple/Genius servers (no network access here) — test once after deploy.

## Phone keyboard fix (v61)
- On phones, opening the keyboard no longer covers the page: the fixed bottom menu bar, AI button and banners are hidden while you type and return when the keyboard closes; the page uses the full visible height and the field you tap scrolls into view.
- Files: `frontend/src/keyboard.js` (new), `frontend/src/main.jsx`, `frontend/src/mobile.css`.
