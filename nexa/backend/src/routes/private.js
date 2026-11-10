import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { requireAuth, ACCESS_SECRET } from '../middleware/auth.js';
import { publicUser } from './auth.js';
import { isShadow, shadowFor, movedChat } from '../space.js';
import { mediaMiddleware, UPLOADS_ROOT } from '../uploads.js';
import persistence from '../persistence.js';

const router = Router();
const USERNAME_RE = /^[a-z0-9._]{3,20}$/;
const SESSION_TTL = '12h';
const MAX_FAILS = 5;
const LOCK_MINUTES = 10;
const AVATAR_COLORS = ['#7C5CFF', '#FF5C93', '#2DD4BF', '#F59E0B', '#38BDF8', '#A3E635'];
const err = (res, status, code, message) => res.status(status).json({ error: { code, message } });

function sessionFor(shadowRow) {
  const token = jwt.sign({ sub: shadowRow.id, space: 'private' }, ACCESS_SECRET, { expiresIn: SESSION_TTL });
  return { token, expiresInSeconds: 12 * 60 * 60, user: { ...publicUser(shadowRow), isPrivate: true } };
}

// The real account that owns whichever identity is calling (a normal user, or their private one).
function ownerIdOf(userId) {
  const r = db.prepare('SELECT private_owner_id p FROM users WHERE id = ?').get(userId);
  return r?.p || userId;
}

function requireShadow(req, res, next) {
  if (!isShadow(req.userId)) return err(res, 403, 'LOCKED', 'Open your private space first.');
  next();
}

// Does this person have a private space yet? (Never reveals anything else.)
router.get('/status', requireAuth, (req, res) => {
  const space = shadowFor(ownerIdOf(req.userId));
  res.json({ exists: !!space, username: space?.username || null });
});

