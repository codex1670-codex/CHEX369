// Browser-side photo handling for the studio: decode, quality-check (sharpness / exposure / duplicates)
// and pull frames out of an orbit video. All maths lives in studioMath.js.
import { toGray, sharpness, exposure, averageHash, qualityVerdict, findDuplicates } from './studioMath.js';

export const PHOTO_TYPES = /^image\/(jpeg|png|webp)$/;
export const MAX_PHOTO_BYTES = 60 * 1024 * 1024;   // large originals are fine: they are resized before upload (see prepareForUpload)
export const MAX_FRAMES = 80;

export const isHeic = (f) => /\.(heic|heif)$/i.test(f.name || '') || /heic|heif/i.test(f.type || '');

export function checkPhotoFile(file) {
  if (isHeic(file)) return 'iPhone HEIC photos are not supported yet. In Settings → Camera → Formats choose “Most Compatible”, or share as JPG.';
  if (!PHOTO_TYPES.test(file.type)) return `“${(file.name || 'file').slice(0, 40)}” is not a JPG, PNG or WebP photo.`;
  if (file.size > MAX_PHOTO_BYTES) return `“${(file.name || 'photo').slice(0, 40)}” is larger than 60 MB.`;
  return null;
}

/** Decode + measure one photo/frame (Blob). Returns a plain record; the caller owns the object URL. */
export async function analysePhoto(blob, name = 'photo') {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.max(8, Math.round(bmp.width * k)); c.height = Math.max(8, Math.round(bmp.height * k));
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const g = toGray(data, c.width, c.height, 256);
  const sharp = sharpness(g.gray, g.w, g.h); const ex = exposure(g.gray); const hash = averageHash(g.gray, g.w, g.h);
  const rec = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, name, blob, url: URL.createObjectURL(blob), w: bmp.width, h: bmp.height, sharp, mean: ex.mean, hash, issues: qualityVerdict({ sharp, ...ex }), dup: false, keep: true };
  bmp.close?.(); return rec;
}

/** Re-flag duplicates across the whole set (call after adding/removing/reordering). Returns a new array. */
export function flagDuplicates(items) {
  const dup = new Set(findDuplicates(items.map((i) => i.hash)));
  return items.map((it, i) => ({ ...it, dup: dup.has(i) }));
}

/** Overall set report shown on the Reconstruct tab. */
export function setReport(items) {
  const used = items.filter((i) => i.keep);
  const blurry = used.filter((i) => i.issues.includes('blurry')).length;
  const exposureBad = used.filter((i) => i.issues.some((x) => x !== 'blurry')).length;
  const dups = used.filter((i) => i.dup).length;
  const sizes = new Set(used.map((i) => `${i.w}x${i.h}`));
  const warnings = [];
  if (used.length < 8) warnings.push(`Only ${used.length} photo(s): photogrammetry needs at least 8 (20–40 recommended).`);
  if (blurry) warnings.push(`${blurry} photo(s) look blurry.`);
  if (exposureBad) warnings.push(`${exposureBad} photo(s) are too dark or over-exposed.`);
  if (dups) warnings.push(`${dups} photo(s) are near-duplicates of another.`);
  if (sizes.size > 1) warnings.push('Photos have different sizes — use one camera and zoom level for best alignment.');
  return { total: items.length, used: used.length, blurry, exposureBad, dups, warnings };
}

/**
 * Pull `count` frames evenly out of a video, then the caller can drop blurry/duplicate ones.
 * Seeks (not plays) so it works on any browser-decodable video, and reports real progress.
 */
export async function extractFrames(file, { count = 40, onProgress, signal } = {}) {
  const url = URL.createObjectURL(file); const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('This browser cannot decode that video. Try MP4 (H.264) or WebM.')); });
    const dur = v.duration; if (!Number.isFinite(dur) || dur < 1) throw new Error('The video is too short or its length is unknown.');
    const n = Math.min(MAX_FRAMES, Math.max(8, count));
    const c = document.createElement('canvas'); const k = Math.min(1, 1920 / Math.max(v.videoWidth, v.videoHeight)); c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
    const ctx = c.getContext('2d'); const out = [];
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
      const t = Math.min(dur - 0.05, ((i + 0.5) / n) * dur);
      await new Promise((res, rej) => { v.onseeked = res; v.onerror = () => rej(new Error('Could not read a frame from the video.')); v.currentTime = t; });
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Could not save a video frame.');
      out.push(await analysePhoto(blob, `frame-${String(i + 1).padStart(2, '0')}.jpg`)); onProgress?.((i + 1) / n);
    }
    return out;
  } finally { URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); }
}

/** Frames worth sending: sharp, not duplicate. Falls back to everything if that would leave too few. */
export function pickBestFrames(items, minKeep = 12) {
  const good = items.map((i) => ({ ...i, keep: !i.issues.includes('blurry') && !i.dup }));
  return good.filter((i) => i.keep).length >= minKeep ? good : items.map((i) => ({ ...i, keep: !i.dup }));
}

/**
 * Make a big photo upload-friendly: longest side ≤ maxSide, re-encoded as JPEG. Photos that are already small
 * enough are sent untouched. 3200 px keeps plenty of detail for photogrammetry; the one-photo AI mode uses 1536 px.
 */
export async function prepareForUpload(blob, { maxSide = 3200, keepUnderBytes = 8 * 1024 * 1024 } = {}) {
  try {
    const bmp = await createImageBitmap(blob); const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (k === 1 && blob.size <= keepUnderBytes) { bmp.close?.(); return blob; }
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    return (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92))) || blob;
  } catch { return blob; }
}
