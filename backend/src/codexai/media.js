// Uploaded and generated media. Files live under the existing uploads folder (so the MongoDB upload mirror keeps them),
// each with a row in ai_media so history, deletion and ownership checks work.
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';

export const LIMITS = { image: 4 * 1024 * 1024, audio: 2 * 1024 * 1024, video: 30 * 1024 * 1024 };
const MAX_PER_USER = 200;

// Real file-type check from the bytes (a renamed file can't pass as something else).
export function sniff(buf) {
  const b = buf;
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (b[0] === 0x89 && b.subarray(1, 4).toString() === 'PNG') return { kind: 'image', mime: 'image/png', ext: 'png' };
  if (b.subarray(0, 4).toString() === 'GIF8') return { kind: 'image', mime: 'image/gif', ext: 'gif' };
  const riff = b.subarray(0, 4).toString() === 'RIFF';
  if (riff && b.subarray(8, 12).toString() === 'WEBP') return { kind: 'image', mime: 'image/webp', ext: 'webp' };
  if (riff && b.subarray(8, 12).toString() === 'WAVE') return { kind: 'audio', mime: 'audio/wav', ext: 'wav' };
  if (b.subarray(0, 4).toString() === 'OggS') return { kind: 'audio', mime: 'audio/ogg', ext: 'ogg' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'audio', mime: 'audio/webm', ext: 'webm' }; // Android/Chrome MediaRecorder
  if (b.subarray(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { kind: 'audio', mime: 'audio/mpeg', ext: 'mp3' };
  if (b.subarray(4, 8).toString() === 'ftyp') return { kind: 'mp4', mime: 'video/mp4', ext: 'mp4' };           // audio-only m4a (iPhone) and video both start like this
  return null;
}

export function createMedia({ db, uploadsRoot, publicPrefix = '/uploads' }) {
  const dirFor = (userId) => path.join(uploadsRoot, 'ai', String(userId).replace(/[^\w-]/g, '_'));
  const dto = (r) => ({ id: r.id, kind: r.kind, origin: r.origin, mime: r.mime, url: `${publicPrefix}/${r.rel_path}`, bytes: r.bytes, prompt: r.prompt || undefined, engine: r.engine || undefined, model: r.model || undefined, createdAt: r.created_at });

  function save({ userId, bytes, mime, kind, origin, prompt = null, engine = null, model = null, conversationId = null, ext }) {
    const id = uuid(); const dir = dirFor(userId); fs.mkdirSync(dir, { recursive: true });
    const file = `${id}.${ext}`; fs.writeFileSync(path.join(dir, file), bytes);
    const rel = `ai/${path.basename(dir)}/${file}`;
    db.prepare('INSERT INTO ai_media (id,user_id,kind,origin,mime,rel_path,bytes,prompt,engine,model,conversation_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, userId, kind, origin, mime, rel, bytes.length, prompt && String(prompt).slice(0, 500), engine, model, conversationId);
    // Keep each person's AI folder bounded: drop the oldest beyond MAX_PER_USER.
    const old = db.prepare('SELECT id FROM ai_media WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?').all(userId, MAX_PER_USER);
    for (const o of old) remove(userId, o.id);
    return dto(db.prepare('SELECT * FROM ai_media WHERE id = ?').get(id));
  }

  // A person's upload: validated by content, size and kind.
  function saveUpload({ userId, bytes, allow = ['image', 'audio'] }) {
    const t = sniff(bytes);
    if (!t) return { ok: false, error: 'That file type is not supported. Use a JPG, PNG, WebP or GIF picture, or a WAV/MP3/OGG/WebM/M4A recording.' };
    const kind = t.kind === 'mp4' ? 'audio' : t.kind;
    if (!allow.includes(kind)) return { ok: false, error: 'That kind of file is not accepted here.' };
    if (bytes.length > LIMITS[kind]) return { ok: false, error: `That ${kind} is too large (max ${Math.round(LIMITS[kind] / 1048576)} MB).` };
    return { ok: true, media: save({ userId, bytes, mime: t.kind === 'mp4' ? 'audio/mp4' : t.mime, kind, origin: 'upload', ext: t.kind === 'mp4' ? 'm4a' : t.ext }) };
  }

  const get = (userId, id) => { const r = db.prepare('SELECT * FROM ai_media WHERE id = ? AND user_id = ?').get(id, userId); return r ? { ...dto(r), relPath: r.rel_path } : null; };
  const read = (userId, id) => { const m = get(userId, id); if (!m) return null; try { return { ...m, bytes: fs.readFileSync(path.join(uploadsRoot, m.relPath)) }; } catch { return null; } };
  const list = (userId, { origin, limit = 60 } = {}) => db.prepare(`SELECT * FROM ai_media WHERE user_id = ? ${origin ? 'AND origin = ?' : ''} ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(...(origin ? [userId, origin, limit] : [userId, limit])).map(dto);
  function remove(userId, id) {
    const r = db.prepare('SELECT rel_path FROM ai_media WHERE id = ? AND user_id = ?').get(id, userId); if (!r) return false;
    try { fs.unlinkSync(path.join(uploadsRoot, r.rel_path)); } catch { /* already gone */ }
    return db.prepare('DELETE FROM ai_media WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  }
  const removeAll = (userId) => { for (const m of db.prepare('SELECT id FROM ai_media WHERE user_id = ?').all(userId)) remove(userId, m.id); };
  return { save, saveUpload, get, read, list, remove, removeAll };
}
