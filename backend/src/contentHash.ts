// Fingerprints used to spot repeated / copied posts. No database access here (db.js imports this).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOADS_ROOT } from './uploads.js';

const sha = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

/** Same words ⇒ same text, whatever the case, spacing, punctuation, emoji or links. */
export const normCaption = (c: unknown): string =>
  String(c || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export const captionHash = (c: unknown): string | null => {
  const n = normCaption(c);
  return n ? sha(n) : null;
};

function localPath(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return null;
  const full = path.resolve(UPLOADS_ROOT, url.slice('/uploads/'.length));
  return full.startsWith(UPLOADS_ROOT + path.sep) ? full : null;
}

/** Hash of the picture/video bytes (or of the address, for an external image link). */
export function mediaHashSync(url: unknown): string | null {
  if (!url || typeof url !== 'string') return null;
  const file = localPath(url);
  if (!file) return sha(`url:${url.trim()}`);
  try {
    const h = crypto.createHash('sha256');
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.allocUnsafe(1 << 20);
    try {
      for (let n: number; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n));
    } finally { fs.closeSync(fd); }
    return h.digest('hex');
  } catch { return null; }
}

export function mediaHashAsync(url: unknown): Promise<string | null> {
  const file = localPath(url);
  if (!file) return Promise.resolve(url ? sha(`url:${String(url).trim()}`) : null);
  return new Promise((resolve) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', d => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', () => resolve(null));
  });
}
