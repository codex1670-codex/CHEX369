// Memory AI — local database implementation (used when MongoDB isn't configured). Same interface as the MongoDB store.
import { v4 as uuid } from 'uuid';

const iso = () => new Date().toISOString();

export function createSqliteMemory(db) {
  const conv = (r) => r && ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at });
  const msg = (r) => ({ id: r.id, role: r.role, text: r.text, engine: r.engine || undefined, media: r.media ? JSON.parse(r.media) : [], error: !!r.error, createdAt: r.created_at });
  return {
    kind: 'sqlite',
    async status() { return { kind: 'sqlite', ok: true }; },
    async createConversation(userId, { title = 'New chat' } = {}) { const t = iso(); const id = uuid(); db.prepare('INSERT INTO ai_conversations (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)').run(id, userId, title.slice(0, 80), t, t); return { id, title: title.slice(0, 80), createdAt: t, updatedAt: t }; },
    async listConversations(userId, limit = 50) { return db.prepare('SELECT * FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?').all(userId, limit).map(conv); },
    async getConversation(userId, id) {
      const c = db.prepare('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?').get(id, userId); if (!c) return null;
      return { ...conv(c), messages: db.prepare('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at, rowid').all(id).map(msg) };
    },
    async appendMessage(userId, convId, { role, text, engine, media = [], error = false }) {
      const c = db.prepare('SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?').get(convId, userId); if (!c) return null;
      const id = uuid(); const t = iso();
      db.prepare('INSERT INTO ai_messages (id,conversation_id,user_id,role,text,engine,media,error,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, convId, userId, role, String(text).slice(0, 12000), engine || null, media.length ? JSON.stringify(media) : null, error ? 1 : 0, t);
      db.prepare('UPDATE ai_conversations SET updated_at = ? WHERE id = ?').run(t, convId);
      return id;
    },
    async recentMessages(userId, convId, n = 10) { return db.prepare('SELECT * FROM (SELECT *, rowid rid FROM ai_messages WHERE conversation_id = ? AND user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?) ORDER BY created_at, rid').all(convId, userId, n).map(msg); },
    async renameConversation(userId, id, title) { return db.prepare('UPDATE ai_conversations SET title = ? WHERE id = ? AND user_id = ?').run(String(title).slice(0, 80), id, userId).changes > 0; },
    async deleteConversation(userId, id) { db.prepare('DELETE FROM ai_messages WHERE conversation_id = ? AND user_id = ?').run(id, userId); return db.prepare('DELETE FROM ai_conversations WHERE id = ? AND user_id = ?').run(id, userId).changes > 0; },
    async listMemories(userId) { return db.prepare('SELECT id, text, source, created_at createdAt FROM ai_memories WHERE user_id = ? ORDER BY created_at DESC').all(userId); },
    async addMemory(userId, text, source = 'user') { const id = uuid(); const t = iso(); db.prepare('INSERT INTO ai_memories (id,user_id,text,source,created_at) VALUES (?,?,?,?,?)').run(id, userId, text, source, t); return { id, text, source, createdAt: t }; },
    async deleteMemory(userId, id) { return db.prepare('DELETE FROM ai_memories WHERE id = ? AND user_id = ?').run(id, userId).changes > 0; },
    async clearMemories(userId) { return db.prepare('DELETE FROM ai_memories WHERE user_id = ?').run(userId).changes; },
    async deleteAll(userId) { db.prepare('DELETE FROM ai_messages WHERE user_id = ?').run(userId); db.prepare('DELETE FROM ai_conversations WHERE user_id = ?').run(userId); db.prepare('DELETE FROM ai_memories WHERE user_id = ?').run(userId); },
  };
}
