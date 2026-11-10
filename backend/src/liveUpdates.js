// Real-time "something changed" broadcaster.
// After ANY successful write (POST/PUT/PATCH/DELETE) to a content route, every connected client gets a
// tiny `live:update` event ({ scope, postId?, reelId?, from }). It carries NO private data: clients simply
// re-fetch through the normal, permission-checked API. That is how posts, reels, stories, notes, likes,
// comments, follows, highlights and profile edits show up for other users immediately, without a refresh.
const SCOPES = new Set(['posts', 'reels', 'stories', 'notes', 'highlights', 'users', 'feed', 'messages', 'life', 'coins', 'games', 'tournaments', 'calls']);
const SKIP = [/\/users\/me\/presence/, /\/reels\/[^/]+\/view/, /\/messages\/.*(typing|read|seen)/];

export function liveUpdates(app) {
  const pending = new Map();   // key -> payload, coalesces bursts (e.g. rapid double-tap likes)
  let timer = null;
  const flush = () => {
    timer = null;
    const io = app.get('io');
    for (const payload of pending.values()) io?.emit('live:update', payload);
    pending.clear();
  };
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      res.on('finish', () => {
        if (res.statusCode >= 400) return;
        const url = req.originalUrl.split('?')[0];
        if (SKIP.some(r => r.test(url))) return;
        const m = url.match(/^\/api\/([a-z]+)(?:\/([^/]+))?(?:\/([^/]+))?/);
        if (!m || !SCOPES.has(m[1])) return;
        const scope = m[1];
        // `action` lets clients react instantly (e.g. drop a deleted post/reel/story from the screen) instead of waiting for a re-fetch.
        const action = req.method === 'DELETE' && !m[3] ? 'delete' : req.method === 'POST' && !m[2] ? 'create' : 'update';
        const payload = { scope, action, from: req.get('x-client-id') || null, at: Date.now() };
        if (scope === 'posts' && m[2] && m[2] !== 'upload') payload.postId = m[2];
        if (scope === 'reels' && m[2] && m[2] !== 'upload') payload.reelId = m[2];
        if (scope === 'stories' && m[2] && !['upload', 'feed'].includes(m[2])) payload.storyId = m[2];
        if (scope === 'notes' && m[2]) payload.noteId = m[2];
        // Stories feed the stories bar AND the profile/highlights; likes/comments also change the feed lists.
        pending.set(`${scope}:${action}:${payload.postId || payload.reelId || payload.storyId || payload.noteId || ''}:${payload.from || ''}`, payload);
        if (!timer) timer = setTimeout(flush, 120);
      });
    }
    next();
  };
}

// Account switched off / on (deactivate, delete, or logging back in): everyone's feeds, reels, stories and
// profiles must drop / restore that person's content right away, without a refresh.
export function broadcastAccountChange(io, userId, status) {
  if (!io) return;
  const at = Date.now();
  for (const scope of ['users', 'posts', 'reels', 'stories', 'highlights', 'feed', 'notes', 'messages']) io.emit('live:update', { scope, action: 'account', userId, status, from: null, at });
  io.emit('account:status', { userId, status });
}
