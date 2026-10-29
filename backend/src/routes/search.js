import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { profileFor, PRIVATE_OK_SQL } from './users.js';
import { postDTO, VISIBLE_SQL, visibleParams } from './posts.js';
import { reelDTO } from './reels.js';

const router = Router();

// Reels whose caption, author name/username or hashtag matches the query (blocked and private-hidden users excluded).
// Shared by GET /search and by Codex's "search reel <words>".
export function findReels(q, userId, limit = 12) {
  const normalizedTag = String(q).replace(/^#/, '').toLowerCase();
  return db.prepare(`
    SELECT DISTINCT r.* FROM reels r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN reel_hashtags rh ON rh.reel_id = r.id
    LEFT JOIN hashtags h ON h.id = rh.hashtag_id
    WHERE r.deleted_at IS NULL AND u.account_status = 'active'
      AND (r.caption LIKE ? OR u.username LIKE ? OR u.display_name LIKE ? OR h.tag LIKE ?)
      AND r.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?)
      AND ${PRIVATE_OK_SQL('r.user_id')}
    ORDER BY r.created_at DESC LIMIT ?
  `).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${normalizedTag}%`, userId, userId, userId, userId, limit);
}


router.get('/', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ users: [], hashtags: [], reels: [] });

  const users = db.prepare(`
    SELECT * FROM users WHERE account_status = 'active' AND (username LIKE ? OR display_name LIKE ?)
    AND id != ? LIMIT 8
  `).all(`%${q}%`, `%${q}%`, req.userId);

  const normalizedTag = q.replace(/^#/, '').toLowerCase();
  const hashtags = db.prepare(`
    SELECT h.*, (SELECT COUNT(*) FROM post_hashtags ph WHERE ph.hashtag_id = h.id) +
                (SELECT COUNT(*) FROM reel_hashtags rh WHERE rh.hashtag_id = h.id) AS post_count
    FROM hashtags h WHERE h.tag LIKE ? ORDER BY post_count DESC LIMIT 8
  `).all(`%${normalizedTag}%`);

  const reelRows = findReels(q, req.userId);

  res.json({
    users: users.map(u => profileFor(u, req.userId)),
    hashtags: hashtags.map(h => ({ tag: h.tag, postCount: h.post_count })),
    reels: reelRows.map(r => reelDTO(r, req.userId)),
  });
});

router.get('/hashtags/:tag', requireAuth, (req, res) => {
  const tag = req.params.tag.replace(/^#/, '').toLowerCase();
  const hashtag = db.prepare('SELECT * FROM hashtags WHERE tag = ?').get(tag);
  if (!hashtag) return res.json({ tag, posts: [], reels: [] });

  const postRows = db.prepare(`
    SELECT p.* FROM post_hashtags ph JOIN posts p ON p.id = ph.post_id
    WHERE ph.hashtag_id = ? AND p.deleted_at IS NULL AND ${VISIBLE_SQL} ORDER BY p.created_at DESC LIMIT 30
  `).all(hashtag.id, ...visibleParams(req.userId));

  const reelRows = db.prepare(`
    SELECT r.* FROM reel_hashtags rh JOIN reels r ON r.id = rh.reel_id
    WHERE rh.hashtag_id = ? AND r.deleted_at IS NULL AND ${PRIVATE_OK_SQL('r.user_id')} ORDER BY r.created_at DESC LIMIT 30
  `).all(hashtag.id, req.userId, req.userId);

  res.json({ tag, posts: postRows.map(p => postDTO(p, req.userId)), reels: reelRows.map(r => reelDTO(r, req.userId)) });
});

export default router;
