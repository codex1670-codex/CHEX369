import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import persistence from './persistence.js';
import { seedGameCatalog } from './gameCatalog.js';
import { seedAppCatalog } from './appCatalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.NEXA_DB_PATH || path.join(__dirname, '..', 'nexa.db');

// With MONGODB_URI set, bring the database back from MongoDB first (no-op otherwise).
await persistence.restoreDatabase(DB_PATH);

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);
// One-time tidy-up for accounts that already have more than 100 notifications (the trigger handles new ones).
db.exec(`DELETE FROM notifications WHERE id IN (
  SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY recipient_id ORDER BY created_at DESC, rowid DESC) rn FROM notifications) WHERE rn > 100
)`);

// Make sure the Game Store catalog exists on every boot (fresh deploys start empty).
seedGameCatalog(db);

// CREATE TABLE IF NOT EXISTS above is a no-op against a notes table that already existed
// before the song-attachment feature — this backfills those columns on an existing db
// file so upgrading doesn't require deleting nexa.db. Safe to run every boot: each ALTER
// is skipped once the column is present.
const noteColumns = db.prepare("PRAGMA table_info(notes)").all().map(c => c.name);
for (const [col, def] of [
  ['song_id', 'TEXT'], ['song_title', 'TEXT'], ['song_artist', 'TEXT'], ['song_url', 'TEXT'],
]) {
  if (!noteColumns.includes(col)) db.exec(`ALTER TABLE notes ADD COLUMN ${col} ${def}`);
}

