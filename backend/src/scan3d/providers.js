// Reconstruction providers. Each provider reports whether it is actually usable on this server
// (binary installed / API key present) and runs one job. Nothing here pretends to work when its
// dependency is missing: `capabilities()` says so and the job API refuses with a clear message.
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';

const COLMAP_BIN = process.env.COLMAP_BIN || 'colmap';
// Single-photo AI provider: Tripo (https://developers.tripo3d.com). Meshy has been switched off.
const TRIPO_KEY = () => process.env.TRIPO_API_KEY || '';
const TRIPO_BASE = process.env.TRIPO_BASE_URL || 'https://openapi.tripo3d.com/v3';
const TRIPO_MODEL = process.env.TRIPO_MODEL || 'v3.1-20260211';

let colmapProbe = null;
export function colmapInfo() {
  if (colmapProbe) return colmapProbe;
  const r = spawnSync(COLMAP_BIN, ['help'], { encoding: 'utf8', timeout: 8000 });
  const text = `${r.stdout || ''}${r.stderr || ''}`;
  const installed = !r.error && /COLMAP/i.test(text);
  // CUDA builds say so in the banner; CPU builds cannot run patch_match_stereo (dense reconstruction).
  colmapProbe = { installed, cuda: installed && /with CUDA/i.test(text) };
  return colmapProbe;
}
export const resetProbe = () => { colmapProbe = null; };

export function capabilities() {
  const c = colmapInfo();
  return {
    photogrammetry: {
      id: 'colmap', available: c.installed,
      dense: c.cuda,
      output: c.cuda ? 'Dense point cloud → Poisson mesh (PLY)' : 'Sparse point cloud + camera poses (PLY). Dense meshing needs a CUDA build of COLMAP.',
      needs: c.installed ? null : 'Install COLMAP on the server (or set COLMAP_BIN).',
    },
    singleImage: {
      id: 'tripo', available: !!TRIPO_KEY(),
      output: 'AI-inferred GLB (hidden surfaces are estimated, not scanned)',
      needs: TRIPO_KEY() ? null : 'Set TRIPO_API_KEY on the server.',
    },
  };
}

// Stage names are the nine from the product spec; `weight` shares the 0-100% bar between them.
export const STAGES = [
  ['validate', 'Upload validation', 4], ['analyze', 'Image / frame analysis', 6], ['features', 'Feature matching', 22],
  ['cameras', 'Camera estimation', 18], ['pointcloud', 'Point cloud', 25], ['mesh', 'Mesh generation', 15],
  ['texture', 'Texture generation', 2], ['optimize', 'Optimization', 3], ['final', 'Final preview', 5],
];
const stageStart = (key) => { let p = 0; for (const [k, , w] of STAGES) { if (k === key) return p; p += w; } return 100; };
const stageWeight = (key) => STAGES.find(([k]) => k === key)?.[2] ?? 0;

function run(cmd, args, { cwd, signal, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const feed = (d) => { const s = d.toString(); tail = (tail + s).slice(-2000); if (onLine) s.split('\n').forEach((l) => l && onLine(l)); };
    p.stdout.on('data', feed); p.stderr.on('data', feed);
    const kill = () => { try { p.kill('SIGKILL'); } catch { /* gone */ } };
    if (signal) { if (signal.aborted) kill(); else signal.addEventListener('abort', kill, { once: true }); }
    p.on('error', (e) => reject(new Error(`${path.basename(cmd)} could not start: ${e.message}`)));
    p.on('close', (code) => {
      if (signal?.aborted) return reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
      code === 0 ? resolve(tail) : reject(new Error(`${path.basename(cmd)} ${args[0]} failed (exit ${code}). ${tail.split('\n').slice(-4).join(' ').slice(0, 400)}`));
    });
  });
}

