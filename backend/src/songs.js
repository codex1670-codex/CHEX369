// Live song search for Notes.
//  - Text search (song name, artist, album/movie) -> Apple's public iTunes Search API.
//  - Lyrics-line search -> a lyrics index (Musixmatch if MUSIXMATCH_API_KEY is set, otherwise Genius'
//    public search), then every candidate is resolved through iTunes so it has artwork + a preview.
//  - Trending -> Apple's India "most played" chart. Trending songs are listed first, and shown
//    on their own when the search box is empty.
// Every outside call is best-effort: if the chart or the lyrics index is down, plain text search
// still works. Only preview URLs supplied by the catalog are returned.
const cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;
const CHART_TTL_MS = 60 * 60 * 1000;
const CHART_FAIL_TTL_MS = 5 * 60 * 1000;
// Map keeps insertion order, so the oldest entries are dropped first. Without a cap, every
// search would grow server memory forever.
const CACHE_MAX_ENTRIES = 2000;
const UA = { 'User-Agent': 'CHEX369/1.0 (music note previews)' };
const INDIAN_LANGS = new Set(['tamil', 'telugu', 'hindi', 'bollywood', 'malayalam', 'kannada', 'punjabi', 'bengali', 'marathi', 'gujarati', 'indian pop', 'indian', 'devotional & spiritual', 'ghazals']);

function remember(key, value) {
  cache.delete(key); // re-insert so it counts as newest
  cache.set(key, value);
  while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

export function songCacheSize() { return cache.size; }

async function getJson(url, ms = 7000) {
  const response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!response.ok) throw new Error(`${new URL(url).host} returned ${response.status}`);
  return response.json();
}

function toSong(x, language, extra = {}) {
  const song = {
    id: `itunes-${x.trackId}`,
    title: String(x.trackName).slice(0, 180),
    artist: String(x.artistName).slice(0, 180),
    album: String(x.collectionName || '').slice(0, 180),
    artworkUrl: typeof x.artworkUrl100 === 'string' ? x.artworkUrl100 : '',
    previewUrl: typeof x.previewUrl === 'string' && x.previewUrl.startsWith('https://') ? x.previewUrl : '',
    trackUrl: typeof x.trackViewUrl === 'string' && x.trackViewUrl.startsWith('https://') ? x.trackViewUrl : '',
    genre: String(x.primaryGenreName || '').slice(0, 60),
    language,
    provider: 'itunes',
    ...extra,
  };
  remember(song.id, { song, at: Date.now() });
  return song;
}

const validTrack = x => x && x.trackId && x.trackName && x.artistName;

// ---------- trending ----------
let chartState = { at: 0, ok: false, songs: [] };
let chartPending = null;

async function fetchChartIds() {
  try {
    const data = await getJson('https://rss.applemarketingtools.com/api/v2/in/music/most-played/100/songs.json');
    const ids = (data?.feed?.results || []).map(r => String(r.id)).filter(id => /^\d+$/.test(id));
    if (ids.length) return ids;
  } catch { /* fall through to the older feed */ }
  const data = await getJson('https://itunes.apple.com/in/rss/topsongs/limit=100/json');
  return (data?.feed?.entry || []).map(e => String(e?.id?.attributes?.['im:id'] || '')).filter(id => /^\d+$/.test(id));
}

async function loadChart() {
  const ids = await fetchChartIds();
  if (!ids.length) throw new Error('Empty chart');
  const url = new URL('https://itunes.apple.com/lookup');
  url.searchParams.set('id', ids.join(','));
  url.searchParams.set('country', 'IN');
  url.searchParams.set('entity', 'song');
  const data = await getJson(url);
  const byId = new Map((data.results || []).filter(validTrack).map(x => [String(x.trackId), x]));
  // Keep the chart's own order (rank 1 first).
  return ids.map((id, i) => (byId.has(id) ? { raw: byId.get(id), rank: i + 1 } : null)).filter(Boolean);
}

// Returns [{ raw, rank }] ordered by chart position. Cached for an hour; a failure is cached
// briefly so a dead chart doesn't slow down every search.
async function getChart() {
  const age = Date.now() - chartState.at;
  if (chartState.at && age < (chartState.ok ? CHART_TTL_MS : CHART_FAIL_TTL_MS)) return chartState.songs;
  if (!chartPending) {
    chartPending = loadChart()
      .then(songs => { chartState = { at: Date.now(), ok: true, songs }; })
      .catch(() => { chartState = { at: Date.now(), ok: false, songs: chartState.songs }; })
      .finally(() => { chartPending = null; });
  }
  await chartPending;
  return chartState.songs;
}

const isIndianGenre = g => INDIAN_LANGS.has(String(g || '').toLowerCase());
const matchesLanguage = (raw, language) => (language === 'tamil'
  ? String(raw.primaryGenreName || '').toLowerCase() === 'tamil'
  : !isIndianGenre(raw.primaryGenreName));

export function resetTrendingForTests() { chartState = { at: 0, ok: false, songs: [] }; chartPending = null; }

