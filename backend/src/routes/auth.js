import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import * as OTPAuth from 'otpauth';
import db from '../db.js';
import { ACCESS_SECRET, REFRESH_SECRET, ACCESS_TTL, REFRESH_TTL_DAYS, requireAuth } from '../middleware/auth.js';
import persistence from '../persistence.js';
import { deactivateUser, reactivateUser, deleteUserPermanently, disconnectUserSockets } from '../accountService.js';
import { broadcastAccountChange } from '../liveUpdates.js';
import { verifyMasterPassword1, verifyMasterPassword2, issueMasterChallenge, readMasterChallenge, masterLockedFor, masterFailed, masterSucceeded } from '../admin.js';

const router = Router();

const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AVATAR_COLORS = ['#7C5CFF', '#FF5C93', '#26E0C9', '#FFB84D', '#5CA8FF', '#B45CFF'];

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarColor: row.avatar_color,
    avatarPhotoUrl: row.avatar_photo_url,
    profileVideoUrl: row.profile_video_url,
    profileVideoCoverUrl: row.profile_video_cover_url,
    profileVideoMuted: !!row.profile_video_muted,
    displayMode: row.profile_display_mode,
    frame: row.profile_frame || null,
    showOnline: row.show_online !== 0,
    isAdmin: row.role === 'master',   // the permanent owner account (see admin.js)
    isPrivate: !!row.is_private,
    createdAt: row.created_at,
  };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function issueTokens(userId) {
  const accessToken = jwt.sign({ sub: userId }, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
  const refreshToken = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`
  ).run(uuid(), userId, hashToken(refreshToken), expiresAt);
  return { accessToken, refreshToken };
}

router.post('/signup', (req, res) => {
  const { username, email, password, displayName } = req.body || {};

  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: { code: 'INVALID_USERNAME', message: 'Username must be 3-20 characters: lowercase letters, numbers, "." or "_".' } });
  }
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: { code: 'INVALID_EMAIL', message: 'Enter a valid email address.' } });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: { code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters.' } });
  }
  const name = (displayName && String(displayName).trim()) || username;

  const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email.trim().toLowerCase());
  if (existing) {
    return res.status(409).json({ error: { code: 'ALREADY_EXISTS', message: 'That username or email is already in use.' } });
  }

  const id = uuid();
  const passwordHash = bcrypt.hashSync(password, 10);
  const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, display_name, avatar_color) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, username, email.trim().toLowerCase(), passwordHash, name, avatarColor);

  const tokens = issueTokens(id);
  persistence.syncUsersSoon(); // new account appears in the MongoDB `users` collection
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.status(201).json({ user: publicUser(user), ...tokens });
});

router.post('/login', (req, res) => {
  const { identifier, password, totpCode } = req.body || {};
  if (typeof identifier !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Enter your username/email and password.' } });
  }
  const id = identifier.trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE lower(username) = ? OR lower(email) = ?').get(id, id);
  const genericError = { error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect username/email or password.' } };
  // Unknown / permanently deleted account: same answer as a wrong password (nothing leaked).
  if (!user || user.account_status === 'deleted' || user.role === 'system' || user.private_owner_id) return res.status(401).json(genericError);

  if (user.role === 'master') {
    // Step 1 of 2. A wrong password looks exactly like any other failed login; 5 misses lock the IP for 15 minutes.
    const ip = req.ip || 'unknown';
    if (masterLockedFor(ip)) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' } });
    if (!verifyMasterPassword1(password)) { masterFailed(ip); return res.status(401).json(genericError); }
    return res.status(200).json({ requiresPassword2: true, challenge: issueMasterChallenge(user.id, ip) });
  } else {
    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) return res.status(401).json(genericError);
  }

  if (user.totp_enabled && user.role !== 'master') {
    if (!totpCode) {
      return res.status(200).json({ requires2FA: true, message: 'Enter your 6-digit authenticator code.' });
    }
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(user.totp_secret), digits: 6, period: 30 });
    const delta = totp.validate({ token: String(totpCode).trim(), window: 1 });
    if (delta === null) {
      return res.status(401).json({ error: { code: 'INVALID_2FA', message: 'That code is incorrect or expired.' } });
    }
  }

  // Deactivation is temporary: the right username + password simply opens the same account again.
  let reactivated = false;
  if (user.account_status === 'deactivated') {
    reactivateUser(user.id);
    user.account_status = 'active';
    reactivated = true;
  }

  const tokens = issueTokens(user.id);
  if (reactivated) broadcastAccountChange(req.app.get('io'), user.id, 'active');
  res.json({ user: publicUser(user), ...tokens, reactivated });
});

// Master login, step 2 of 2: needs the challenge from step 1 plus the second password.
router.post('/login/verify', (req, res) => {
  const { challenge, password2 } = req.body || {};
  const genericError = { error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect username/email or password.' } };
  const ip = req.ip || 'unknown';
  if (masterLockedFor(ip)) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' } });
  const masterId = readMasterChallenge(challenge, ip);
  if (!masterId || typeof password2 !== 'string') return res.status(401).json(genericError);
  if (!verifyMasterPassword2(password2)) { masterFailed(ip); return res.status(401).json(genericError); }
  masterSucceeded(ip);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(masterId);
  const tokens = issueTokens(user.id);
  res.json({ user: publicUser(user), ...tokens, reactivated: false });
});

router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body || {};
  if (typeof refreshToken !== 'string') {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing refresh token.' } });
  }
  const tokenHash = hashToken(refreshToken);
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash);
  if (!row || row.revoked || new Date(row.expires_at) < new Date()) {
    return res.status(401).json({ error: { code: 'INVALID_REFRESH', message: 'Session expired. Please log in again.' } });
  }
  const owner = db.prepare('SELECT account_status FROM users WHERE id = ?').get(row.user_id);
  if (!owner || owner.account_status !== 'active') {
    return res.status(401).json({ error: { code: 'INVALID_REFRESH', message: 'Session expired. Please log in again.' } });
  }
  // rotate: revoke old, issue new
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(row.id);
  const tokens = issueTokens(row.user_id);
  res.json(tokens);
});

router.post('/logout', requireAuth, (req, res) => {
  const { refreshToken } = req.body || {};
  if (typeof refreshToken === 'string') {
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ? AND user_id = ?')
      .run(hashToken(refreshToken), req.userId);
  } else {
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(req.userId);
  }
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
  res.json({ user: publicUser(user) });
});

// ---- 2FA (TOTP) ----

// The master account's login is fixed (two passwords): it can't be locked, deactivated, deleted or re-secured from the app.
const notForMaster = (req, res, next) => {
  if (db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'master'").get(req.userId)) {
    return res.status(403).json({ error: { code: 'MASTER_PROTECTED', message: 'The master account is permanent and cannot be changed this way.' } });
  }
  next();
};

router.post('/2fa/setup', requireAuth, notForMaster, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({ issuer: 'NEXA', label: user.username, secret, digits: 6, period: 30 });
  // Stored only once /enable confirms the user's authenticator actually has it —
  // until then it's held in the (unauthenticated-by-itself) response, not activated.
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, req.userId);
  res.json({ secret: secret.base32, otpauthUrl: totp.toString() });
});

router.post('/2fa/enable', requireAuth, notForMaster, (req, res) => {
  const { totpCode } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user.totp_secret) return res.status(400).json({ error: { code: 'NO_SETUP', message: 'Call /2fa/setup first.' } });
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(user.totp_secret), digits: 6, period: 30 });
  if (totp.validate({ token: String(totpCode || '').trim(), window: 1 }) === null) {
    return res.status(401).json({ error: { code: 'INVALID_2FA', message: 'That code is incorrect or expired.' } });
  }
  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(req.userId);
  res.json({ ok: true, enabled: true });
});

router.post('/2fa/disable', requireAuth, (req, res) => {
  const { password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect password.' } });
  }
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(req.userId);
  res.json({ ok: true, enabled: false });
});

// ---- Account deactivation / deletion ----
// Both need the account password, so a stray click (or a stale tab) can never do either.

function checkPassword(req, res) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } }); return null; }
  if (!bcrypt.compareSync(String((req.body || {}).password || ''), user.password_hash)) {
    res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect password.' } });
    return null;
  }
  return user;
}

// TEMPORARY: hide the account. Logging in again with the same username/email + password reactivates it.
router.post('/deactivate', requireAuth, notForMaster, (req, res) => {
  if (!checkPassword(req, res)) return;
  deactivateUser(req.userId);
  disconnectUserSockets(req.app.get('io'), req.userId);
  broadcastAccountChange(req.app.get('io'), req.userId, 'deactivated');
  res.json({ ok: true, status: 'deactivated', message: 'Your account is deactivated. Log in again with the same username and password to reactivate it.' });
});

// PERMANENT: only when the user explicitly confirms (password + typing DELETE). Happens immediately.
router.post('/delete-account', requireAuth, notForMaster, (req, res) => {
  const { confirm } = req.body || {};
  if (String(confirm || '').trim().toUpperCase() !== 'DELETE') {
    return res.status(400).json({ error: { code: 'CONFIRM_REQUIRED', message: 'Type DELETE to confirm.' } });
  }
  if (!checkPassword(req, res)) return;
  deleteUserPermanently(req.userId);
  disconnectUserSockets(req.app.get('io'), req.userId);
  broadcastAccountChange(req.app.get('io'), req.userId, 'deleted');
  res.json({ ok: true, status: 'deleted', message: 'Your account has been permanently deleted.' });
});

export { publicUser };
export default router;
