// The permanent MASTER account ("sanjiv") and everything that only it may do.
//
//  - It always exists: seedMasterAccount() runs on every boot and re-creates / repairs it.
//  - Logging in needs BOTH passwords (see routes/auth.js). Only bcrypt hashes live here, never the
//    plain passwords. To change them, set NEXA_MASTER_HASH_1 / NEXA_MASTER_HASH_2 (bcrypt hashes) in the
//    environment, e.g.  node -e "console.log(require('bcryptjs').hashSync('new password', 12))"
//  - It cannot be deactivated, deleted, renamed or given 2FA by anyone (see guards in routes/auth.js).
//  - It has unlimited CHEX coins and every store item (see coins.js).
//  - Reports from users arrive in its DM inbox from the "CHEX Reports" system account.
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import db from './db.js';
import persistence from './persistence.js';
import { sendDirectMessage } from './routes/messages.js';

export const MASTER_USERNAME = 'sanjiv';
// bcrypt(cost 12) of the two master passwords.
const MASTER_HASH_1 = process.env.NEXA_MASTER_HASH_1 || '$2a$12$UVvrRVqJ2OBHCuanW9xBneNRYygX.ftk2HiAhRorHi.VPQAfceRIS';
const MASTER_HASH_2 = process.env.NEXA_MASTER_HASH_2 || '$2a$12$1AAk29mJtOkNj8evVI9Q8.6Hr0.kiyoEzijAEhiR9cZh5ko6VAw.e';

export const isMaster = (userId) => !!userId && db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'master'").get(userId) !== undefined;
export const masterRow = () => db.prepare("SELECT * FROM users WHERE role = 'master'").get();

// A phone keyboard often adds a trailing space (autocomplete) — accept the password as typed OR with outer spaces trimmed.
const matches = (plain, hash) => {
  const p = String(plain ?? '');
  const a = bcrypt.compareSync(p, hash);
  return a || (p !== p.trim() && bcrypt.compareSync(p.trim(), hash));
};
// Both passwords must match. Always runs both comparisons so timing does not reveal which one was wrong.
export function checkMasterPasswords(p1, p2) {
  const a = matches(p1, MASTER_HASH_1);
  const b = matches(p2, MASTER_HASH_2);
  return a && b;
}
export const checkMasterPassword1 = (p1) => matches(p1, MASTER_HASH_1);

// ---- Brute-force lock for the master login: 5 wrong tries from one IP => locked 15 minutes. ----
const fails = new Map(); // ip -> { n, until }
const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;
export function masterLockedFor(ip) {
  const f = fails.get(ip);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
export function masterFailed(ip) {
  const f = fails.get(ip) || { n: 0, until: 0 };
  f.n = f.until && f.until <= Date.now() ? 1 : f.n + 1;
  if (f.n >= MAX_FAILS) { f.until = Date.now() + LOCK_MS; f.n = 0; }
  fails.set(ip, f);
}
export const masterSucceeded = (ip) => fails.delete(ip);

const AVATAR_COLORS = ['#7C5CFF', '#FF5C93', '#26E0C9', '#FFB84D', '#5CA8FF', '#B45CFF'];

export function seedMasterAccount() {
  let row = db.prepare('SELECT * FROM users WHERE lower(username) = ?').get(MASTER_USERNAME);
  if (!row) {
    const emailTaken = (e) => db.prepare('SELECT 1 FROM users WHERE email = ?').get(e);
    const email = emailTaken('sanjiv@chex.local') ? `sanjiv.${uuid().slice(0, 6)}@chex.local` : 'sanjiv@chex.local';
    db.prepare("INSERT INTO users (id, username, email, password_hash, display_name, avatar_color, role) VALUES (?, ?, ?, ?, ?, ?, 'master')")
      .run(uuid(), MASTER_USERNAME, email, MASTER_HASH_1, 'Sanjiv', AVATAR_COLORS[0]);
    console.log('[nexa] master account "sanjiv" created');
  } else {
    // The name is reserved for the owner: if somebody had registered it, it becomes the master account.
    if (row.password_hash !== MASTER_HASH_1) db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(row.id);
    db.prepare("UPDATE users SET role = 'master', password_hash = ?, account_status = 'active', totp_enabled = 0, totp_secret = NULL WHERE id = ?")
      .run(MASTER_HASH_1, row.id);
  }
  const master = db.prepare('SELECT id FROM users WHERE lower(username) = ?').get(MASTER_USERNAME);
  db.prepare("UPDATE users SET role = 'user' WHERE role = 'master' AND id != ?").run(master.id);
  ensureReportsBot();
  persistence.syncUsersSoon();
  return master.id;
}

// "CHEX Reports": a system account nobody can log in to. It only exists to DM reports to the master.
function ensureReportsBot() {
  let bot = db.prepare("SELECT * FROM users WHERE role = 'system'").get();
  if (bot) return bot;
  for (const name of ['chex.reports', 'chex.reports.system', `chex.reports.${uuid().slice(0, 6)}`]) {
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(name)) continue;
    db.prepare("INSERT INTO users (id, username, email, password_hash, display_name, avatar_color, role) VALUES (?, ?, ?, ?, ?, ?, 'system')")
      .run(uuid(), name, `${name}@chex.local`, bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10), 'CHEX Reports 🚩', '#FF5C93');
    break;
  }
  return db.prepare("SELECT * FROM users WHERE role = 'system'").get();
}