export async function trendingSongs(language = 'tamil') {
  const chart = await getChart();
  let picked = chart.filter(c => matchesLanguage(c.raw, language));
  // If the chart has too few songs of this language, show the overall chart rather than an empty list.
  if (picked.length < 5) picked = chart;
  const songs = picked.slice(0, 25).map(c => toSong(c.raw, language, { trending: true, trendRank: c.rank }));
  if (songs.length) return songs;
  // Chart unavailable: fall back to a popularity-ordered catalog search, still labelled honestly.
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', language === 'tamil' ? 'Tamil hits' : 'top hits');
  url.searchParams.set('country', 'IN'); url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'song'); url.searchParams.set('limit', '25');
  const data = await getJson(url);
  return (data.results || []).filter(validTrack).map(x => toSong(x, language));
}

// ---------- lyrics ----------
async function lyricCandidates(q) {
  const key = process.env.MUSIXMATCH_API_KEY;
  if (key) {
    const url = new URL('https://api.musixmatch.com/ws/1.1/track.search');
    url.searchParams.set('q_lyrics', q); url.searchParams.set('page_size', '6');
    url.searchParams.set('s_track_rating', 'desc'); url.searchParams.set('apikey', key);
    const data = await getJson(url, 5000);
    return (data?.message?.body?.track_list || []).map(t => ({ title: t.track?.track_name, artist: t.track?.artist_name }));
  }
  const url = new URL('https://genius.com/api/search/song');
  url.searchParams.set('q', q); url.searchParams.set('per_page', '6');
  const data = await getJson(url, 5000);
  const hits = (data?.response?.sections || []).flatMap(s => s.hits || []);
  return hits.map(h => ({ title: h.result?.title, artist: h.result?.primary_artist?.name }));
}

const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

// Resolve each lyrics hit to a real, playable catalog track (best iTunes match for title + artist).
async function lyricMatches(q, language) {
  const candidates = (await lyricCandidates(q)).filter(c => c.title && c.artist).slice(0, 5);
  const resolved = await Promise.allSettled(candidates.map(async c => {
    const url = new URL('https://itunes.apple.com/search');
    url.searchParams.set('term', `${c.title} ${c.artist}`.slice(0, 100));
    url.searchParams.set('country', 'IN'); url.searchParams.set('media', 'music');
    url.searchParams.set('entity', 'song'); url.searchParams.set('limit', '5');
    const data = await getJson(url);
    const wantTitle = norm(c.title);
    const hit = (data.results || []).filter(validTrack).find(x => norm(x.trackName).includes(wantTitle) || wantTitle.includes(norm(x.trackName)));
    return hit ? toSong(hit, language, { matchedBy: 'lyrics' }) : null;
  }));
  return resolved.map(r => (r.status === 'fulfilled' ? r.value : null)).filter(Boolean);
}

// ---------- main search ----------
export async function searchSongs(term = '', language = 'tamil') {
  const q = String(term || '').trim().slice(0, 100);
  if (q.length < 2) return [];
  const key = `search:IN:${language}:${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.songs;

  const words = q.split(/\s+/).length;
  const looksLikeLyric = words >= 4;
  const textUrl = new URL('https://itunes.apple.com/search');
  textUrl.searchParams.set('term', language === 'tamil' ? `${q} Tamil` : q);
  textUrl.searchParams.set('country', 'IN');
  textUrl.searchParams.set('media', 'music');
  textUrl.searchParams.set('entity', 'song');
  textUrl.searchParams.set('limit', '25');

  // Text search is required; chart + lyrics are optional extras that must never break it.
  const [textRes, chartRes, lyricRes] = await Promise.allSettled([
    getJson(textUrl),
    getChart(),
    q.length >= 3 ? lyricMatches(q, language) : Promise.resolve([]),
  ]);
  if (textRes.status === 'rejected' && !(lyricRes.status === 'fulfilled' && lyricRes.value.length)) {
    throw textRes.reason instanceof Error ? textRes.reason : new Error('Music catalog unavailable');
  }

  const rankById = new Map();
  if (chartRes.status === 'fulfilled') chartRes.value.forEach(c => rankById.set(`itunes-${c.raw.trackId}`, c.rank));
  const flag = song => {
    const rank = rankById.get(song.id);
    return rank ? { ...song, trending: true, trendRank: rank } : song;
  };
  const byTrend = (a, b) => (a.trendRank || 1e9) - (b.trendRank || 1e9);

  const textSongs = textRes.status === 'fulfilled' ? (textRes.value.results || []).filter(validTrack).map(x => toSong(x, language)) : [];
  const lyricSongs = lyricRes.status === 'fulfilled' ? lyricRes.value : [];
  const lyricIds = new Set(lyricSongs.map(s => s.id));

  // Order: (lyric-looking query) lyric matches first -> trending songs -> everything else in catalog order.
  const rest = textSongs.filter(s => !lyricIds.has(s.id)).map(flag);
  const lyrics = lyricSongs.map(flag).sort(byTrend);
  const trending = rest.filter(s => s.trending).sort(byTrend);
  const others = rest.filter(s => !s.trending);
  const songs = looksLikeLyric
    ? [...lyrics, ...trending, ...others]
    : [...trending, ...lyrics, ...others]; // short query: name/artist hits stay prominent, trending first
  const unique = [...new Map(songs.map(s => [s.id, s])).values()].slice(0, 30);
  unique.forEach(s => remember(s.id, { song: s, at: Date.now() }));
  remember(key, { songs: unique, at: Date.now() });
  return unique;
}

export function findSong(songId) {
  if (!songId || typeof songId !== 'string') return null;
  return cache.get(songId)?.song || null;
}