/** COLMAP photogrammetry. `report(stageKey, fraction0to1, message)` drives the real progress bar. */
export async function runColmap({ inDir, workDir, signal, report, sequential }) {
  const { cuda } = colmapInfo();
  const db = path.join(workDir, 'database.db');
  const sparse = path.join(workDir, 'sparse');
  const dense = path.join(workDir, 'dense');
  fs.mkdirSync(sparse, { recursive: true });
  const images = fs.readdirSync(inDir).length;

  report('features', 0, `Detecting features in ${images} images`);
  let done = 0;
  await run(COLMAP_BIN, ['feature_extractor', '--database_path', db, '--image_path', inDir, '--ImageReader.single_camera', '1',
    ...(cuda ? [] : ['--SiftExtraction.use_gpu', '0'])], {
    signal, onLine: (l) => { if (/Processed file|Features:/i.test(l)) { done += 1; report('features', Math.min(0.5, done / (images * 2)), 'Detecting features'); } },
  });
  report('features', 0.5, 'Matching images');
  await run(COLMAP_BIN, [sequential ? 'sequential_matcher' : 'exhaustive_matcher', '--database_path', db, ...(cuda ? [] : ['--SiftMatching.use_gpu', '0'])], { signal });
  report('features', 1, 'Features matched');

  report('cameras', 0, 'Estimating camera poses');
  await run(COLMAP_BIN, ['mapper', '--database_path', db, '--image_path', inDir, '--output_path', sparse], { signal });
  const model0 = path.join(sparse, '0');
  if (!fs.existsSync(model0)) throw new Error('COLMAP could not align the photos (no camera model was found). Use 20–40 sharp photos with 60–80% overlap, a textured object and no moving parts.');
  report('cameras', 1, 'Cameras estimated');

  const sparsePly = path.join(workDir, 'sparse.ply');
  await run(COLMAP_BIN, ['model_converter', '--input_path', model0, '--output_path', sparsePly, '--output_type', 'PLY'], { signal });

  if (!cuda) {
    report('pointcloud', 1, 'Sparse point cloud ready (dense meshing needs a CUDA build of COLMAP)');
    return { file: sparsePly, ext: '.ply', kind: 'point-cloud', note: 'Sparse point cloud only: this server\'s COLMAP has no CUDA, so dense reconstruction and meshing were skipped.' };
  }

  report('pointcloud', 0, 'Undistorting images');
  await run(COLMAP_BIN, ['image_undistorter', '--image_path', inDir, '--input_path', model0, '--output_path', dense, '--output_type', 'COLMAP'], { signal });
  report('pointcloud', 0.15, 'Computing dense depth maps (slow)');
  await run(COLMAP_BIN, ['patch_match_stereo', '--workspace_path', dense, '--PatchMatchStereo.geom_consistency', 'true'], { signal });
  report('pointcloud', 0.85, 'Fusing dense point cloud');
  const fused = path.join(dense, 'fused.ply');
  await run(COLMAP_BIN, ['stereo_fusion', '--workspace_path', dense, '--output_path', fused], { signal });
  report('pointcloud', 1, 'Dense point cloud ready');

  report('mesh', 0, 'Building mesh (Poisson)');
  const meshed = path.join(workDir, 'meshed.ply');
  try {
    await run(COLMAP_BIN, ['poisson_mesher', '--input_path', fused, '--output_path', meshed], { signal });
    report('mesh', 1, 'Mesh ready');
    return { file: meshed, ext: '.ply', kind: 'mesh', note: 'Poisson mesh with vertex colours. No UV texture is projected by this pipeline.' };
  } catch (e) {
    if (e.cancelled) throw e;
    report('mesh', 1, 'Meshing failed — returning the dense point cloud');
    return { file: fused, ext: '.ply', kind: 'point-cloud', note: `Meshing failed (${e.message.slice(0, 120)}); the dense point cloud is returned instead.` };
  }
}