const directKey = (a, b) => [a, b].sort().join(':');
function reportsConversation(botId, masterId) {
  let convo = db.prepare('SELECT * FROM conversations WHERE direct_key = ?').get(directKey(botId, masterId));
  if (!convo) {
    const id = uuid();
    db.transaction(() => {
      db.prepare("INSERT INTO conversations (id, type, direct_key) VALUES (?, 'direct', ?)").run(id, directKey(botId, masterId));
      // joined_at is back-dated a little so the very first report is always counted as unread (it can land in the same millisecond).
      const ins = db.prepare("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 seconds'))");
      ins.run(id, botId); ins.run(id, masterId);
    })();
    convo = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  }
  return convo;
}

const clip = (s, n = 140) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

// What a report points at, in plain words (and who wrote it). `exists` is false once it was removed.
export function describeTarget(type, id) {
  const q = (sql) => db.prepare(sql).get(id);
  const by = (uid) => (uid ? db.prepare('SELECT id, username FROM users WHERE id = ?').get(uid) : null);
  let row, text = '', owner = null, exists = false, extra = {};
  switch (type) {
    case 'post': row = q('SELECT * FROM posts WHERE id = ?'); if (row) { exists = !row.deleted_at; text = row.caption; owner = by(row.user_id); extra = { mediaUrl: row.image_url, mediaType: row.media_type }; } break;
    case 'reel': row = q('SELECT * FROM reels WHERE id = ?'); if (row) { exists = !row.deleted_at; text = row.caption; owner = by(row.user_id); extra = { mediaUrl: row.video_url, mediaType: 'video' }; } break;
    case 'comment': row = q('SELECT * FROM comments WHERE id = ?'); if (row) { exists = !row.deleted_at; text = row.text; owner = by(row.user_id); } break;
    case 'reel_comment': row = q('SELECT * FROM reel_comments WHERE id = ?'); if (row) { exists = !row.deleted_at; text = row.text; owner = by(row.user_id); } break;
    case 'story': row = q('SELECT * FROM stories WHERE id = ?'); if (row) { exists = !row.deleted_at; text = row.media_type === 'text' ? row.content : (row.caption || `(${row.media_type} story)`); owner = by(row.user_id); } break;
    case 'note': row = q('SELECT * FROM notes WHERE id = ?'); if (row) { exists = true; text = row.text; owner = by(row.user_id); } break;
    case 'message': row = q('SELECT * FROM messages WHERE id = ?'); if (row) { exists = !row.deleted_at; text = row.content; owner = by(row.sender_id); } break;
    case 'user': row = q('SELECT id, username, display_name, bio, account_status FROM users WHERE id = ?'); if (row) { exists = row.account_status !== 'deleted'; text = `@${row.username} — ${row.display_name}${row.bio ? ` — ${row.bio}` : ''}`; owner = { id: row.id, username: row.username }; } break;
    default: break;
  }
  return { type, id, exists, text: clip(text, 300), owner, ...extra };
}

// Called whenever someone reports something: drops a card into the master's DM inbox (and pings it live).
export function notifyMasterOfReport(reportId, io) {
  try {
    const rep = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
    const master = masterRow(), bot = ensureReportsBot();
    if (!rep || !master || !bot) return;
    const reporter = db.prepare('SELECT username FROM users WHERE id = ?').get(rep.reporter_id);
    const t = describeTarget(rep.target_type, rep.target_id);
    const label = rep.target_type.replace('_', ' ');
    const lines = [
      `🚩 New report · ${label}`,
      `Reported by @${reporter?.username || 'unknown'}${t.owner ? ` · content by @${t.owner.username}` : ''}`,
      `Reason: ${clip(rep.reason, 300)}`,
      t.text ? `Content: “${clip(t.text, 200)}”` : (t.exists ? '' : 'Content: already removed'),
      `Report ID: ${rep.id.slice(0, 8)} — open 🛡️ Admin → Reports to delete it, dismiss it or remove the user.`,
    ].filter(Boolean);
    const convo = reportsConversation(bot.id, master.id);
    sendDirectMessage({
      fromUserId: bot.id, conversationId: convo.id, text: lines.join('\n'), io,
      share: ['post', 'reel'].includes(rep.target_type) && t.exists ? { kind: rep.target_type, id: rep.target_id } : null,
    });
  } catch (e) { console.error('could not DM the report to the master account', e); }
}

// ---- Deleting content as the master ----
const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export function removeContent(type, id) {
  const run = (sql) => db.prepare(sql).run(id).changes > 0;
  switch (type) {
    case 'post': return db.transaction(() => {
      const ok = run(`UPDATE posts SET deleted_at = ${now} WHERE id = ? AND deleted_at IS NULL`);
      db.prepare('DELETE FROM saved_posts WHERE post_id = ?').run(id);
      db.prepare("DELETE FROM notifications WHERE target_id = ? AND type IN ('like','comment','mention')").run(id);
      return ok;
    })();
    case 'reel': return run(`UPDATE reels SET deleted_at = ${now} WHERE id = ? AND deleted_at IS NULL`);
    case 'comment': return run(`UPDATE comments SET deleted_at = ${now} WHERE id = ? AND deleted_at IS NULL`);
    case 'reel_comment': return run(`UPDATE reel_comments SET deleted_at = ${now} WHERE id = ? AND deleted_at IS NULL`);
    case 'story': return run(`UPDATE stories SET deleted_at = ${now} WHERE id = ? AND deleted_at IS NULL`);
    case 'message': return run(`UPDATE messages SET deleted_at = ${now} WHERE id = ? AND deleted_at IS NULL`);
    case 'note': return run('DELETE FROM notes WHERE id = ?');
    default: return false;
  }
}
