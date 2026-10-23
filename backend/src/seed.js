import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import db from './db.js';

const users = [
  { username: 'rahul', email: 'rahul@example.com', displayName: 'Rahul' },
  { username: 'priya', email: 'priya@example.com', displayName: 'Priya' },
  { username: 'arjun', email: 'arjun@example.com', displayName: 'Arjun' },
];

const passwordHash = bcrypt.hashSync('password123', 10);
const ids = {};

for (const u of users) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(u.username);
  if (existing) { ids[u.username] = existing.id; continue; }
  const id = uuid();
  ids[u.username] = id;
  db.prepare('INSERT INTO users (id, username, email, password_hash, display_name, bio) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, u.username, u.email, passwordHash, u.displayName, `Hey, I'm ${u.displayName} 👋`);
  console.log(`Created @${u.username} (password: password123)`);
}

// a couple of posts + a follow relationship so the demo isn't empty
const postCount = db.prepare('SELECT COUNT(*) c FROM posts').get().c;
if (postCount === 0) {
  db.prepare('INSERT INTO posts (id, user_id, caption) VALUES (?, ?, ?)').run(uuid(), ids.rahul, 'First post on NEXA 🚀');
  db.prepare('INSERT INTO posts (id, user_id, caption) VALUES (?, ?, ?)').run(uuid(), ids.priya, 'Cosmic purple theme looks amazing tonight ✨');
  db.prepare('INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)').run(ids.priya, ids.rahul);
  db.prepare('INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)').run(ids.arjun, ids.rahul);
  console.log('Seeded demo posts and follow relationships.');
}

// The game catalog is now seeded automatically on every server boot (see gameCatalog.js).
console.log('Done.');