/** Single-image AI reconstruction through Tripo. Needs TRIPO_API_KEY and outbound internet. */
// `speed`: 'quality' (PBR materials), 'fast' (plain colour texture, default) or 'fastest' (shape only, no texture).
export const SPEEDS = ['fast', 'fastest', 'quality'];
const tripoJson = async (res) => {
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok && (j.code === undefined || j.code === 0), j };
};
const tripoMsg = (j) => String(j?.message || j?.error_message || j?.data?.error_message || j?.error || '').slice(0, 160);

export async function runTripo({ imagePath, workDir, signal, report, speed = 'fast' }) {
  const key = TRIPO_KEY();
  if (!key) throw new Error('No image-to-3D provider is configured (set TRIPO_API_KEY).');
  const auth = { Authorization: `Bearer ${key}` };
  const isPng = imagePath.endsWith('.png');
  const mime = isPng ? 'image/png' : 'image/jpeg';   // Tripo's upload endpoint accepts JPEG and PNG
  if (imagePath.endsWith('.webp')) throw new Error('Tripo accepts JPG or PNG photos. Please use a JPG or PNG.');

  // 1) upload the photo -> file_token
  report('pointcloud', 0, 'Sending the photo to the AI provider');
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(imagePath)], { type: mime }), isPng ? 'photo.png' : 'photo.jpg');
  const up = await tripoJson(await fetch(`${TRIPO_BASE}/files`, { method: 'POST', headers: auth, body: fd, signal }));
  const token = up.j?.data?.file_token;
  if (!up.ok || !token) throw new Error(`The AI provider refused the photo: ${tripoMsg(up.j) || 'upload failed'}.`);

  // 2) start the image -> model task
  const body = { input: token, model: TRIPO_MODEL, texture: speed !== 'fastest', pbr: speed === 'quality' };
  const start = await tripoJson(await fetch(`${TRIPO_BASE}/generation/image-to-model`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }));
  const id = start.j?.data?.task_id;
  if (!start.ok || !id) throw new Error(`The AI provider refused the request: ${tripoMsg(start.j) || 'could not start the task'}.`);

  // 3) poll
  let unknownTicks = 0;
  for (let i = 0; i < 480; i += 1) {                       // up to ~12 min
    await new Promise((r) => setTimeout(r, 1500));
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
    const poll = await tripoJson(await fetch(`${TRIPO_BASE}/tasks/${id}`, { headers: auth, signal }));
    const d = poll.j?.data || {};
    const status = String(d.status || '').toLowerCase();
    if (['failed', 'cancelled', 'banned', 'expired'].includes(status)) throw new Error(`The AI provider could not build a model (${d.error_message || status}).`);
    if (status === 'unknown' && (unknownTicks += 1) > 40) throw new Error('The AI provider returned an unknown status. Try again.');
    const frac = Math.max(0, Math.min(1, (Number(d.progress) || 0) / 100));
    report(frac < 0.5 ? 'pointcloud' : frac < 0.8 ? 'mesh' : 'texture', 0, `AI provider: ${status || 'working'} ${Math.round(frac * 100)}%`, 6 + frac * 90);
    if (status === 'success') {
      const o = d.output || {};
      const url = o.model_url || o.pbr_model || o.model;
      if (!url || typeof url !== 'string') throw new Error('The AI provider finished but returned no model file.');
      const file = await fetch(url, { signal });
      if (!file.ok) throw new Error('Could not download the generated model.');
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.subarray(0, 4).toString('latin1') !== 'glTF') throw new Error('The AI provider returned a model in an unsupported format.');
      const out = path.join(workDir, 'tripo.glb');
      fs.writeFileSync(out, buf);
      return { file: out, ext: '.glb', kind: 'ai-estimated', note: `AI-estimated geometry: surfaces not visible in your photo are inferred, not scanned.${speed === 'fastest' ? ' Fastest mode: shape only, no colours.' : ''}` };
    }
  }
  throw new Error('The AI provider took too long. Try again.');
}

export { stageStart, stageWeight };
