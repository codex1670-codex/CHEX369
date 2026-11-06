// Real-time "something changed" broadcaster.
// After ANY successful write (POST/PUT/PATCH/DELETE) to a content route, every connected client gets a
// tiny `live:update` event ({ scope, postId?, reelId?, from }). It carries NO private data: clients simply
// re-fetch through the normal, permission-checked API. That is how posts, reels, stories, notes, likes,
// comments, follows, highlights and profile edits show up for other users immediately, without a refresh.
const SCOPES = new Set(['posts', 'reels', 'stories', 'notes', 'highlights', 'users', 'feed', 'messages']);
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
        const m = url.match(/^\/api\/([a-z]+)(?:\/([^/]+))?/);
        if (!m || !SCOPES.has(m[1])) return;
        const scope = m[1];
        const payload = { scope, from: req.get('x-client-id') || null, at: Date.now() };
        if (scope === 'posts' && m[2] && m[2] !== 'upload') payload.postId = m[2];
        if (scope === 'reels' && m[2] && m[2] !== 'upload') payload.reelId = m[2];
        pending.set(`${scope}:${payload.postId || payload.reelId || ''}:${payload.from || ''}`, payload);
        if (!timer) timer = setTimeout(flush, 120);
      });
    }
    next();
  };
}
