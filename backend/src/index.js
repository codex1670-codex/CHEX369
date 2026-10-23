import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import postRoutes from './routes/posts.js';
import feedRoutes from './routes/feed.js';
import messageRoutes from './routes/messages.js';
import notificationRoutes from './routes/notifications.js';
import noteRoutes from './routes/notes.js';
import storyRoutes from './routes/stories.js';
import reelRoutes from './routes/reels.js';
import gameRoutes from './routes/games.js';
import tournamentRoutes from './routes/tournaments.js';
import reportRoutes from './routes/reports.js';
import searchRoutes from './routes/search.js';
import appRoutes from './routes/apps.js';
import callRoutes from './routes/calls.js';
import codexRoutes from './routes/codex.js';
import pushRoutes from './routes/push.js';
import { attachPush } from './push.js';
import { registerGameHandlers } from './gameEngine.js';
import { registerCallHandlers } from './callEngine.js';
import { ACCESS_SECRET, REFRESH_SECRET } from './middleware/auth.js';
import { UPLOADS_ROOT } from './uploads.js';
import { db } from './db.js';
import persistence from './persistence.js';
import { markConnected, markDisconnected, onlineIdsFor, showsOnline } from './presence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_PROD = process.env.NODE_ENV === 'production';

// Refuse to boot in production with the built-in dev secrets: anyone could forge tokens.
if (IS_PROD && (ACCESS_SECRET.includes('change-me') || REFRESH_SECRET.includes('change-me'))) {
  console.error('[nexa] Refusing to start: set NEXA_ACCESS_SECRET and NEXA_REFRESH_SECRET in production.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1); // correct client IPs for rate limiting behind a reverse proxy
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});
// CORS_ORIGIN="https://chex-1.onrender.com,https://example.com" restricts browsers to those sites.
// (Unset = any origin, which is fine because auth uses Bearer tokens, not cookies.)
const ORIGINS = (process.env.CORS_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
app.use(cors(ORIGINS.length ? { origin: ORIGINS } : undefined));
app.use(express.json({ limit: '2mb' }));

// Uploaded reel video files (see uploads.js) — served back as plain static files, outside
// the /api namespace, so <video src="/uploads/reels/...mp4"> just works like any hosted URL.
app.use('/uploads', persistence.uploadsMiddleware(), express.static(UPLOADS_ROOT));

// Rate limiting: tighter on auth (brute-force protection), looser but present on general API.
// Only credential-guessing endpoints are tightly limited (and only failed attempts count), so
// /me, /refresh and /logout — called on every page load — can't lock out people sharing an IP.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' } } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } } });

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'nexa-backend', time: new Date().toISOString() }));
// Readiness: proves the database actually answers (used by Docker/orchestrator health checks).
app.get('/api/ready', (_req, res) => {
  try { db.prepare('SELECT 1').get(); res.json({ ready: true, uptime: Math.round(process.uptime()) }); }
  catch { res.status(503).json({ ready: false }); }
});

const AUTH_GUARDED = ['/login', '/signup', '/deactivate', '/delete-account', '/2fa/disable'];
app.use('/api/auth', (req, res, next) => (AUTH_GUARDED.includes(req.path) ? authLimiter(req, res, next) : next()), authRoutes);
app.use('/api/users', apiLimiter, userRoutes);
app.use('/api/posts', apiLimiter, postRoutes);
app.use('/api/feed', apiLimiter, feedRoutes);
app.use('/api/messages', apiLimiter, messageRoutes);
app.use('/api/notifications', apiLimiter, notificationRoutes);
app.use('/api/push', apiLimiter, pushRoutes);
app.use('/api/notes', apiLimiter, noteRoutes);
app.use('/api/stories', apiLimiter, storyRoutes);
app.use('/api/reels', apiLimiter, reelRoutes);
app.use('/api/games', apiLimiter, gameRoutes);
app.use('/api/tournaments', apiLimiter, tournamentRoutes);
app.use('/api/reports', apiLimiter, reportRoutes);
app.use('/api/search', apiLimiter, searchRoutes);
app.use('/api/apps', apiLimiter, appRoutes);
app.use('/api/calls', apiLimiter, callRoutes);
const codexLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many Codex requests. Please slow down.' } } });
// The on-screen agent makes several cheap calls per command (resolve + report per step, plus a few
// retries while a page loads). Those get their own, higher ceiling; /act (which can call the LLM)
// keeps the tight one.
const codexUiLimiter = rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many Codex requests. Please slow down.' } } });
app.use('/api/codex', (req, res, next) => (req.path.startsWith('/ui-') ? codexUiLimiter : codexLimiter)(req, res, next), codexRoutes);

