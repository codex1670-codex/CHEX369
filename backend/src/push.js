// Web Push: shows a system notification on the phone's home screen / notification shade, even when CHEX is closed.
// VAPID keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY if set; otherwise they are derived from the
// server secret, so they stay identical across restarts and redeploys (existing subscriptions keep working).
import crypto from 'crypto';
import webpush from 'web-push';
import db from './db.js';
import { ACCESS_SECRET } from './middleware/auth.js';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function loadKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const priv = crypto.createHash('sha256').update(`chex-vapid:${ACCESS_SECRET}`).digest();
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(priv);
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(priv) };
}

const keys = loadKeys();
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@chex.app', keys.publicKey, keys.privateKey);

export const vapidPublicKey = keys.publicKey;

const MSG_TYPES = ['message', 'message_request'];
const VERB = {
  like: 'liked your post', comment: 'commented on your post', follow: 'started following you',
  message_request: 'sent you a message request', message: 'sent you a message',
  note_reply: 'replied to your note', reel_like: 'liked your reel', reel_comment: 'commented on your reel',
  game_invite: 'invited you to a game', mention: 'mentioned you', missed_call: 'tried to call you',
  story_view: 'viewed your story',
};

// Unread notifications the person has not yet been pushed about, newest first.
const pushedIds = new Set();
function pendingFor(userId) {
  return db.prepare(`
    SELECT n.id, n.type, u.username, u.display_name FROM notifications n
    JOIN users u ON u.id = n.actor_id
    WHERE n.recipient_id = ? AND n.read = 0 ORDER BY n.created_at DESC LIMIT 20
  `).all(userId).filter(r => !pushedIds.has(r.id));
}

export async function sendPushToUser(userId) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  if (!subs.length) return;
  const fresh = pendingFor(userId);
  if (!fresh.length) return;
  fresh.forEach(r => { pushedIds.add(r.id); if (pushedIds.size > 5000) pushedIds.delete(pushedIds.values().next().value); });

  const names = [...new Set(fresh.map(r => r.username))];
  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '');
  const allMessages = fresh.every(r => MSG_TYPES.includes(r.type));
  const first = fresh[0];
  const payload = JSON.stringify(fresh.length === 1
    ? { title: first.display_name || first.username, body: `${first.username} ${VERB[first.type] || 'sent you a notification'}`, tag: `chex-${first.type}`, url: MSG_TYPES.includes(first.type) ? '/?open=messages' : '/?open=notifications' }
    : { title: allMessages ? 'New messages' : 'New notifications', body: `${allMessages ? 'Message' : 'Notification'} from ${shown}`, tag: allMessages ? 'chex-messages' : 'chex-notifications', url: allMessages ? '/?open=messages' : '/?open=notifications' });

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(s.endpoint); // uninstalled / revoked
    }
  }));
}

// Called whenever a realtime "something new" event goes to a user. Debounced, and delayed slightly because
// some routes emit the event just before the notification row is written.
const timers = new Map();
export function schedulePush(userId) {
  if (timers.has(userId)) return;
  timers.set(userId, setTimeout(() => {
    timers.delete(userId);
    sendPushToUser(userId).catch(() => {});
  }, 600));
}

// Wraps io.to(...) so every `notification:new` / `message_request:new` sent to a user also triggers a push.
export function attachPush(io) {
  const origTo = io.to.bind(io);
  io.to = (room) => {
    const op = origTo(room);
    const m = typeof room === 'string' && room.match(/^user:(.+)$/);
    if (!m) return op;
    const origEmit = op.emit.bind(op);
    op.emit = (ev, ...args) => {
      if (ev === 'notification:new' || ev === 'message_request:new') schedulePush(m[1]);
      return origEmit(ev, ...args);
    };
    return op;
  };
}
