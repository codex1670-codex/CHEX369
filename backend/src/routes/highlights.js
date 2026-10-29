import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db, { toPublicUser, USER_MEDIA_COLUMNS_SQL } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { storyDTO } from './stories.js';

// Story highlights + the story archive.
//   GET    /archive               my stories, newest first, including expired ones
//   GET    /user/:username        a profile's highlight row (cover, title, count)
//   GET    /:id                   one highlight with its stories, ready for the story viewer
//   POST   /                      { title, storyIds }
//   PATCH  /:id                   { title?, coverStoryId?, addStoryIds?, removeStoryIds? }
//   DELETE /:id                   removes the highlight only — the stories are kept
const router = Router();
const MAX_HIGHLIGHTS = 50;
const MAX_STORIES_PER_CALL = 100;
const MAX_TITLE = 30;

const err = (res, status, code, message) => res.status(status).json({ error: { code, message } });

const isBlocked = (a, b) => !!db.prepare(
  'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').get(a, b, b, a);
const follows = (a, b) => !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?').get(a, b);
const isCloseFriend = (ownerId, viewerId) => !!db.prepare('SELECT 1 FROM close_friends WHERE owner_id = ? AND friend_id = ?').get(ownerId, viewerId);

// May `viewerId` open this owner's highlights at all? Owner always; otherwise the account must be
// active, not blocked either way, and — if private — followed by the viewer.
function canOpenHighlights(owner, viewerId) {
  if (!owner || owner.account_status !== 'active') return false;
  if (owner.id === viewerId) return true;
  if (isBlocked(owner.id, viewerId)) return false;
  if (owner.is_private && !follows(viewerId, owner.id)) return false;
  return true;
}

// The story's own audience still applies inside a highlight.
function storyVisible(story, viewerId) {
  if (story.user_id === viewerId) return true;
  if (story.audience === 'close_friends') return isCloseFriend(story.user_id, viewerId);
  if (story.audience === 'followers') return follows(viewerId, story.user_id);
  return true;
}

function cleanTitle(raw) {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE) : '';
}

// Only the caller's own, not-deleted stories may be added.
function ownStoryIds(userId, ids) {
  if (!Array.isArray(ids)) return [];
  const unique = [...new Set(ids.filter(i => typeof i === 'string'))].slice(0, MAX_STORIES_PER_CALL);
  const q = db.prepare('SELECT id FROM stories WHERE id = ? AND user_id = ? AND deleted_at IS NULL');
  return unique.filter(id => q.get(id, userId));
}

const itemsFor = (highlightId) => db.prepare(`
  SELECT s.* FROM story_highlight_items i JOIN stories s ON s.id = i.story_id
  WHERE i.highlight_id = ? AND s.deleted_at IS NULL ORDER BY s.created_at ASC
`).all(highlightId);

function coverOf(h, visibleStories) {
  const pick = visibleStories.find(s => s.id === h.cover_story_id) || visibleStories[0];
  return pick ? { storyId: pick.id, mediaType: pick.media_type, content: pick.content, background: pick.background } : null;
}

function highlightSummary(h, viewerId) {
  const visible = itemsFor(h.id).filter(s => storyVisible(s, viewerId));
  return { id: h.id, title: h.title, createdAt: h.created_at, storyCount: visible.length, cover: coverOf(h, visible) };
}

