// Reconstruction providers. Each provider reports whether it is actually usable on this server
// (binary installed / API key present) and runs one job. Nothing here pretends to work when its
// dependency is missing: `capabilities()` says so and the job API refuses with a clear message.
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';

const COLMAP_BIN = process.env.COLMAP_BIN || 'colmap';
const MESHY_KEY = () => process.env.MESHY_API_KEY || '';
const MESHY_BASE = process.env.MESHY_BASE_URL || 'https://api.meshy.ai';

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
      id: 'meshy', available: !!MESHY_KEY(),
      output: 'AI-inferred GLB (hidden surfaces are estimated, not scanned)',
      needs: MESHY_KEY() ? null : 'Set MESHY_API_KEY on the server.',
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

/** Single-image AI reconstruction through Meshy. Needs MESHY_API_KEY and outbound internet. */
// `speed`: 'quality' (PBR textures), 'fast' (plain colour texture, default) or 'fastest' (shape only, no texture).
export const SPEEDS = ['fast', 'fastest', 'quality'];
export async function runMeshy({ imagePath, workDir, signal, report, speed = 'fast' }) {
  const key = MESHY_KEY();
  if (!key) throw new Error('No image-to-3D provider is configured (set MESHY_API_KEY).');
  const mime = imagePath.endsWith('.png') ? 'image/png' : imagePath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  const dataUri = `data:${mime};base64,${fs.readFileSync(imagePath).toString('base64')}`;
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  report('pointcloud', 0, 'Sending the photo to the AI provider');
  const start = await fetch(`${MESHY_BASE}/openapi/v1/image-to-3d`, { method: 'POST', headers, signal, body: JSON.stringify({ image_url: dataUri, enable_pbr: speed === 'quality', should_texture: speed !== 'fastest' }) });
  const created = await start.json().catch(() => ({}));
  if (!start.ok || !created.result) throw new Error(`The AI provider refused the request (${start.status}): ${String(created.message || '').slice(0, 160)}`);
  const id = created.result;
  for (let i = 0; i < 480; i += 1) {                       // up to ~12 min
    await new Promise((r) => setTimeout(r, 1500));
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
    const poll = await fetch(`${MESHY_BASE}/openapi/v1/image-to-3d/${id}`, { headers, signal });
    const j = await poll.json().catch(() => ({}));
    if (j.status === 'FAILED' || j.status === 'CANCELED') throw new Error(`The AI provider could not build a model (${j.task_error?.message || j.status}).`);
    const frac = Math.max(0, Math.min(1, (Number(j.progress) || 0) / 100));
    report(frac < 0.5 ? 'pointcloud' : frac < 0.8 ? 'mesh' : 'texture', 0, `AI provider: ${j.status} ${Math.round(frac * 100)}%`, 6 + frac * 90);   // one smooth bar for the provider's own 0-100%
    if (j.status === 'SUCCEEDED') {
      const url = j.model_urls?.glb;
      if (!url) throw new Error('The AI provider finished but returned no GLB.');
      const file = await fetch(url, { signal });
      if (!file.ok) throw new Error('Could not download the generated model.');
      const out = path.join(workDir, 'meshy.glb');
      fs.writeFileSync(out, Buffer.from(await file.arrayBuffer()));
      return { file: out, ext: '.glb', kind: 'ai-estimated', note: `AI-estimated geometry: surfaces not visible in your photo are inferred, not scanned.${speed === 'fastest' ? ' Fastest mode: shape only, no colours.' : ''}` };
    }
  }
  throw new Error('The AI provider took too long. Try again.');
}

export { stageStart, stageWeight };
