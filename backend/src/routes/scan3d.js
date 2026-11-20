// CHEX 3D Scanning Studio API: projects (private, owner-only), model files, reconstruction jobs.
// Publishing to the feed goes through POST /api/posts/upload (field `modelProjectId`) so coins,
// mentions, audience rules and live updates all behave exactly like every other post.
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ownsItem, STUDIO_ITEM, PRICES } from '../coins.js';
import {
  SCAN_ROOT, LIMITS, projectDir, jobDir, safeJoin, sniffImage, sniffGlb, rm, cleanName, cleanState,
} from '../scan3d/store.js';
import { capabilities, runColmap, runTripo, STAGES, SPEEDS, stageStart, stageWeight } from '../scan3d/providers.js';

const router = Router();
router.use(requireAuth);
// The 3D Scanning Studio is a premium unlock (CHEX Coins store). Quick 3D from a photo is separate and stays free.
router.use((req, res, next) => {
  if (ownsItem(req.userId, STUDIO_ITEM)) return next();
  res.status(403).json({ error: { code: 'STUDIO_LOCKED', message: `Unlock the 3D Scanning Studio in the CHEX Coins store (${PRICES.studio.toLocaleString()} coins) to use it.` } });
});

const err = (res, status, code, message) => res.status(status).json({ error: { code, message } });
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error('[scan3d]', e); err(res, 500, 'SCAN_FAILED', 'Something went wrong. Please try again.'); });
const nowIso = () => new Date().toISOString();

const projectDTO = (p, { state = false } = {}) => ({
  id: p.id, name: p.name, status: p.status,
  hasModel: !!p.model_bytes, hasOriginal: !!p.original_bytes, hasThumb: !!p.thumb_bytes,
  modelBytes: p.model_bytes || 0, originalBytes: p.original_bytes || 0,
  createdAt: p.created_at, updatedAt: p.updated_at,
  ...(state ? { state: p.state_json ? JSON.parse(p.state_json) : null } : {}),
});
const getProject = (id, userId) => db.prepare('SELECT * FROM scan_projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(id, userId);
const mustProject = (req, res) => { const p = getProject(req.params.id, req.userId); if (!p) err(res, 404, 'NOT_FOUND', 'Project not found.'); return p; };

// ---------- uploads ----------
const tmpDir = path.join(SCAN_ROOT, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const diskTmp = multer.diskStorage({ destination: (_r, _f, cb) => cb(null, tmpDir), filename: (_r, _f, cb) => cb(null, uuid()) });
const modelUpload = multer({ storage: diskTmp, limits: { fileSize: LIMITS.modelBytes, files: 1 } }).single('model');
const thumbUpload = multer({ storage: diskTmp, limits: { fileSize: 2 * 1024 * 1024, files: 1 } }).single('thumb');
const imagesUpload = multer({ storage: diskTmp, limits: { fileSize: LIMITS.imageBytes, files: LIMITS.maxImages } }).array('images', LIMITS.maxImages);
const runUpload = (mw, req, res) => new Promise((resolve) => mw(req, res, (e) => {
  if (!e) return resolve(true);
  const tooBig = e.code === 'LIMIT_FILE_SIZE';
  err(res, 400, tooBig ? 'FILE_TOO_LARGE' : 'UPLOAD_FAILED', tooBig ? 'That file is too large.' : e.code === 'LIMIT_UNEXPECTED_FILE' || e.code === 'LIMIT_FILE_COUNT' ? `You can upload at most ${LIMITS.maxImages} images.` : 'Upload failed. Please try again.');
  resolve(false);
}));
const dropTmp = (files) => (files || []).forEach((f) => rm(f.path));

// ---------- capabilities / usage ----------
router.get('/capabilities', (_req, res) => res.json({ providers: capabilities(), stages: STAGES.map(([key, label]) => ({ key, label })), limits: LIMITS }));

router.get('/usage', (req, res) => {
  const r = db.prepare('SELECT COUNT(*) projects, COALESCE(SUM(model_bytes + original_bytes + thumb_bytes),0) bytes FROM scan_projects WHERE user_id = ? AND deleted_at IS NULL').get(req.userId);
  res.json({ projects: r.projects, bytes: r.bytes, maxProjects: LIMITS.projectsPerUser });
});

// ---------- projects ----------
router.get('/projects', (req, res) => {
  const rows = db.prepare('SELECT * FROM scan_projects WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100').all(req.userId);
  res.json({ projects: rows.map((p) => projectDTO(p)) });
});

router.post('/projects', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) c FROM scan_projects WHERE user_id = ? AND deleted_at IS NULL').get(req.userId).c;
  if (n >= LIMITS.projectsPerUser) return err(res, 409, 'PROJECT_LIMIT', `You can keep up to ${LIMITS.projectsPerUser} scan projects. Delete one first.`);
  const id = uuid();
  db.prepare('INSERT INTO scan_projects (id, user_id, name) VALUES (?, ?, ?)').run(id, req.userId, cleanName(req.body?.name));
  res.status(201).json({ project: projectDTO(db.prepare('SELECT * FROM scan_projects WHERE id = ?').get(id), { state: true }) });
});