// Notes repair. Databases made by older versions (e.g. the one restored from MongoDB on Render) can
// have a notes table with no UNIQUE(user_id), no edited_at column, or an old audience CHECK. Sharing a
// note then crashed with HTTP 500 ("ON CONFLICT clause does not match…", "no such column: edited_at").
// SQLite can't alter those in place, so rebuild the table once, keeping each person's newest note.
// Safe to run every boot: it does nothing when the table is already correct.
{
  const cols = db.prepare('PRAGMA table_info(notes)').all().map(c => c.name);
  const notesSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notes'").get()?.sql || '';
  const uniqueUserId = db.prepare('PRAGMA index_list(notes)').all().some(ix => ix.unique
    && (() => { const c = db.prepare(`PRAGMA index_info("${ix.name}")`).all(); return c.length === 1 && c[0].name === 'user_id'; })());
  const wanted = ['id', 'user_id', 'text', 'emoji', 'mood', 'audience', 'song_id', 'song_title', 'song_artist', 'song_url', 'created_at', 'edited_at', 'expires_at'];
  const needsRebuild = notesSql && (!uniqueUserId || wanted.some(c => !cols.includes(c)) || !notesSql.includes('no_one'));
  if (needsRebuild) {
    const has = (c, fallback = 'NULL') => (cols.includes(c) ? c : fallback);
    db.pragma('foreign_keys = OFF');
    try {
      db.exec(`
        BEGIN;
        DROP TABLE IF EXISTS notes_new;
        CREATE TABLE notes_new (
          id          TEXT PRIMARY KEY,
          user_id     TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          text        TEXT NOT NULL DEFAULT '',
          emoji       TEXT,
          mood        TEXT,
          audience    TEXT NOT NULL DEFAULT 'followers' CHECK (audience IN ('everyone','followers','close_friends','no_one')),
          song_id     TEXT,
          song_title  TEXT,
          song_artist TEXT,
          song_url    TEXT,
          created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          edited_at   TEXT,
          expires_at  TEXT NOT NULL
        );
        INSERT INTO notes_new (id, user_id, text, emoji, mood, audience, song_id, song_title, song_artist, song_url, created_at, edited_at, expires_at)
          SELECT id, user_id, COALESCE(${has('text', "''")}, ''), ${has('emoji')}, ${has('mood')},
                 CASE WHEN ${has('audience', "'followers'")} IN ('everyone','followers','close_friends','no_one') THEN ${has('audience', "'followers'")} ELSE 'followers' END,
                 ${has('song_id')}, ${has('song_title')}, ${has('song_artist')}, ${has('song_url')},
                 COALESCE(${has('created_at')}, strftime('%Y-%m-%dT%H:%M:%fZ','now')), ${has('edited_at')},
                 COALESCE(${has('expires_at')}, strftime('%Y-%m-%dT%H:%M:%fZ','now','+24 hours'))
          FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY ${has('created_at', 'rowid')} DESC, rowid DESC) AS rn FROM notes)
          WHERE rn = 1 AND user_id IN (SELECT id FROM users);
        DROP TABLE notes;
        ALTER TABLE notes_new RENAME TO notes;
        DELETE FROM note_likes WHERE note_id NOT IN (SELECT id FROM notes);
        COMMIT;
      `);
      console.log('[nexa] repaired the notes table (older database layout)');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* nothing open */ }
      console.error('[nexa] could not repair the notes table:', err);
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
}

// Migration 1: older databases were created with a codex_actions CHECK that only allowed
// four statuses, but the Codex route also audits pending_confirmation / pending_preview /
// pending_disambiguation — on those databases the INSERT would violate the CHECK. SQLite
// can't alter a CHECK in place, so rebuild the table once (rows preserved).
const codexSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'codex_actions'").get()?.sql || '';
if (codexSql && !codexSql.includes('pending_preview')) {
  db.exec(`
    BEGIN;
    ALTER TABLE codex_actions RENAME TO codex_actions_old;
    CREATE TABLE codex_actions (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      input_text    TEXT NOT NULL,
      action_name   TEXT,
      action_input  TEXT,
      status        TEXT NOT NULL CHECK (status IN ('executed','failed','no_match','ai_unavailable','pending_confirmation','pending_disambiguation','pending_preview','needs_clarification')),
      result_summary TEXT,
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO codex_actions SELECT id, user_id, input_text, action_name, action_input, status, result_summary, created_at FROM codex_actions_old;
    DROP TABLE codex_actions_old;
    CREATE INDEX IF NOT EXISTS idx_codex_actions_user_time ON codex_actions(user_id, created_at);
    COMMIT;
  `);
}

// Migration 2: copy nicknames saved in the legacy `nicknames` table into the spec's
// `profile_nicknames` table (INSERT OR IGNORE, so this is safe to run on every boot).
db.exec(`
  INSERT OR IGNORE INTO profile_nicknames (id, owner_user_id, nickname, normalized_nickname, target_profile_id, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), owner_id, nickname, lower(trim(nickname)), target_id, created_at, updated_at FROM nicknames
`);

// Migration 3 (media upload + editing): add the new columns to databases created before
// posts/stories/reels supported device uploads and non-destructive edit settings.
const addColumnIfMissing = (table, col, def) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
// App catalog: how to launch the installed phone app (Android package / iOS URL scheme).
addColumnIfMissing('app_registry', 'android_package', 'TEXT');
addColumnIfMissing('app_registry', 'ios_scheme', 'TEXT');
seedAppCatalog(db);
addColumnIfMissing('posts', 'media_type', "TEXT CHECK (media_type IN ('image','video'))");
addColumnIfMissing('posts', 'edits', 'TEXT');
addColumnIfMissing('reels', 'edits', 'TEXT');
// Post audience: 'public' (everyone) or 'followers' (only people who follow the author).
// Existing posts stay public. Online status: people can hide it from Settings.
addColumnIfMissing('posts', 'audience', "TEXT NOT NULL DEFAULT 'public' CHECK (audience IN ('public','followers'))");
// CHEX Coins: fingerprints for repeated / copied posts, and whether a post counts toward the monthly goal.
addColumnIfMissing('posts', 'caption_hash', 'TEXT');
addColumnIfMissing('posts', 'media_hash', 'TEXT');
addColumnIfMissing('posts', 'coin_eligible', 'INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('posts', 'coin_skip_reason', 'TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_posts_caption_hash ON posts(caption_hash) WHERE caption_hash IS NOT NULL');
db.exec('CREATE INDEX IF NOT EXISTS idx_posts_media_hash ON posts(media_hash) WHERE media_hash IS NOT NULL');
addColumnIfMissing('reels', 'media_hash', 'TEXT');
addColumnIfMissing('reels', 'coin_eligible', 'INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('reels', 'coin_skip_reason', 'TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_reels_media_hash ON reels(media_hash) WHERE media_hash IS NOT NULL');
addColumnIfMissing('users', 'show_online', 'INTEGER NOT NULL DEFAULT 1');
// 'user' (everyone), 'master' (the permanent owner account "sanjiv", see admin.js) or 'system' (the "CHEX Reports" inbox bot).
addColumnIfMissing('users', 'role', "TEXT NOT NULL DEFAULT 'user'");
// Premium profile frame (id from coins.js PROFILE_FRAMES); only settable after the frames unlock.
addColumnIfMissing('users', 'profile_frame', 'TEXT');
// Account privacy: 0 = public (everyone can see followers/following), 1 = private (only people
// this user follows can see them). Existing accounts stay public.
addColumnIfMissing('users', 'is_private', 'INTEGER NOT NULL DEFAULT 0');
// Chat attachments (photo / video up to 500MB): a message keeps type 'text' (the CHECK can't be
// altered in place) and carries the attachment in these columns instead.
addColumnIfMissing('messages', 'media_url', 'TEXT');
addColumnIfMissing('messages', 'media_kind', "TEXT");
addColumnIfMissing('messages', 'media_seconds', 'INTEGER'); // voice-note length
addColumnIfMissing('messages', 'media_name', 'TEXT');
addColumnIfMissing('messages', 'media_bytes', 'INTEGER');
// Shared post / reel inside a chat: the message keeps a short text and points at the item here.
addColumnIfMissing('messages', 'shared_kind', 'TEXT');
addColumnIfMissing('messages', 'shared_id', 'TEXT');
// Chat controls (per person, never visible to the others in the chat):
//  muted      = no alerts for new messages in this chat
//  cleared_at = "Delete chat": messages up to this moment are hidden for me only
addColumnIfMissing('conversation_participants', 'muted', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('conversation_participants', 'cleared_at', 'TEXT');
// "Delete for me" on a single message: hidden for that person, still visible to everyone else.
db.exec(`CREATE TABLE IF NOT EXISTS message_hidden (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (message_id, user_id)
)`);
// Profile Studio: theme / background / dim / blur chosen in the studio, stored as JSON so
// every viewer of a profile sees the same look.
addColumnIfMissing('users', 'profile_studio', 'TEXT');

// Migration 4: stories.media_type used to be CHECK IN ('text','image'); video stories need
// 'video'. SQLite can't alter a CHECK, so rebuild the table once. foreign_keys must be OFF
// for the rebuild — otherwise DROP TABLE would cascade-delete every row in story_views.
const storiesSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'stories'").get()?.sql || '';
if (storiesSql && !storiesSql.includes("'video'")) {
  const old = db.prepare('PRAGMA table_info(stories)').all().map(c => c.name);
  const keep = ['id', 'user_id', 'media_type', 'content', 'background', 'audience', 'created_at', 'expires_at', 'deleted_at']
    .filter(c => old.includes(c)).join(', ');
  db.pragma('foreign_keys = OFF');
  try {
    // Order matters: create the new table under a temp name, copy, DROP the old one, then
    // rename the NEW table into place. (Renaming the old table away first would make SQLite
    // rewrite story_views' foreign key to point at the renamed — then dropped — table.)
    db.exec(`
      BEGIN;
      CREATE TABLE stories_new (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_type  TEXT NOT NULL DEFAULT 'text' CHECK (media_type IN ('text','image','video')),
        content     TEXT NOT NULL,
        caption     TEXT,
        edits       TEXT,
        background  TEXT NOT NULL DEFAULT '#7C5CFF',
        audience    TEXT NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone','followers','close_friends')),
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        expires_at  TEXT NOT NULL,
        deleted_at  TEXT
      );
      INSERT INTO stories_new (${keep}) SELECT ${keep} FROM stories;
      DROP TABLE stories;
      ALTER TABLE stories_new RENAME TO stories;
      CREATE INDEX IF NOT EXISTS idx_stories_user_time ON stories(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_stories_expiry ON stories(expires_at);
      COMMIT;
    `);
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* no open transaction */ }
    throw err;
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

// Migration 5: the old "14-day grace period" scheduled deletions. Accounts must never be
// deleted automatically, so any still-pending schedule is cancelled. Those accounts stay
// deactivated, and logging in with the same username + password reopens them.
db.exec("UPDATE account_deletions SET status = 'cancelled' WHERE status = 'pending'");

// Migration 6 (+7): life_items.kind gained 'alarm', then 'learn' (CHEX learn progress). Databases made earlier have a
// CHECK without them, and SQLite can't alter a CHECK in place, so rebuild the table once (rows kept).
// foreign_keys is off only for the swap.
const lifeSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'life_items'").get()?.sql || '';
if (lifeSql && !lifeSql.includes("'learn'")) {
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      BEGIN;
      CREATE TABLE life_items_new (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN ('planner','timetable','assignment','habit','focus','alarm','learn')),
        data       TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      INSERT INTO life_items_new (id, user_id, kind, data, created_at, updated_at) SELECT id, user_id, kind, data, created_at, updated_at FROM life_items;
      DROP TABLE life_items;
      ALTER TABLE life_items_new RENAME TO life_items;
      CREATE INDEX IF NOT EXISTS idx_life_user_kind ON life_items(user_id, kind);
      COMMIT;
    `);
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* no open transaction */ }
    throw err;
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

// Every "author"/"actor"/"user" summary sent to the client (post authors, commenters,
// notification actors, message participants, game/tournament players, story/note
// authors, callers, search results, etc.) should carry the same profile-media fields
// as the full profile, so that changing your avatar photo or profile video shows up
// everywhere your identity appears in the app — not just on your own Profile page.
// SQL snippet to append to any `SELECT ... FROM users u` (or aliased join) to pull in
// the columns toPublicUser() below expects.
export const USER_MEDIA_COLUMNS_SQL = 'avatar_photo_url, profile_video_url, profile_video_cover_url, profile_video_muted, profile_display_mode, profile_frame';

// Builds the small "who is this" object used throughout the app (as opposed to
// profileFor() in routes/users.js, which builds the full profile page payload).
// Expects a row with: id, username, display_name, avatar_color, and — whenever the
// query selected them — avatar_photo_url, profile_video_url, profile_video_cover_url,
// profile_video_muted, profile_display_mode. Missing media columns just fall back to
// the plain color avatar, so this is safe to call even before every query is updated.
export function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    avatarPhotoUrl: row.avatar_photo_url || null,
    profileVideoUrl: row.profile_video_url || null,
    profileVideoCoverUrl: row.profile_video_cover_url || null,
    profileVideoMuted: !!row.profile_video_muted,
    displayMode: row.profile_display_mode || 'color',
    frame: row.profile_frame || null,
  };
}

export default db;
