// Notes + live song search (iTunes call is mocked so the test runs offline).
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-notes-music-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });

const { default: db } = await import('../src/db.js');
const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { default: notesRouter } = await import('../src/routes/notes.js');
const { songCacheSize, resetTrendingForTests } = await import('../src/songs.js');
const { ACCESS_SECRET } = await import('../src/middleware/auth.js');

const mk = (name) => {
  db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)')
    .run(`id-${name}`, name, `${name}@x.com`, 'x', name);
  return `id-${name}`;
};
const me = mk('me');

const app = express();
app.use(express.json());
app.use('/notes', notesRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const realFetch = globalThis.fetch;

// Only outside requests are faked; calls to the local test server go through.
let itunesCalls = 0;
let fakeResults = [];
let chartIds = [];            // ids on the fake "most played" chart (rank = position)
let chartTracks = {};         // trackId -> raw iTunes track returned by lookup
let lyricHits = [];           // [{title, artist}] returned by the fake lyrics index
let lyricsDown = false;
const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://rss.applemarketingtools.com/')) return json({ feed: { results: chartIds.map(id => ({ id: String(id) })) } });
  if (u.startsWith('https://genius.com/')) {
    if (lyricsDown) return json({}, 500);
    return json({ response: { sections: [{ hits: lyricHits.map(h => ({ result: { title: h.title, primary_artist: { name: h.artist } } })) }] } });
  }
  if (u.startsWith('https://itunes.apple.com/in/rss/')) return json({ feed: { entry: [] } });
  if (u.startsWith('https://itunes.apple.com/lookup')) {
    return json({ results: new URL(u).searchParams.get('id').split(',').map(id => chartTracks[id]).filter(Boolean) });
  }
  if (u.startsWith('https://itunes.apple.com/')) {
    itunesCalls++;
    const term = new URL(u).searchParams.get('term');
    // A "Title Artist" lookup from the lyrics path resolves to that exact track.
    const lyric = lyricHits.find(h => term === `${h.title} ${h.artist}`);
    if (lyric) return json({ results: [lyric.track] });
    return json({ results: fakeResults });
  }
  return realFetch(url, opts);
};
test.after(() => { server.close(); globalThis.fetch = realFetch; });

