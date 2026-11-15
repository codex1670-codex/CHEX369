import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { StudioEngine } from '../src/sim3d/studio/engine.js';
import { fitDistance } from '../src/sim3d/studio/studioMath.js';

describe('fitDistance', () => {
  it('puts the whole bounding sphere inside the frame, with margin', () => {
    const d = fitDistance(2, 35, 1.15); const half = Math.atan(2 / Math.sqrt(d * d - 4));
    expect(half).toBeLessThan((35 / 2) * (Math.PI / 180));              // sphere half-angle is smaller than the camera's half-FOV
    expect(fitDistance(4)).toBeCloseTo(fitDistance(2) * 2);            // scales with size
    expect(fitDistance(0)).toBeGreaterThan(0); expect(Number.isFinite(fitDistance(NaN))).toBe(true);
  });
});

describe('StudioEngine.poster', () => {
  let eng; let calls; let blobBytes; const realToBlob = HTMLCanvasElement.prototype.toBlob;
  beforeEach(() => {
    calls = []; blobBytes = { 'image/png': 1000, 'image/jpeg': 500 };
    HTMLCanvasElement.prototype.toBlob = function (cb, type) { cb(new Blob([new Uint8Array(blobBytes[type] || 1)], { type })); };
    eng = new StudioEngine();
    eng.scene = new THREE.Scene(); eng.modelRoot = new THREE.Group(); eng.scene.add(eng.modelRoot); eng.invalidate = () => {};
    const gl = { MAX_RENDERBUFFER_SIZE: 1, MAX_TEXTURE_SIZE: 2, getParameter: () => 16384, getContextAttributes: () => ({ antialias: true }) };
    eng.renderer = { domElement: document.createElement('canvas'), getContext: () => gl, getSize: (v) => v.set(700, 500), getPixelRatio: () => 2, setPixelRatio: (n) => calls.push(['ratio', n]), setSize: (w, h, st) => calls.push(['size', w, h, st]), render: (s, c) => calls.push(['render', c]) };
    eng.camera = new THREE.PerspectiveCamera(40, 1.4, 0.01, 100); eng.camera.position.set(3, 2, 4); eng.controls = { target: new THREE.Vector3(0, 0, 0) };
    eng.grid = new THREE.Object3D(); eng.axes = new THREE.Object3D(); eng.selBoxes = new THREE.Group(); eng.tcHelper = new THREE.Object3D(); eng.bboxHelper = new THREE.Object3D(); eng.measureGroup = new THREE.Group();
    eng.axes.visible = false;
    const m = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshStandardMaterial()); m.userData.partId = 'a'; eng.modelRoot.add(m); eng.addPart(m, 'a'); eng.emitParts = () => {};
  });
  afterEach(() => { HTMLCanvasElement.prototype.toBlob = realToBlob; });

  it('renders a large square picture, then puts the on-screen view back exactly', async () => {
    const camPos = eng.camera.position.toArray(); let during;
    eng.renderer.render = () => { during = { grid: eng.grid.visible, sel: eng.selBoxes.visible, gizmo: eng.tcHelper.visible, mode: eng.viewMode }; };
    const shot = await eng.poster(2048);
    expect(shot.width).toBe(2048); expect(shot.height).toBe(2048); expect(shot.type).toBe('image/png'); expect(shot.blob.size).toBe(1000);
    expect(during).toEqual({ grid: false, sel: false, gizmo: false, mode: 'textured' });                    // clean picture
    expect(eng.grid.visible).toBe(true); expect(eng.axes.visible).toBe(false); expect(eng.selBoxes.visible).toBe(true);   // visibility restored as it was
    expect(calls.find((c) => c[0] === 'size')).toEqual(['size', 2048, 2048, false]);                         // big offscreen-sized render…
    expect(calls.filter((c) => c[0] === 'size').at(-1)).toEqual(['size', 700, 500, false]); expect(calls.filter((c) => c[0] === 'ratio').at(-1)).toEqual(['ratio', 2]);   // …then restored
    expect(eng.camera.position.toArray()).toEqual(camPos);                                                    // the user's camera was never touched
  });
  it('keeps the current view mode and angle, and frames from the same side', async () => {
    eng.viewMode = 'wireframe'; let cam; eng.renderer.render = (s, c) => { cam = c; };
    await eng.poster(1024); expect(eng.viewMode).toBe('wireframe');
    expect(cam.aspect).toBe(1); expect(Math.sign(cam.position.x)).toBe(1); expect(Math.sign(cam.position.z)).toBe(1);    // same side as the viewer camera
    const radius = new THREE.Box3().setFromObject(eng.modelRoot).getSize(new THREE.Vector3()).length() / 2;
    expect(cam.position.length()).toBeGreaterThan(radius);
  });
  it('without hardware anti-aliasing it renders at double size and scales down smoothly', async () => {
    eng.renderer.getContext = () => ({ MAX_RENDERBUFFER_SIZE: 1, MAX_TEXTURE_SIZE: 2, getParameter: () => 16384, getContextAttributes: () => ({ antialias: false }) });
    const shot = await eng.poster(1024); expect(shot.width).toBe(1024); expect(calls.find((c) => c[0] === 'size')).toEqual(['size', 2048, 2048, false]);
  });
  it('respects the GPU limit', async () => {
    eng.renderer.getContext = () => ({ MAX_RENDERBUFFER_SIZE: 1, MAX_TEXTURE_SIZE: 2, getParameter: () => 1024, getContextAttributes: () => ({ antialias: true }) });
    expect((await eng.poster(4096)).width).toBe(1024);
  });
  it('falls back to high-quality JPEG when the PNG would be too big to upload', async () => {
    blobBytes['image/png'] = 5000;
    const shot = await eng.poster(2048, { maxBytes: 2000 }); expect(shot.type).toBe('image/jpeg'); expect(shot.blob.size).toBe(500);
  });
  it('restores the screen even if rendering fails', async () => {
    eng.renderer.render = () => { throw new Error('context lost'); };
    await expect(eng.poster(2048)).rejects.toThrow(/context lost/); expect(eng.grid.visible).toBe(true); expect(calls.filter((c) => c[0] === 'size').at(-1)).toEqual(['size', 700, 500, false]);
  });
});