router.get('/projects/:id', (req, res) => { const p = mustProject(req, res); if (p) res.json({ project: projectDTO(p, { state: true }) }); });

// Rename and/or autosave (parts, transforms, materials, variants, version history).
router.patch('/projects/:id', (req, res) => {
  const p = mustProject(req, res); if (!p) return;
  const sets = []; const vals = [];
  if (req.body?.name !== undefined) { sets.push('name = ?'); vals.push(cleanName(req.body.name, p.name)); }
  if (req.body?.state !== undefined) {
    const s = cleanState(req.body.state);
    if (!s.ok) return err(res, 400, 'INVALID_STATE', s.message);
    sets.push('state_json = ?'); vals.push(s.json);
  }
  if (!sets.length) return err(res, 400, 'NOTHING_TO_SAVE', 'Nothing to save.');
  sets.push('updated_at = ?'); vals.push(nowIso());
  db.prepare(`UPDATE scan_projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals, p.id);
  res.json({ project: projectDTO(db.prepare('SELECT * FROM scan_projects WHERE id = ?').get(p.id)) });
});

router.post('/projects/:id/duplicate', wrap(async (req, res) => {
  const p = mustProject(req, res); if (!p) return;
  const n = db.prepare('SELECT COUNT(*) c FROM scan_projects WHERE user_id = ? AND deleted_at IS NULL').get(req.userId).c;
  if (n >= LIMITS.projectsPerUser) return err(res, 409, 'PROJECT_LIMIT', `You can keep up to ${LIMITS.projectsPerUser} scan projects. Delete one first.`);
  const id = uuid();
  fs.mkdirSync(projectDir(id), { recursive: true });
  for (const f of ['current.glb', 'original.glb', 'thumb.png']) {
    const src = safeJoin(projectDir(p.id), f);
    if (fs.existsSync(src)) fs.copyFileSync(src, safeJoin(projectDir(id), f));
  }
  db.prepare('INSERT INTO scan_projects (id, user_id, name, state_json, model_bytes, original_bytes, thumb_bytes, status) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, req.userId, cleanName(`${p.name} (copy)`), p.state_json, p.model_bytes, p.original_bytes, p.thumb_bytes, p.status);
  res.status(201).json({ project: projectDTO(db.prepare('SELECT * FROM scan_projects WHERE id = ?').get(id)) });
}));

// Deleting needs an explicit confirmation flag so a stray request can never remove a scan.
router.delete('/projects/:id', (req, res) => {
  const p = mustProject(req, res); if (!p) return;
  if (req.query.confirm !== '1') return err(res, 400, 'CONFIRM_REQUIRED', 'Deleting a project is permanent. Confirm to continue.');
  const jobs = db.prepare('SELECT id FROM scan_jobs WHERE project_id = ?').all(p.id);
  for (const j of jobs) { cancelJob(j.id); rm(jobDir(j.id)); }
  db.prepare('DELETE FROM scan_jobs WHERE project_id = ?').run(p.id);
  rm(projectDir(p.id));
  db.prepare('UPDATE scan_projects SET deleted_at = ?, model_bytes = 0, original_bytes = 0, thumb_bytes = 0, state_json = NULL WHERE id = ?').run(nowIso(), p.id);
  res.json({ ok: true });
});

// Model files. `slot=original` is written once and never overwritten, so "restore original" always works.
router.put('/projects/:id/model', wrap(async (req, res) => {
  const p = mustProject(req, res); if (!p) return;
  if (!(await runUpload(modelUpload, req, res))) return;
  if (!req.file) return err(res, 400, 'NO_FILE', 'Choose a model file.');
  if (!sniffGlb(req.file.path)) { dropTmp([req.file]); return err(res, 400, 'INVALID_MODEL', 'That is not a valid GLB file. Import converts OBJ, STL, PLY and glTF to GLB in the browser first.'); }
  const slot = req.query.slot === 'original' ? 'original' : 'current';
  if (slot === 'original' && p.original_bytes) { dropTmp([req.file]); return err(res, 409, 'ORIGINAL_LOCKED', 'The original model is already stored and is never overwritten.'); }
  fs.mkdirSync(projectDir(p.id), { recursive: true });
  fs.renameSync(req.file.path, safeJoin(projectDir(p.id), `${slot}.glb`));
  const col = slot === 'original' ? 'original_bytes' : 'model_bytes';
  const sets = [`${col} = ?`, 'updated_at = ?', "status = 'ready'"]; const vals = [req.file.size, nowIso()];
  if (slot === 'original' && !p.model_bytes) { fs.copyFileSync(safeJoin(projectDir(p.id), 'original.glb'), safeJoin(projectDir(p.id), 'current.glb')); sets.push('model_bytes = ?'); vals.push(req.file.size); }
  db.prepare(`UPDATE scan_projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals, p.id);
  res.json({ project: projectDTO(db.prepare('SELECT * FROM scan_projects WHERE id = ?').get(p.id)) });
}));

