import { computeFrame, lerpFrame, filterById, canvasFilterSupported, NO_FILTER } from './faceFilters.js';

// Turns the camera into a filtered video track. Camera -> hidden <video> -> canvas (filter drawn on top) -> captureStream().
// The face tracker (MediaPipe Face Mesh, served from /mediapipe/face_mesh) is only loaded the first time a face filter is picked.
const BASE = `${(import.meta.env?.BASE_URL || '/').replace(/\/?$/, '/')}mediapipe/face_mesh/`;
const MAX_W = 960;
const FPS = 30;

let meshPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = resolve; s.onerror = () => reject(new Error('script'));
    document.head.appendChild(s);
  });
}
async function createMesh() {
  if (!window.FaceMesh) await loadScript(`${BASE}face_mesh.js`);
  const mesh = new window.FaceMesh({ locateFile: (f) => BASE + f });
  mesh.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  await mesh.initialize();
  return mesh;
}

export class FilterEngine {
  // hooks: { onStatus('loading'|'ready'|'error'), onFace(boolean) }
  constructor(hooks = {}) {
    this.hooks = hooks; this.filter = NO_FILTER; this.running = false;
    this.lm = null; this.miss = 0; this.frame = null; this.faceSeen = null;
    this.mesh = null; this.mirror = false; this.maxW = MAX_W; this.busy = false; this.cssOk = canvasFilterSupported(); this._scratch = null; this.last = 0;
  }

  start(track) {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.autoplay = true; v.srcObject = new MediaStream([track]);
    v.play?.().catch(() => {});
    this.video = v;
    this.canvas = document.createElement('canvas'); this.canvas.width = 640; this.canvas.height = 480;
    this.ctx = this.canvas.getContext('2d');
    this.stream = this.canvas.captureStream(FPS);
    this.running = true;
    this.loop();
    return this.stream;
  }

  setMirror(on) { this.mirror = !!on; }

  setSource(track) { if (this.video) { this.video.srcObject = new MediaStream([track]); this.video.play?.().catch(() => {}); this.lm = null; this.frame = null; } }

  async setFilter(id) {
    this.filter = filterById(id);
    if (this.filter.kind !== 'face' || this.mesh) { if (this.filter.kind === 'face') this.hooks.onStatus?.('ready'); return; }
    this.hooks.onStatus?.('loading');
    try {
      meshPromise = meshPromise || createMesh();
      const mesh = await meshPromise;
      if (!this.running) return;
      mesh.onResults((r) => this.onResults(r));
      this.mesh = mesh;
      this.hooks.onStatus?.('ready');
    } catch {
      meshPromise = null;
      this.hooks.onStatus?.('error');
    }
  }

  onResults(r) {
    const lm = r?.multiFaceLandmarks?.[0];
    if (lm) { this.lm = lm; this.miss = 0; } else if (++this.miss > 8) this.lm = null;
    const seen = !!this.lm;
    if (seen !== this.faceSeen) { this.faceSeen = seen; this.hooks.onFace?.(seen); }
  }

  scratch(w, h) {
    if (!this._scratch) { const canvas = document.createElement('canvas'); this._scratch = { canvas, ctx: canvas.getContext('2d') }; }
    if (this._scratch.canvas.width !== w || this._scratch.canvas.height !== h) { this._scratch.canvas.width = w; this._scratch.canvas.height = h; }
    return this._scratch;
  }

  loop() {
    if (!this.running) return;
    const next = () => this.loop();
    const now = performance.now();
    if (now - this.last >= 1000 / FPS - 2) { this.last = now; try { this.draw(now / 1000); } catch { /* skip a bad frame */ } }
    // requestAnimationFrame pauses in a hidden tab; a timer keeps the outgoing picture alive there
    if (document.hidden) this.timer = setTimeout(next, 1000 / FPS); else this.raf = requestAnimationFrame(next);
  }

  draw(t) {
    const v = this.video; if (!v || v.readyState < 2 || !v.videoWidth) return;
    const W = Math.min(v.videoWidth, this.maxW), H = Math.round((v.videoHeight * W) / v.videoWidth);
    const cv = this.canvas, c = this.ctx;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const f = this.filter;
    c.save();
    if (this.mirror) { c.translate(W, 0); c.scale(-1, 1); }
    if (f.kind === 'color') {
      if (f.custom) f.custom(c, v, W, H, t, this);
      else { if (f.css && this.cssOk) c.filter = f.css; c.drawImage(v, 0, 0, W, H); c.filter = 'none'; }
      f.after?.(c, W, H, t);
    } else {
      c.drawImage(v, 0, 0, W, H);
      if (f.kind === 'screen') f.draw(c, W, H, t);
      else if (f.kind === 'face') this.drawFace(c, f, W, H, t);
    }
    c.restore();
  }

  drawFace(c, f, W, H, t) {
    if (this.mesh && !this.busy) { this.busy = true; this.mesh.send({ image: this.video }).catch(() => {}).finally(() => { this.busy = false; }); }
    if (!this.lm) { this.frame = null; return; }
    this.frame = lerpFrame(this.frame, computeFrame(this.lm, W, H));
    const fr = this.frame;
    c.translate(fr.mx, fr.my); c.rotate(fr.roll); c.scale(fr.u, fr.u);
    f.draw(c, fr, t);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf); clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.video) { this.video.srcObject = null; this.video = null; }
    this.mesh = null; // the tracker itself stays loaded so the next filter starts instantly
  }
}