const call = async (method, url, uid, body) => {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = `Bearer ${jwt.sign({ sub: uid }, ACCESS_SECRET)}`;
  const r = await realFetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const track = (id, extra = {}) => ({ trackId: id, trackName: `Song ${id}`, artistName: 'Artist', collectionName: 'Album',
  artworkUrl100: 'https://img/x.jpg', previewUrl: `https://audio/${id}.m4a`, trackViewUrl: `https://music/${id}`, ...extra });

test.beforeEach(() => { resetTrendingForTests(); lyricHits = []; lyricsDown = false; chartIds = []; chartTracks = {}; });

test('song search requires sign-in', async () => {
  const r = await call('GET', '/notes/songs?term=arijit', null);
  assert.equal(r.status, 401);
  assert.equal(itunesCalls, 0, 'must not hit the catalog for anonymous callers');
});

test('song search returns catalog results and only https previews', async () => {
  fakeResults = [track(1), track(2, { previewUrl: 'http://insecure/2.m4a' }), track(3, { previewUrl: undefined })];
  const r = await call('GET', '/notes/songs?term=hello&language=english', me);
  assert.equal(r.status, 200);
  assert.equal(r.body.songs.length, 3);
  assert.equal(r.body.songs[0].previewUrl, 'https://audio/1.m4a');
  assert.equal(r.body.songs[1].previewUrl, '', 'http previews are dropped');
  assert.equal(r.body.songs[2].previewUrl, '');
  const again = await call('GET', '/notes/songs?term=hello&language=english', me);
  assert.equal(again.status, 200);
  assert.equal(itunesCalls, 1, 'second identical search is served from cache');
});

test('a note can carry a searched song; unknown songs are rejected', async () => {
  const ok = await call('POST', '/notes', me, { text: 'vibes', emoji: '🎧', songId: 'itunes-1', audience: 'everyone' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.note.song.title, 'Song 1');
  assert.equal(ok.body.note.song.previewUrl, 'https://audio/1.m4a');
  const bad = await call('POST', '/notes', me, { text: 'x', songId: 'itunes-424242' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'INVALID_SONG');
});

test('editing text keeps the attached song even when the server has forgotten the search', async () => {
  // Simulates a restart/sleep: the note is in the DB but the in-memory search cache is empty.
  db.prepare('DELETE FROM notes WHERE user_id = ?').run(me);
  db.prepare(`INSERT INTO notes (id, user_id, text, emoji, audience, song_id, song_title, song_artist, song_url, expires_at)
              VALUES ('n-old', ?, 'old', '🎧', 'everyone', 'itunes-777', 'Old Song', 'Old Artist', 'https://audio/777.m4a', ?)`)
    .run(me, new Date(Date.now() + 3600e3).toISOString());
  const r = await call('PATCH', '/notes/mine', me, { text: 'new text', emoji: '🎧', songId: 'itunes-777' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.note.text, 'new text');
  assert.equal(r.body.note.song.id, 'itunes-777');
  assert.equal(r.body.note.song.title, 'Old Song');
});

test('removing the song on edit clears it', async () => {
  const r = await call('PATCH', '/notes/mine', me, { text: 'no music now', songId: null });
  assert.equal(r.status, 200);
  assert.equal(r.body.note.song, null);
});

test('choosing "no mood" on edit actually clears the mood', async () => {
  await call('PATCH', '/notes/mine', me, { text: 'happy', mood: 'happy' });
  const set = db.prepare('SELECT mood FROM notes WHERE user_id = ?').get(me);
  assert.equal(set.mood, 'happy');
  const r = await call('PATCH', '/notes/mine', me, { text: 'happy', mood: null });
  assert.equal(r.status, 200);
  assert.ok(!r.body.note.mood, `mood should be cleared, got ${r.body.note.mood}`);
});

test('legacy demo-track notes never expose a playable URL', async () => {
  db.prepare("UPDATE notes SET song_id = 'demo-3', song_title = 'Demo', song_artist = 'X', song_url = 'https://demo/x.mp3' WHERE user_id = ?").run(me);
  const feed = await call('GET', '/notes/feed', me);
  assert.equal(feed.body.notes[0].song.previewUrl, null);
});

test('the in-memory song cache is bounded', async () => {
  for (let i = 0; i < 40; i++) {
    fakeResults = Array.from({ length: 25 }, (_, k) => track(10000 + i * 100 + k));
    await call('GET', `/notes/songs?term=flood${i}`, me);
  }
  assert.ok(songCacheSize() <= 2000, `cache grew to ${songCacheSize()}`);
});

test('empty search returns the trending chart (Tamil tab keeps Tamil songs, in chart order)', async () => {
  chartIds = [901, 902, 903, 904, 905, 906, 907];
  chartTracks = Object.fromEntries(chartIds.map(id => [String(id), track(id, { primaryGenreName: id === 902 ? 'Pop' : 'Tamil' })]));
  const r = await call('GET', '/notes/songs?term=&language=tamil', me);
  assert.equal(r.status, 200);
  assert.equal(r.body.kind, 'trending');
  assert.deepEqual(r.body.songs.map(s => s.trendRank), [1, 3, 4, 5, 6, 7], 'Pop song filtered out, chart order kept');
  assert.ok(r.body.songs.every(s => s.trending));
  const en = await call('GET', '/notes/songs?term=&language=english', me);
  assert.equal(en.body.songs.length, 7, 'too few English songs on the chart -> falls back to the whole chart');
});

test('search results put trending songs first and flag them', async () => {
  chartIds = [501];
  chartTracks = { '501': track(501) };
  fakeResults = [track(500), track(501), track(502)];
  const r = await call('GET', '/notes/songs?term=love&language=english', me);
  assert.deepEqual(r.body.songs.map(s => s.id), ['itunes-501', 'itunes-500', 'itunes-502']);
  assert.equal(r.body.songs[0].trending, true);
  assert.equal(r.body.songs[0].trendRank, 1);
  assert.ok(!r.body.songs[1].trending);
});

test('a lyrics line finds the song and lists it before text matches', async () => {
  lyricHits = [{ title: 'Real Song', artist: 'Real Artist', track: track(700, { trackName: 'Real Song', artistName: 'Real Artist' }) }];
  fakeResults = [track(1), track(2)];
  const r = await call('GET', '/notes/songs?term=some+lyric+line+goes+here&language=english', me);
  assert.equal(r.body.songs[0].id, 'itunes-700');
  assert.equal(r.body.songs[0].matchedBy, 'lyrics');
  assert.equal(r.body.songs.length, 3);
  // A song found by lyrics can be attached to a note.
  const ok = await call('POST', '/notes', me, { text: 'x', songId: 'itunes-700', audience: 'everyone' });
  assert.equal(ok.status, 201);
});

test('search still works when the lyrics index and the chart are down', async () => {
  lyricsDown = true;
  fakeResults = [track(11), track(12)];
  const r = await call('GET', '/notes/songs?term=plain+name&language=english', me);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.songs.map(s => s.id), ['itunes-11', 'itunes-12']);
});