router.get('/archive', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM story_highlight_items i WHERE i.story_id = s.id) AS highlight_count
    FROM stories s WHERE s.user_id = ? AND s.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT 300
  `).all(req.userId);
  const now = new Date().toISOString();
  res.json({
    stories: rows.map(r => ({ ...storyDTO(r, req.userId), expired: r.expires_at <= now, highlightCount: r.highlight_count })),
  });
});

router.get('/user/:username', requireAuth, (req, res) => {
  const owner = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!owner || !canOpenHighlights(owner, req.userId)) {
    // Same shape as an empty list so blocked / private / missing accounts aren't distinguishable.
    return res.json({ highlights: [] });
  }
  const rows = db.prepare('SELECT * FROM story_highlights WHERE user_id = ? ORDER BY created_at ASC').all(owner.id);
  const list = rows.map(h => highlightSummary(h, req.userId)).filter(h => owner.id === req.userId || h.storyCount > 0);
  res.json({ highlights: list });
});

router.get('/:id', requireAuth, (req, res) => {
  const h = db.prepare('SELECT * FROM story_highlights WHERE id = ?').get(req.params.id);
  const owner = h && db.prepare(`SELECT id, username, display_name, avatar_color, account_status, is_private, ${USER_MEDIA_COLUMNS_SQL} FROM users WHERE id = ?`).get(h.user_id);
  if (!h || !canOpenHighlights(owner, req.userId)) return err(res, 404, 'NOT_FOUND', 'Highlight not found.');
  const stories = itemsFor(h.id).filter(s => storyVisible(s, req.userId));
  if (!stories.length && owner.id !== req.userId) return err(res, 404, 'NOT_FOUND', 'Highlight not found.');
  res.json({
    highlight: { id: h.id, title: h.title, isMine: owner.id === req.userId },
    author: toPublicUser(owner),
    stories: stories.map(s => storyDTO(s, req.userId)),
  });
});

router.post('/', requireAuth, (req, res) => {
  const { title, storyIds } = req.body || {};
  const ids = ownStoryIds(req.userId, storyIds);
  if (!ids.length) return err(res, 400, 'NO_STORIES', 'Pick at least one of your stories.');
  const count = db.prepare('SELECT COUNT(*) c FROM story_highlights WHERE user_id = ?').get(req.userId).c;
  if (count >= MAX_HIGHLIGHTS) return err(res, 400, 'LIMIT_REACHED', `You can have up to ${MAX_HIGHLIGHTS} highlights.`);
  const id = uuid();
  db.transaction(() => {
    db.prepare('INSERT INTO story_highlights (id, user_id, title, cover_story_id) VALUES (?, ?, ?, ?)')
      .run(id, req.userId, cleanTitle(title) || 'Highlights', ids[0]);
    const ins = db.prepare('INSERT OR IGNORE INTO story_highlight_items (highlight_id, story_id) VALUES (?, ?)');
    ids.forEach(sid => ins.run(id, sid));
  })();
  res.status(201).json({ highlight: highlightSummary(db.prepare('SELECT * FROM story_highlights WHERE id = ?').get(id), req.userId) });
});

router.patch('/:id', requireAuth, (req, res) => {
  const h = db.prepare('SELECT * FROM story_highlights WHERE id = ?').get(req.params.id);
  if (!h) return err(res, 404, 'NOT_FOUND', 'Highlight not found.');
  if (h.user_id !== req.userId) return err(res, 403, 'FORBIDDEN', 'You can only edit your own highlights.');
  const { title, coverStoryId, addStoryIds, removeStoryIds } = req.body || {};
  if (title !== undefined && !cleanTitle(title)) return err(res, 400, 'EMPTY_TITLE', 'Give the highlight a name.');
  const add = ownStoryIds(req.userId, addStoryIds);
  const remove = Array.isArray(removeStoryIds) ? removeStoryIds.filter(i => typeof i === 'string') : [];

  const apply = db.transaction(() => {
    const ins = db.prepare('INSERT OR IGNORE INTO story_highlight_items (highlight_id, story_id) VALUES (?, ?)');
    add.forEach(sid => ins.run(h.id, sid));
    const del = db.prepare('DELETE FROM story_highlight_items WHERE highlight_id = ? AND story_id = ?');
    remove.forEach(sid => del.run(h.id, sid));
    const left = itemsFor(h.id);
    if (!left.length) throw Object.assign(new Error('empty'), { code: 'EMPTY' });
    let cover = h.cover_story_id;
    if (typeof coverStoryId === 'string') {
      if (!left.some(s => s.id === coverStoryId)) throw Object.assign(new Error('cover'), { code: 'BAD_COVER' });
      cover = coverStoryId;
    }
    if (!left.some(s => s.id === cover)) cover = left[0].id; // old cover was removed
    db.prepare("UPDATE story_highlights SET title = ?, cover_story_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .run(title !== undefined ? cleanTitle(title) : h.title, cover, h.id);
  });
  try { apply(); } catch (e) {
    if (e.code === 'EMPTY') return err(res, 400, 'EMPTY_HIGHLIGHT', 'A highlight needs at least one story — delete the highlight instead.');
    if (e.code === 'BAD_COVER') return err(res, 400, 'BAD_COVER', 'The cover must be one of the stories in this highlight.');
    throw e;
  }
  res.json({ highlight: highlightSummary(db.prepare('SELECT * FROM story_highlights WHERE id = ?').get(h.id), req.userId) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const h = db.prepare('SELECT * FROM story_highlights WHERE id = ?').get(req.params.id);
  if (!h) return err(res, 404, 'NOT_FOUND', 'Highlight not found.');
  if (h.user_id !== req.userId) return err(res, 403, 'FORBIDDEN', 'You can only delete your own highlights.');
  db.prepare('DELETE FROM story_highlights WHERE id = ?').run(h.id);
  res.json({ ok: true });
});

export default router;