const sendFile = (res, file, type, name) => {
  if (!fs.existsSync(file)) return err(res, 404, 'NOT_FOUND', 'File not found.');
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (name) res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  fs.createReadStream(file).pipe(res);
};
router.get('/projects/:id/model', (req, res) => {
  const p = mustProject(req, res); if (!p) return;
  const slot = req.query.slot === 'original' ? 'original' : 'current';
  sendFile(res, safeJoin(projectDir(p.id), `${slot}.glb`), 'model/gltf-binary');
});

router.put('/projects/:id/thumb', wrap(async (req, res) => {
  const p = mustProject(req, res); if (!p) return;
  if (!(await runUpload(thumbUpload, req, res))) return;
  if (!req.file || sniffImage(req.file.path) !== '.png') { dropTmp([req.file]); return err(res, 400, 'INVALID_IMAGE', 'The thumbnail must be a PNG.'); }
  fs.mkdirSync(projectDir(p.id), { recursive: true });
  fs.renameSync(req.file.path, safeJoin(projectDir(p.id), 'thumb.png'));
  db.prepare('UPDATE scan_projects SET thumb_bytes = ? WHERE id = ?').run(req.file.size, p.id);
  res.json({ ok: true });
}));
router.get('/projects/:id/thumb', (req, res) => { const p = mustProject(req, res); if (p) sendFile(res, safeJoin(projectDir(p.id), 'thumb.png'), 'image/png'); });

// ---------- reconstruction jobs ----------
const jobDTO = (j) => ({
  id: j.id, projectId: j.project_id, engine: j.engine, status: j.status, stage: j.stage, stageLabel: STAGES.find(([k]) => k === j.stage)?.[1] || j.stage,
  progress: Math.round(j.progress), message: j.message, error: j.error, note: j.note, resultKind: j.result_kind,
  hasResult: !!j.result_ext && j.status === 'done', resultExt: j.result_ext, inputCount: j.input_count,
  createdAt: j.created_at, updatedAt: j.updated_at,
});
const running = new Map();   // jobId -> AbortController
const queue = [];
let active = 0;
const CONCURRENCY = Math.max(1, Number(process.env.SCAN_CONCURRENCY) || 1);