// First time: choose a private username, name and password. Creates the hidden second profile.
router.post('/setup', requireAuth, (req, res) => {
  if (isShadow(req.userId)) return err(res, 403, 'FORBIDDEN', 'Already inside the private space.');
  if (shadowFor(req.userId)) return err(res, 409, 'ALREADY_EXISTS', 'Your private space already exists.');
  const { password, username, displayName } = req.body || {};
  if (typeof password !== 'string' || password.length < 6) return err(res, 400, 'WEAK_PASSWORD', 'The private password must be at least 6 characters.');
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) return err(res, 400, 'INVALID_USERNAME', 'Private username: 3-20 characters, lowercase letters, numbers, "." or "_".');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return err(res, 409, 'ALREADY_EXISTS', 'That username is already taken.');

  const id = uuid();
  // The hidden identity can never log in the normal way: its password is random and unknown to everyone.
  const unusable = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 8);
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  db.transaction(() => {
    db.prepare('INSERT INTO users (id, username, email, password_hash, display_name, avatar_color, private_owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, username, `private-${id}@private.invalid`, unusable, String(displayName || username).trim().slice(0, 40) || username, color, req.userId);
    db.prepare('INSERT INTO private_spaces (owner_id, shadow_id, password_hash) VALUES (?, ?, ?)').run(req.userId, id, bcrypt.hashSync(password, 10));
  })();
  persistence.syncUsersSoon();
  res.status(201).json(sessionFor(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
});

// Unlock with the private password. Wrong guesses are limited: 5 misses lock it for 10 minutes.
router.post('/enter', requireAuth, (req, res) => {
  const ownerId = ownerIdOf(req.userId);
  const ps = db.prepare('SELECT * FROM private_spaces WHERE owner_id = ?').get(ownerId);
  if (!ps) return err(res, 404, 'NO_SPACE', 'Set up your private space first.');
  if (ps.locked_until && new Date(ps.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(ps.locked_until) - new Date()) / 60000);
    return err(res, 429, 'LOCKED_OUT', `Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
  const { password } = req.body || {};
  if (typeof password !== 'string' || !bcrypt.compareSync(password, ps.password_hash)) {
    const fails = ps.failed_count + 1;
    if (fails >= MAX_FAILS) db.prepare("UPDATE private_spaces SET failed_count = 0, locked_until = ? WHERE owner_id = ?").run(new Date(Date.now() + LOCK_MINUTES * 60000).toISOString(), ownerId);
    else db.prepare('UPDATE private_spaces SET failed_count = ? WHERE owner_id = ?').run(fails, ownerId);
    return err(res, 401, 'WRONG_PASSWORD', fails >= MAX_FAILS ? `Too many wrong passwords. Locked for ${LOCK_MINUTES} minutes.` : 'Wrong password.');
  }
  db.prepare('UPDATE private_spaces SET failed_count = 0, locked_until = NULL WHERE owner_id = ?').run(ownerId);
  res.json(sessionFor(db.prepare('SELECT * FROM users WHERE id = ?').get(ps.shadow_id)));
});

router.post('/password', requireAuth, (req, res) => {
  const ownerId = ownerIdOf(req.userId);
  const ps = db.prepare('SELECT * FROM private_spaces WHERE owner_id = ?').get(ownerId);
  if (!ps) return err(res, 404, 'NO_SPACE', 'Set up your private space first.');
  const { current, next } = req.body || {};
  if (typeof current !== 'string' || !bcrypt.compareSync(current, ps.password_hash)) return err(res, 401, 'WRONG_PASSWORD', 'Current password is wrong.');
  if (typeof next !== 'string' || next.length < 6) return err(res, 400, 'WEAK_PASSWORD', 'The new password must be at least 6 characters.');
  db.prepare('UPDATE private_spaces SET password_hash = ? WHERE owner_id = ?').run(bcrypt.hashSync(next, 10), ownerId);
  res.json({ ok: true });
});

// ---------------- Chats moved to the second space ----------------
// From the normal Messages page the owner can move a 1-to-1 chat to the second space: it leaves the normal
// list and appears only in the second space. The contact keeps the same username there but is shown under a
// second-space display name that must differ from their real display name.
const NAME_MAX = 40;

function ownerChat(req, res, conversationId) {
  const ownerId = ownerIdOf(req.userId);
  const convo = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
  const mine = convo && db.prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?').get(convo.id, ownerId);
  if (!mine) { err(res, 404, 'NOT_FOUND', 'Chat not found.'); return null; }
  const others = db.prepare('SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ?').all(convo.id, ownerId);
  if (convo.type !== 'direct' || others.length !== 1) { err(res, 400, 'INVALID_ACTION', 'Only one-to-one chats can be moved to the second space.'); return null; }
  return { ownerId, convo, contact: db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(others[0].user_id) };
}

function cleanSpaceName(res, value, contact) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX) : '';
  if (!name) { err(res, 400, 'INVALID_INPUT', 'Type a display name for the second space.'); return null; }
  if (name.toLowerCase() === String(contact.display_name || '').trim().toLowerCase()) {
    err(res, 400, 'SAME_NAME', 'The second-space display name must be different from their normal display name.');
    return null;
  }
  return name;
}

const notifyChatMoved = (req, ownerId, shadowId, conversationId) => {
  const io = req.app.get('io');
  [ownerId, shadowId].forEach(id => io?.to(`user:${id}`).emit('conversation:changed', { conversationId }));
};

router.post('/chat/move', requireAuth, (req, res) => {
  if (isShadow(req.userId)) return err(res, 403, 'FORBIDDEN', 'Move chats from the normal Messages page.');
  const space = shadowFor(req.userId);
  if (!space) return err(res, 409, 'NO_SPACE', 'Create your second space first (＋ menu → Private space).');
  const ctx = ownerChat(req, res, req.body?.conversationId); if (!ctx) return;
  const name = cleanSpaceName(res, req.body?.displayName, ctx.contact); if (!name) return;
  db.prepare(`INSERT INTO space_chats (owner_id, conversation_id, contact_id, display_name) VALUES (?, ?, ?, ?)
    ON CONFLICT(owner_id, conversation_id) DO UPDATE SET display_name = excluded.display_name`).run(ctx.ownerId, ctx.convo.id, ctx.contact.id, name);
  notifyChatMoved(req, ctx.ownerId, space.shadow_id, ctx.convo.id);
  res.json({ ok: true, username: ctx.contact.username, displayName: name });
});

// Rename the second-space display name of a moved chat (from inside the second space).
router.patch('/chat/:conversationId', requireAuth, requireShadow, (req, res) => {
  const ctx = ownerChat(req, res, req.params.conversationId); if (!ctx) return;
  if (!movedChat(ctx.ownerId, ctx.convo.id)) return err(res, 404, 'NOT_FOUND', 'This chat is not in the second space.');
  const name = cleanSpaceName(res, req.body?.displayName, ctx.contact); if (!name) return;
  db.prepare('UPDATE space_chats SET display_name = ? WHERE owner_id = ? AND conversation_id = ?').run(name, ctx.ownerId, ctx.convo.id);
  notifyChatMoved(req, ctx.ownerId, req.userId, ctx.convo.id);
  res.json({ ok: true, displayName: name });
});

// Move the chat back to the normal Messages page.
router.delete('/chat/:conversationId', requireAuth, requireShadow, (req, res) => {
  const ctx = ownerChat(req, res, req.params.conversationId); if (!ctx) return;
  if (!movedChat(ctx.ownerId, ctx.convo.id)) return err(res, 404, 'NOT_FOUND', 'This chat is not in the second space.');
  db.prepare('DELETE FROM space_chats WHERE owner_id = ? AND conversation_id = ?').run(ctx.ownerId, ctx.convo.id);
  notifyChatMoved(req, ctx.ownerId, req.userId, ctx.convo.id);
  res.json({ ok: true });
});

// ---------------- Private gallery ----------------
const galleryDTO = (r) => ({ id: r.id, kind: r.kind, url: r.url, name: r.name, source: r.source, createdAt: r.created_at });

router.get('/gallery', requireAuth, requireShadow, (req, res) => {
  const rows = db.prepare('SELECT * FROM private_gallery WHERE shadow_id = ? ORDER BY created_at DESC, rowid DESC').all(req.userId);
  res.json({ items: rows.map(galleryDTO) });
});

// Add a photo/video straight from the device.
router.post('/gallery/upload', requireAuth, requireShadow, mediaMiddleware('private', ['image', 'video']), (req, res) => {
  const id = uuid();
  db.prepare('INSERT INTO private_gallery (id, shadow_id, kind, url, name, source) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.userId, req.media.kind, req.media.url, String(req.file?.originalname || '').slice(0, 120), 'upload');
  res.status(201).json({ item: galleryDTO(db.prepare('SELECT * FROM private_gallery WHERE id = ?').get(id)) });
});

// "Save to private gallery" from anywhere in the app (posts, reels, stories, chat media). Works from the
// normal side WITHOUT opening the space (write-only), so nothing private is exposed. The file is COPIED, so
// it stays even if the original post / message is deleted later.
router.post('/gallery/save', requireAuth, (req, res) => {
  const space = shadowFor(ownerIdOf(req.userId));
  if (!space) return err(res, 409, 'NO_SPACE', 'Set up your private space first (menu → Private space).');
  const { url, kind, name, source } = req.body || {};
  if (typeof url !== 'string' || !url || url.length > 1000) return err(res, 400, 'INVALID_INPUT', 'Nothing to save.');
  const type = kind === 'video' ? 'video' : 'image';
  let stored = url;
  if (url.startsWith('/uploads/')) {
    const src = path.resolve(UPLOADS_ROOT, url.slice('/uploads/'.length));
    if (!src.startsWith(UPLOADS_ROOT + path.sep) || !fs.existsSync(src)) return err(res, 404, 'NOT_FOUND', 'That file is no longer available.');
    const dir = path.join(UPLOADS_ROOT, 'private');
    fs.mkdirSync(dir, { recursive: true });
    const file = `${uuid()}${path.extname(src)}`;
    fs.copyFileSync(src, path.join(dir, file));
    stored = `/uploads/private/${file}`;
  } else if (!/^\/[a-z0-9._\-/]+$/i.test(url) && !/^https?:\/\//i.test(url)) {
    return err(res, 400, 'INVALID_INPUT', 'Cannot save that.');
  }
  const id = uuid();
  db.prepare('INSERT INTO private_gallery (id, shadow_id, kind, url, name, source) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, space.id, type, stored, String(name || '').slice(0, 120), String(source || 'app').slice(0, 30));
  res.status(201).json({ ok: true });
});

router.delete('/gallery/:id', requireAuth, requireShadow, (req, res) => {
  const row = db.prepare('SELECT * FROM private_gallery WHERE id = ? AND shadow_id = ?').get(req.params.id, req.userId);
  if (!row) return err(res, 404, 'NOT_FOUND', 'Item not found.');
  db.prepare('DELETE FROM private_gallery WHERE id = ?').run(row.id);
  if (row.url.startsWith('/uploads/private/')) {
    const full = path.resolve(UPLOADS_ROOT, row.url.slice('/uploads/'.length));
    if (full.startsWith(UPLOADS_ROOT + path.sep)) { fs.unlink(full, () => {}); persistence.queueRemoval(row.url); }
  }
  res.json({ ok: true });
});

export default router;
