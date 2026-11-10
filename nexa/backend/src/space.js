// "Second space" = a second, password-protected identity ("shadow" user) owned by a real account.
// A shadow user is an ordinary users row with private_owner_id set.
//
// What is SHARED with the normal app (one community):
//   * posts, reels, stories, search and the user directory — the second-space profile is visible,
//     searchable and followable like any other profile, and it sees everyone else's posts/reels.
//   * messaging works both ways: a second-space profile can message normal users and vice versa.
// What stays SEPARATE:
//   * the Profile (its own username, display name, followers, following, posts).
//   * the Messages page: a chat the owner "moves to the second space" disappears from the normal Messages
//     list and shows up only in the second space, under a second-space display name (same username).
// What does NOT exist in the second space: Games, CHEX learn and Sticky notes (blocked by blockShadow).
import jwt from 'jsonwebtoken';
import db, { toPublicUser, USER_MEDIA_COLUMNS_SQL } from './db.js';
import { ACCESS_SECRET } from './middleware/auth.js';

export function ownerOf(userId) {
  if (!userId) return null;
  return db.prepare('SELECT private_owner_id p FROM users WHERE id = ?').get(userId)?.p || null;
}
export const isShadow = (userId) => !!ownerOf(userId);

export function viewerIdFromReq(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  try { return jwt.verify(h.slice(7), ACCESS_SECRET).sub; } catch { return null; }
}

export function shadowFor(ownerId) {
  return db.prepare('SELECT s.*, ps.shadow_id FROM private_spaces ps JOIN users s ON s.id = ps.shadow_id WHERE ps.owner_id = ?').get(ownerId);
}

// Games, CHEX learn (coins/learn), sticky notes and alarms do not exist in the second space.
export function blockShadow(req, res, next) {
  if (isShadow(viewerIdFromReq(req))) {
    return res.status(403).json({ error: { code: 'SPACE_RESTRICTED', message: 'Games, CHEX learn and sticky notes are not available in the second space.' } });
  }
  next();
}

// ---------------- chats moved to the second space ----------------
// space_chats(owner_id, conversation_id, contact_id, display_name): the owner's 1-to-1 chat with `contact_id`
// is hidden from the normal Messages list and listed in the second space under `display_name`.
export function movedChat(ownerId, conversationId) {
  if (!ownerId || !conversationId) return null;
  return db.prepare('SELECT sc.*, ps.shadow_id FROM space_chats sc JOIN private_spaces ps ON ps.owner_id = sc.owner_id WHERE sc.owner_id = ? AND sc.conversation_id = ?').get(ownerId, conversationId) || null;
}
export function movedChatByUsername(ownerId, username) {
  if (!ownerId || !username) return null;
  return db.prepare(`SELECT sc.*, ps.shadow_id FROM space_chats sc JOIN private_spaces ps ON ps.owner_id = sc.owner_id
    JOIN users u ON u.id = sc.contact_id WHERE sc.owner_id = ? AND u.username = ?`).get(ownerId, username) || null;
}

// The owner's moved chats are stored under the owner's id. Everything the second space sees of them is
// rewritten so it looks like the second-space profile's own chat: the owner becomes the shadow profile and
// the contact keeps the SAME username but shows the second-space display name.
export function mapForShadow(body, shadowId) {
  const ownerId = ownerOf(shadowId);
  if (!ownerId || body === null || typeof body !== 'object') return body;
  const row = db.prepare(`SELECT id, username, display_name, avatar_color, ${USER_MEDIA_COLUMNS_SQL} FROM users WHERE id = ?`).get(shadowId);
  const me = toPublicUser(row);
  const aliases = new Map(db.prepare('SELECT contact_id, display_name FROM space_chats WHERE owner_id = ?').all(ownerId).map(r => [r.contact_id, r.display_name]));
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      if (v.id === ownerId && typeof v.username === 'string') return { ...me, ...(v.role ? { role: v.role } : {}) };
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      if (typeof out.id === 'string' && aliases.has(out.id) && typeof out.username === 'string' && 'displayName' in out) out.displayName = aliases.get(out.id);
      return out;
    }
    return v === ownerId ? shadowId : v;
  };
  return walk(body);
}