const patchJob = (id, o) => {
  const keys = Object.keys(o);
  db.prepare(`UPDATE scan_jobs SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => o[k]), nowIso(), id);
};
function cancelJob(id) {
  const c = running.get(id); if (c) c.abort();
  const qi = queue.indexOf(id); if (qi >= 0) queue.splice(qi, 1);
}
async function execute(id) {
  const job = db.prepare('SELECT * FROM scan_jobs WHERE id = ?').get(id);
  if (!job || job.status === 'cancelled') return;
  const ctrl = new AbortController(); running.set(id, ctrl);
  const dir = jobDir(id); const inDir = path.join(dir, 'in'); const work = path.join(dir, 'work');
  const report = (stage, frac, message, overall) => patchJob(id, { stage, progress: Math.min(99, overall ?? (stageStart(stage) + stageWeight(stage) * Math.max(0, Math.min(1, frac)))), message: String(message).slice(0, 200) });
  try {
    patchJob(id, { status: 'running', stage: 'validate', progress: 1, message: 'Validating uploads', error: null });
    const files = fs.existsSync(inDir) ? fs.readdirSync(inDir).sort() : [];
    if (!files.length) throw new Error('The uploaded photos are no longer on the server. Upload them again.');
    report('analyze', 0.5, `${files.length} image(s) accepted`);
    fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
    const out = job.engine === 'photogrammetry'
      ? await runColmap({ inDir, workDir: work, signal: ctrl.signal, report, sequential: !!job.sequential })
      : await runTripo({ imagePath: path.join(inDir, files[0]), workDir: work, signal: ctrl.signal, report, speed: job.speed || 'fast' });
    report('optimize', 1, 'Saving result');
    fs.copyFileSync(out.file, path.join(dir, `result${out.ext}`));
    rm(inDir); rm(work);                                    // storage cleanup: inputs are not kept after success
    patchJob(id, { status: 'done', stage: 'final', progress: 100, message: 'Done', result_ext: out.ext, result_kind: out.kind, note: out.note });
  } catch (e) {
    if (e.cancelled || ctrl.signal.aborted) patchJob(id, { status: 'cancelled', message: 'Cancelled' });
    else patchJob(id, { status: 'failed', error: String(e.message || e).slice(0, 500), message: 'Failed' });
  } finally { running.delete(id); }
}
function pump() {
  while (active < CONCURRENCY && queue.length) {
    const id = queue.shift(); active += 1;
    execute(id).finally(() => { active -= 1; pump(); });
  }
}
const enqueue = (id) => { patchJob(id, { status: 'queued', stage: 'validate', progress: 0, message: 'Waiting in the queue', error: null }); queue.push(id); pump(); };

// Jobs that were running when the server stopped cannot resume: say so instead of showing a frozen bar.
db.prepare("UPDATE scan_jobs SET status = 'failed', error = 'The server restarted while this job was running. Press Retry.', message = 'Interrupted' WHERE status IN ('running','queued')").run();

// Storage cleanup policy: finished/failed jobs and their files are removed after 7 days.
const sweep = () => {
  const old = db.prepare("SELECT id FROM scan_jobs WHERE status IN ('done','failed','cancelled') AND updated_at < ?").all(new Date(Date.now() - 7 * 86400e3).toISOString());
  for (const j of old) { rm(jobDir(j.id)); db.prepare('DELETE FROM scan_jobs WHERE id = ?').run(j.id); }
  try { for (const f of fs.readdirSync(tmpDir)) { const p = path.join(tmpDir, f); if (Date.now() - fs.statSync(p).mtimeMs > 3600e3) rm(p); } } catch { /* ignore */ }
};
const timer = setInterval(sweep, 6 * 3600e3); timer.unref?.();

const getJob = (req, res) => {
  const j = db.prepare('SELECT * FROM scan_jobs WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!j) err(res, 404, 'NOT_FOUND', 'Job not found.');
  return j;
};

router.post('/jobs', wrap(async (req, res) => {
  if (!(await runUpload(imagesUpload, req, res))) return;
  const files = req.files || [];
  const engine = req.body?.engine === 'single-image' ? 'single-image' : 'photogrammetry';
  const fail = (status, code, msg) => { dropTmp(files); return err(res, status, code, msg); };

  const proj = getProject(String(req.body?.projectId || ''), req.userId);
  if (!proj) return fail(404, 'NOT_FOUND', 'Project not found.');
  const caps = capabilities();
  if (engine === 'photogrammetry' && !caps.photogrammetry.available) return fail(503, 'PROVIDER_UNAVAILABLE', `Photogrammetry is not available on this server. ${caps.photogrammetry.needs}`);
  if (engine === 'single-image' && !caps.singleImage.available) return fail(503, 'PROVIDER_UNAVAILABLE', `Single-image AI reconstruction is not available on this server. ${caps.singleImage.needs}`);
  if (engine === 'single-image' && files.length !== 1) return fail(400, 'ONE_IMAGE', 'Single-image reconstruction needs exactly one photo.');
  if (engine === 'photogrammetry' && files.length < LIMITS.minPhotogrammetryImages) return fail(400, 'TOO_FEW_IMAGES', `Photogrammetry needs at least ${LIMITS.minPhotogrammetryImages} photos (20–40 recommended).`);
  for (const f of files) if (!sniffImage(f.path)) return fail(400, 'INVALID_IMAGE', `“${String(f.originalname).slice(0, 60)}” is not a JPG, PNG or WebP photo.`);

  const activeJobs = db.prepare("SELECT COUNT(*) c FROM scan_jobs WHERE user_id = ? AND status IN ('queued','running')").get(req.userId).c;
  if (activeJobs >= LIMITS.activeJobsPerUser) return fail(429, 'JOB_IN_PROGRESS', 'You already have a reconstruction running. Wait for it to finish or cancel it.');
  const today = db.prepare('SELECT COUNT(*) c FROM scan_jobs WHERE user_id = ? AND created_at > ?').get(req.userId, new Date(Date.now() - 86400e3).toISOString()).c;
  if (today >= LIMITS.jobsPerDay) return fail(429, 'DAILY_LIMIT', 'Daily reconstruction limit reached. Try again tomorrow.');

  const id = uuid(); const inDir = path.join(jobDir(id), 'in');
  fs.mkdirSync(inDir, { recursive: true });
  files.forEach((f, i) => fs.renameSync(f.path, path.join(inDir, `${String(i).padStart(3, '0')}${sniffImage(f.path)}`)));
  db.prepare('INSERT INTO scan_jobs (id, project_id, user_id, engine, sequential, input_count, speed) VALUES (?,?,?,?,?,?,?)')
    .run(id, proj.id, req.userId, engine, req.body?.sequential === '1' || req.body?.sequential === 'true' ? 1 : 0, files.length, SPEEDS.includes(req.body?.speed) ? req.body.speed : 'fast');
  db.prepare("UPDATE scan_projects SET status = 'processing', updated_at = ? WHERE id = ?").run(nowIso(), proj.id);
  enqueue(id);
  res.status(202).json({ job: jobDTO(db.prepare('SELECT * FROM scan_jobs WHERE id = ?').get(id)) });
}));

router.get('/jobs', (req, res) => {
  const rows = req.query.projectId
    ? db.prepare('SELECT * FROM scan_jobs WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 30').all(req.userId, String(req.query.projectId))
    : db.prepare('SELECT * FROM scan_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').all(req.userId);
  res.json({ jobs: rows.map(jobDTO) });
});
router.get('/jobs/:id', (req, res) => { const j = getJob(req, res); if (j) res.json({ job: jobDTO(j) }); });

router.post('/jobs/:id/cancel', (req, res) => {
  const j = getJob(req, res); if (!j) return;
  if (!['queued', 'running'].includes(j.status)) return err(res, 409, 'NOT_ACTIVE', 'This job is not running.');
  cancelJob(j.id);
  if (!running.has(j.id)) patchJob(j.id, { status: 'cancelled', message: 'Cancelled' });
  res.json({ job: jobDTO(db.prepare('SELECT * FROM scan_jobs WHERE id = ?').get(j.id)) });
});

// Retry re-runs a failed/cancelled job from the photos still on disk (they are only deleted after success).
router.post('/jobs/:id/retry', (req, res) => {
  const j = getJob(req, res); if (!j) return;
  if (!['failed', 'cancelled'].includes(j.status)) return err(res, 409, 'NOT_RETRYABLE', 'Only a failed or cancelled job can be retried.');
  if (!fs.existsSync(path.join(jobDir(j.id), 'in'))) return err(res, 410, 'INPUT_GONE', 'The photos for this job were removed. Start a new job.');
  const busy = db.prepare("SELECT COUNT(*) c FROM scan_jobs WHERE user_id = ? AND status IN ('queued','running')").get(req.userId).c;
  if (busy >= LIMITS.activeJobsPerUser) return err(res, 429, 'JOB_IN_PROGRESS', 'You already have a reconstruction running.');
  enqueue(j.id);
  res.status(202).json({ job: jobDTO(db.prepare('SELECT * FROM scan_jobs WHERE id = ?').get(j.id)) });
});

router.get('/jobs/:id/result', (req, res) => {
  const j = getJob(req, res); if (!j) return;
  if (j.status !== 'done' || !j.result_ext) return err(res, 409, 'NOT_READY', 'This job has no result yet.');
  sendFile(res, safeJoin(jobDir(j.id), `result${j.result_ext}`), j.result_ext === '.glb' ? 'model/gltf-binary' : 'application/octet-stream');
});

export default router;
