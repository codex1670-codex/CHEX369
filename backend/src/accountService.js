// Account lifecycle. Two DIFFERENT things, never mixed up:
//
//   deactivate -> TEMPORARY. Row stays, status = 'deactivated'. Logging in again with the
//                 same username/email + password switches it back on (same account, same data).
//   delete     -> PERMANENT. Only ever runs when the signed-in user explicitly asks for it
//                 (password + typed confirmation). Nothing in the server deletes accounts on
//                 its own: no timers, no cron, no cleanup-on-boot.
import db from './db.js';
import { removeLocalUpload } from './uploads.js';
import persistence from './persistence.js';

// Drop every live socket of a user (after deactivate/delete) so open tabs stop working.
export function disconnectUserSockets(io, userId) {
  try { io?.in(`user:${userId}`).disconnectSockets(true); } catch { /* best effort */ }
}

export function deactivateUser(userId) {
  db.prepare("UPDATE users SET account_status = 'deactivated' WHERE id = ?").run(userId);
  persistence.syncUsersSoon();
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
}

export function reactivateUser(userId) {
  db.prepare("UPDATE users SET account_status = 'active' WHERE id = ?").run(userId);
  persistence.syncUsersSoon();
  db.prepare("UPDATE account_deletions SET status = 'cancelled' WHERE user_id = ? AND status = 'pending'").run(userId);
}

// Permanently remove a user and everything that belongs to them.
export function deleteUserPermanently(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return false;

  // Remember uploaded files so they can be removed from disk after the DB commit.
  const files = new Set([user.avatar_photo_url, user.profile_video_url, user.profile_video_cover_url]);
  for (const r of db.prepare('SELECT image_url u FROM posts WHERE user_id = ?').all(userId)) files.add(r.u);
  for (const r of db.prepare('SELECT video_url u FROM reels WHERE user_id = ?').all(userId)) files.add(r.u);
  for (const r of db.prepare("SELECT content u FROM stories WHERE user_id = ? AND media_type != 'text'").all(userId)) files.add(r.u);

  const tx = db.transaction(() => {
    // Rows that reference users WITHOUT "ON DELETE CASCADE" would block the delete.
    db.prepare('DELETE FROM tournament_matches WHERE player_a_id = ? OR player_b_id = ? OR winner_id = ?').run(userId, userId, userId);
    db.prepare('DELETE FROM calls WHERE caller_id = ?').run(userId);
    // Messages by other people that reply to / forward this user's messages: keep theirs, drop the link.
    db.prepare('UPDATE messages SET reply_to_id = NULL WHERE reply_to_id IN (SELECT id FROM messages WHERE sender_id = ?)').run(userId);
    db.prepare('UPDATE messages SET forwarded_from_id = NULL WHERE forwarded_from_id IN (SELECT id FROM messages WHERE sender_id = ?)').run(userId);
    // Message requests pointing at conversations that will lose a participant stay valid;
    // requests the user sent/received cascade on their own.
    // 1:1 conversations only make sense with two people — remove them (messages cascade).
    const direct = db.prepare(`SELECT c.id FROM conversations c JOIN conversation_participants p ON p.conversation_id = c.id
                               WHERE c.type = 'direct' AND p.user_id = ?`).all(userId);
    for (const c of direct) {
      db.prepare('UPDATE message_requests SET conversation_id = NULL WHERE conversation_id = ?').run(c.id);
      db.prepare('DELETE FROM calls WHERE conversation_id = ?').run(c.id);
      db.prepare('DELETE FROM conversations WHERE id = ?').run(c.id);
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(userId); // everything else cascades
  });
  tx();

  for (const f of files) removeLocalUpload(f);
  persistence.removeUser(userId); // also drop the account from the MongoDB `users` collection
  return true;
}
