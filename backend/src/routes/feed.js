import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { postDTO, VISIBLE_SQL, visibleParams } from './posts.js';
import { PRIVATE_OK_SQL } from './users.js';
import { reelDTO } from './reels.js';

const router = Router();
const PAGE_SIZE = 10;

function blockedIds(userId) {
  const rows = db.prepare(`
    SELECT blocked_id AS id FROM blocks WHERE blocker_id = ?
    UNION SELECT blocker_id AS id FROM blocks WHERE blocked_id = ?
    UNION SELECT muted_id AS id FROM mutes WHERE muter_id = ?
  `).all(userId, userId, userId);
  return rows.map(r => r.id);
}

// Posts and reels share one feed: merge both lists, keep one page, and tag each item with its kind
// ('post' | 'reel') so the client knows which endpoints its like / comment / save buttons use.
function mergePage(postRows, reelRows, viewerId, cmp) {
  const all = [
    ...postRows.map(r => ({ r, kind: 'post' })),
    ...reelRows.map(r => ({ r, kind: 'reel' })),
  ].sort((a, b) => cmp(a.r, b.r));
  const hasMore = all.length > PAGE_SIZE;
  const page = all.slice(0, PAGE_SIZE);
  // The cursor is a timestamp, so it continues from the oldest item on this page.
  const oldest = page.reduce((m, x) => (!m || x.r.created_at < m ? x.r.created_at : m), null);
  return {
    posts: page.map(x => (x.kind === 'reel' ? { kind: 'reel', ...reelDTO(x.r, viewerId) } : { kind: 'post', ...postDTO(x.r, viewerId) })),
    nextCursor: hasMore ? oldest : null,
  };
}

router.get('/following', requireAuth, (req, res) => {
  const cursor = req.query.cursor || '9999-12-31T23:59:59.999Z';
  const blocked = blockedIds(req.userId);
  const placeholders = blocked.length ? blocked.map(() => '?').join(',') : null;

  const sql = `
    SELECT p.* FROM posts p
    WHERE p.deleted_at IS NULL
      AND p.created_at < ?
      AND (p.user_id IN (SELECT followed_id FROM follows WHERE follower_id = ?) OR p.user_id = ?)
      AND ${PRIVATE_OK_SQL('p.user_id')}
      ${placeholders ? `AND p.user_id NOT IN (${placeholders})` : ''}
    ORDER BY p.created_at DESC
    LIMIT ?
  `;
  const params = [cursor, req.userId, req.userId, req.userId, req.userId, ...(blocked.length ? blocked : []), PAGE_SIZE + 1];
  const rows = db.prepare(sql).all(...params);

  const reelRows = db.prepare(`
    SELECT r.* FROM reels r
    WHERE r.deleted_at IS NULL AND r.created_at < ?
      AND (r.user_id IN (SELECT followed_id FROM follows WHERE follower_id = ?) OR r.user_id = ?)
      AND ${PRIVATE_OK_SQL('r.user_id')}
      ${placeholders ? `AND r.user_id NOT IN (${placeholders})` : ''}
    ORDER BY r.created_at DESC LIMIT ?
  `).all(cursor, req.userId, req.userId, req.userId, req.userId, ...(blocked.length ? blocked : []), PAGE_SIZE + 1);
  res.json(mergePage(rows, reelRows, req.userId, (a, b) => (a.created_at < b.created_at ? 1 : -1)));
});

router.get('/foryou', requireAuth, (req, res) => {
  const cursor = req.query.cursor || '9999-12-31T23:59:59.999Z';
  const blocked = blockedIds(req.userId);
  const placeholders = blocked.length ? blocked.map(() => '?').join(',') : null;

  // Simple "for you" ranking for the vertical slice: recency + engagement (likes+comments),
  // excluding blocked users. A full recommendation system is out of scope for this slice.
  const sql = `
    SELECT p.*,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comment_count
    FROM posts p
    WHERE p.deleted_at IS NULL
      AND p.created_at < ?
      AND ${VISIBLE_SQL}
      ${placeholders ? `AND p.user_id NOT IN (${placeholders})` : ''}
    ORDER BY (like_count * 2 + comment_count * 3) DESC, p.created_at DESC
    LIMIT ?
  `;
  const params = [cursor, ...visibleParams(req.userId), ...(blocked.length ? blocked : []), PAGE_SIZE + 1];
  const rows = db.prepare(sql).all(...params);

  const reelRows = db.prepare(`
    SELECT r.*,
      (SELECT COUNT(*) FROM reel_likes l WHERE l.reel_id = r.id) AS like_count,
      (SELECT COUNT(*) FROM reel_comments c WHERE c.reel_id = r.id AND c.deleted_at IS NULL) AS comment_count
    FROM reels r
    WHERE r.deleted_at IS NULL AND r.created_at < ? AND ${PRIVATE_OK_SQL('r.user_id')}
      ${placeholders ? `AND r.user_id NOT IN (${placeholders})` : ''}
    ORDER BY (like_count * 2 + comment_count * 3) DESC, r.created_at DESC LIMIT ?
  `).all(cursor, req.userId, req.userId, ...(blocked.length ? blocked : []), PAGE_SIZE + 1);
  const score = (x) => (x.like_count || 0) * 2 + (x.comment_count || 0) * 3;
  res.json(mergePage(rows, reelRows, req.userId, (a, b) => (score(b) - score(a)) || (a.created_at < b.created_at ? 1 : -1)));
});

export default router;