// 404 for unknown API routes
app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }));

// Serve the built web app from the same server (one process, one port) when frontend/dist exists.
const DIST = process.env.NEXA_STATIC_DIR || path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(path.join(DIST, 'index.html'))) {
  app.use(express.static(DIST, {
    index: false,
    setHeaders: (res, file) => {
      // hashed assets are immutable; the service worker and HTML must always revalidate
      if (/[\\/]assets[\\/]/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get(/^\/(?!api|uploads|socket\.io).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
  console.log('[nexa] serving web app from', DIST);
}

// Centralized error handler: never leak stack traces to clients.
app.use((err, _req, res, _next) => {
  console.error('[nexa] unhandled error:', err);
  res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' } });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ORIGINS.length ? ORIGINS : '*' } });
app.set('io', io);
attachPush(io); // also send a phone/home-screen push for new notifications & messages

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const payload = jwt.verify(token, ACCESS_SECRET);
    const u = db.prepare('SELECT account_status FROM users WHERE id = ?').get(payload.sub);
    if (!u || u.account_status !== 'active') return next(new Error('unauthorized'));
    socket.userId = payload.sub;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  socket.join(`user:${socket.userId}`);
  // Presence: tell everyone when this person comes online / goes offline (unless they hide it).
  if (markConnected(socket.userId) && showsOnline(socket.userId)) io.emit('presence:update', { userId: socket.userId, online: true });
  socket.on('presence:list', (cb) => { if (typeof cb === 'function') cb({ online: onlineIdsFor(socket.userId) }); });
  socket.on('disconnect', () => {
    if (markDisconnected(socket.userId) && showsOnline(socket.userId)) io.emit('presence:update', { userId: socket.userId, online: false });
  });
  socket.on('typing', ({ conversationId }) => {
    socket.to(`conversation:${conversationId}`).emit('typing', { userId: socket.userId, conversationId });
  });
  socket.on('conversation:join', ({ conversationId }) => {
    socket.join(`conversation:${conversationId}`);
  });
  registerGameHandlers(io, socket);
  registerCallHandlers(io, socket);
});

const PORT = process.env.PORT || 4000;
// Large post/story videos can take longer than Node's default 5-minute request timeout.
server.requestTimeout = 0;
if (IS_PROD && process.env.RENDER && !persistence.enabled && !(process.env.NEXA_DB_PATH || '').startsWith('/data')) {
  console.warn('[nexa] WARNING: on Render with no MONGODB_URI and no persistent disk — every restart/redeploy erases all accounts. Set MONGODB_URI (see README).');
}
server.listen(PORT, () => {
  console.log(`NEXA backend listening on http://localhost:${PORT}`);
  persistence.start({ getDb: () => db, uploadsRoot: UPLOADS_ROOT });
});

// Housekeeping: expired / revoked refresh tokens would otherwise pile up forever.
const purgeTokens = () => {
  try { db.prepare("DELETE FROM refresh_tokens WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day') OR (revoked = 1 AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 day'))").run(); }
  catch (err) { console.warn('[nexa] token purge failed:', err.message); }
};
purgeTokens();
setInterval(purgeTokens, 6 * 60 * 60 * 1000).unref();

// Abandoned lobbies (created, never started, not part of a tournament) would pile up forever.
const purgeStaleRooms = () => {
  try {
    db.prepare(`DELETE FROM game_rooms WHERE status = 'waiting'
      AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 hours')
      AND id NOT IN (SELECT room_id FROM tournament_matches)`).run();
  } catch (err) { console.warn('[nexa] room purge failed:', err.message); }
};
purgeStaleRooms();
setInterval(purgeStaleRooms, 60 * 60 * 1000).unref();

// One bad socket event or promise must not take the whole server (and everyone on it) down.
process.on('uncaughtException', (err) => console.error('[nexa] uncaughtException:', err));
process.on('unhandledRejection', (err) => console.error('[nexa] unhandledRejection:', err));

// Graceful shutdown: stop accepting connections, close sockets and the database cleanly.
function shutdown(signal) {
  console.log(`[nexa] ${signal} received, shutting down…`);
  io.close();
  // Save everything to MongoDB one last time, then close the database and exit.
  server.close(async () => {
    await persistence.flush();
    try { db.close(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 25000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
