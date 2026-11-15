// CHEX 3D Scanning Studio — private storage + validation helpers.
// Project files live OUTSIDE UPLOADS_ROOT so the public /uploads static route can never serve them;
// they are only ever streamed through authenticated, ownership-checked routes in routes/scan3d.js.
// On hosts with an ephemeral disk set NEXA_SCAN_DIR to a persistent volume (e.g. /data/scan-private).
import fs from 'fs';
import path from 'path';
import { UPLOADS_ROOT } from '../uploads.js';

export const SCAN_ROOT = path.resolve(process.env.NEXA_SCAN_DIR || path.join(UPLOADS_ROOT, '..', 'scan-private'));
fs.mkdirSync(SCAN_ROOT, { recursive: true });

export const LIMITS = {
  modelBytes: 80 * 1024 * 1024,     // one GLB
  imageBytes: 25 * 1024 * 1024,     // one photo / frame (the browser resizes big originals first)
  maxImages: 80,
  minPhotogrammetryImages: 8,
  stateBytes: 1024 * 1024,          // parts / variants / history JSON
  nameChars: 80,
  activeJobsPerUser: 1,
  jobsPerDay: 20,
  projectsPerUser: 50,
};

export const projectDir = (id) => path.join(SCAN_ROOT, 'projects', id);
export const jobDir = (id) => path.join(SCAN_ROOT, 'jobs', id);

// Only ever resolve inside SCAN_ROOT (ids are uuids, but never trust a path component).
export function safeJoin(root, ...parts) {
  const full = path.resolve(root, ...parts);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('PATH_ESCAPE');
  return full;
}

/** Real file-type check from the first bytes (the browser's Content-Type is attacker-controlled). */
export function sniffImage(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const b = Buffer.alloc(12); fs.readSync(fd, b, 0, 12, 0);
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
    if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return '.png';
    if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return '.webp';
    return null;
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** A binary glTF starts with "glTF" + version 2 and declares its own total length. */
export function sniffGlb(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const b = Buffer.alloc(12); fs.readSync(fd, b, 0, 12, 0);
    if (b.toString('latin1', 0, 4) !== 'glTF' || b.readUInt32LE(4) !== 2) return false;
    return b.readUInt32LE(8) === fs.fstatSync(fd).size;
  } catch { return false; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

export const rm = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ } };

export const cleanName = (v, fallback = 'Untitled scan') => {
  const s = String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.nameChars);
  return s || fallback;
};

/**
 * The project "state" (part tree, transforms, materials, variants, version history) is plain JSON the
 * client owns. We only accept a bounded, JSON-serialisable object and never interpret it on the server.
 */
export function cleanState(input) {
  if (input === undefined || input === null) return { ok: true, json: null };
  let s = input;
  if (typeof s === 'string') { try { s = JSON.parse(s); } catch { return { ok: false, message: 'Project data is not valid JSON.' }; } }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, message: 'Project data must be an object.' };
  const json = JSON.stringify(s);
  if (Buffer.byteLength(json) > LIMITS.stateBytes) return { ok: false, message: 'Project data is too large (limit 1 MB). Delete old variants or versions.' };
  return { ok: true, json };
}
