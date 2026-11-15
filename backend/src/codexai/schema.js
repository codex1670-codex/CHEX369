// Tables owned by CODEX AI. Created idempotently on boot (they ride along in the existing SQLite → MongoDB snapshots).
export function ensureAiSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, engine TEXT NOT NULL, provider TEXT NOT NULL, model TEXT,
      status TEXT NOT NULL CHECK (status IN ('ok','error','blocked')), units REAL NOT NULL DEFAULT 0, ms INTEGER, error_code TEXT,
      day TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE INDEX IF NOT EXISTS idx_ai_usage_day ON ai_usage(day, engine);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id, day, engine);
    CREATE TABLE IF NOT EXISTS ai_media (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('image','audio','video')), origin TEXT NOT NULL CHECK (origin IN ('upload','generated')),
      mime TEXT NOT NULL, rel_path TEXT NOT NULL, bytes INTEGER NOT NULL, prompt TEXT, engine TEXT, model TEXT, conversation_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE INDEX IF NOT EXISTS idx_ai_media_user ON ai_media(user_id, created_at);
    CREATE TABLE IF NOT EXISTS ai_conversations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_ai_conv_user ON ai_conversations(user_id, updated_at);
    CREATE TABLE IF NOT EXISTS ai_messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, engine TEXT, media TEXT, error INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_ai_msg_conv ON ai_messages(conversation_id, created_at);
    CREATE TABLE IF NOT EXISTS ai_memories (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_ai_mem_user ON ai_memories(user_id, created_at);
  `);
}
