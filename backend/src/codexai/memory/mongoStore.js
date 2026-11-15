// Memory AI — MongoDB implementation: conversation history + user-approved long-term memory, in the same MongoDB database
// CHEX already uses for durable storage (collections codex_conversations / codex_messages / codex_memories).
// `db` is any object with .collection(name) returning a MongoDB-style collection (the real driver, or a test fake).
import { v4 as uuid } from 'uuid';

const iso = () => new Date().toISOString();
const strip = ({ _id, userId, ...rest }) => rest;

export function createMongoMemory(db) {
  const conversations = db.collection('codex_conversations');
  const messages = db.collection('codex_messages');
  const memories = db.collection('codex_memories');
  let indexed;
  const ensure = () => indexed ||= Promise.all([
    conversations.createIndex({ userId: 1, updatedAt: -1 }), messages.createIndex({ conversationId: 1, createdAt: 1 }), memories.createIndex({ userId: 1, createdAt: -1 }),
  ]).catch(() => {});
  const conv = (d) => d && ({ id: d._id, title: d.title, createdAt: d.createdAt, updatedAt: d.updatedAt });
  const msg = (d) => ({ id: d._id, role: d.role, text: d.text, engine: d.engine || undefined, media: d.media || [], error: !!d.error, createdAt: d.createdAt });

  return {
    kind: 'mongodb',
    async status() { try { await ensure(); await conversations.findOne({ _id: '__ping__' }); return { kind: 'mongodb', ok: true }; } catch { return { kind: 'mongodb', ok: false }; } },
    async createConversation(userId, { title = 'New chat' } = {}) { await ensure(); const t = iso(); const d = { _id: uuid(), userId, title: title.slice(0, 80), createdAt: t, updatedAt: t }; await conversations.insertOne(d); return conv(d); },
    async listConversations(userId, limit = 50) { await ensure(); return (await conversations.find({ userId }).sort({ updatedAt: -1 }).limit(limit).toArray()).map(conv); },
    async getConversation(userId, id) {
      const c = await conversations.findOne({ _id: id, userId }); if (!c) return null;
      return { ...conv(c), messages: (await messages.find({ conversationId: id, userId }).sort({ createdAt: 1 }).toArray()).map(msg) };
    },
    async appendMessage(userId, convId, { role, text, engine, media = [], error = false }) {
      const c = await conversations.findOne({ _id: convId, userId }); if (!c) return null;
      const t = iso(); const id = uuid();
      await messages.insertOne({ _id: id, conversationId: convId, userId, role, text: String(text).slice(0, 12000), engine: engine || null, media, error: !!error, createdAt: t });
      await conversations.updateOne({ _id: convId, userId }, { $set: { updatedAt: t } });
      return id;
    },
    async recentMessages(userId, convId, n = 10) { return (await messages.find({ conversationId: convId, userId }).sort({ createdAt: -1 }).limit(n).toArray()).reverse().map(msg); },
    async renameConversation(userId, id, title) { const r = await conversations.updateOne({ _id: id, userId }, { $set: { title: String(title).slice(0, 80) } }); return (r.matchedCount ?? r.modifiedCount ?? 0) > 0; },
    async deleteConversation(userId, id) { await messages.deleteMany({ conversationId: id, userId }); const r = await conversations.deleteOne({ _id: id, userId }); return (r.deletedCount ?? 0) > 0; },
    async listMemories(userId) { return (await memories.find({ userId }).sort({ createdAt: -1 }).toArray()).map((d) => ({ id: d._id, text: d.text, source: d.source, createdAt: d.createdAt })); },
    async addMemory(userId, text, source = 'user') { const d = { _id: uuid(), userId, text, source, createdAt: iso() }; await memories.insertOne(d); return { id: d._id, text, source, createdAt: d.createdAt }; },
    async deleteMemory(userId, id) { const r = await memories.deleteOne({ _id: id, userId }); return (r.deletedCount ?? 0) > 0; },
    async clearMemories(userId) { const r = await memories.deleteMany({ userId }); return r.deletedCount ?? 0; },
    async deleteAll(userId) { await messages.deleteMany({ userId }); await conversations.deleteMany({ userId }); await memories.deleteMany({ userId }); },
  };
}

// Connects with the official driver. Kept separate so tests never need a real database.
export async function connectMongo({ uri, dbName }) {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, appName: 'chex-codex-ai' });
  await client.connect();
  return { db: client.db(dbName), close: () => client.close() };
}
