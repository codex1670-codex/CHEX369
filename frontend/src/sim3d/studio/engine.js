// CHEX 3D Scanning Studio — the three.js engine behind the viewport. It is plain JS (no React) and owns
// everything in the scene; React only mirrors the part list / selection / stats it reports through `on`.
//
// Every mesh in an imported model is flattened to a direct child of `modelRoot` (world transform kept), so
// a "part" is simply one mesh/points object. That keeps move/rotate/scale, variants, physics and export simple.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { PLYExporter } from 'three/examples/jsm/exporters/PLYExporter.js';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  surfaceArea, signedVolume, meshTopology, connectedComponents, laplacianSmooth, subdivideFlat, boundsOf, dist3, angleDeg, fitDistance,
} from './studioMath.js';
import { makeBody, stepWorld, sampleKeys, hingeAngle, sliderOffset, ballAngles, applyImpulse, movingCount, stability, stackLoads, heatColor } from './physics.js';

const uid = () => (globalThis.crypto?.randomUUID?.() || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
const lowMemory = () => typeof navigator !== 'undefined' && navigator.deviceMemory && navigator.deviceMemory <= 2;
export const IMPORT_EXTS = ['glb', 'gltf', 'obj', 'stl', 'ply'];
export const MAX_IMPORT_BYTES = () => (lowMemory() ? 25 : 80) * 1024 * 1024;
export const VIEW_MODES = ['textured', 'solid', 'wireframe', 'xray', 'points'];
export const MATERIAL_PRESETS = {
  Original: null,
  Plastic: { metalness: 0, roughness: 0.45 }, Matte: { metalness: 0, roughness: 0.95 }, Metal: { metalness: 1, roughness: 0.28 },
  Brushed: { metalness: 0.9, roughness: 0.55 }, Glass: { metalness: 0, roughness: 0.05, opacity: 0.35 }, Wood: { metalness: 0, roughness: 0.75, color: '#a8754a' },
  Rubber: { metalness: 0, roughness: 1, color: '#1d1d1f' },
};
const GEOM = new Set(['Smooth', 'Subdivide', 'Simplify', 'Repair', 'Split', 'Duplicate']);   // history labels that change the mesh (so the GLB must be re-saved)
const ext = (name = '') => name.split('.').pop().toLowerCase();

export class StudioEngine {
  constructor() {
    this.listeners = new Set();
    this.parts = [];                 // { id, name, object, locked, visible, deleted, group, authorMat, pointsObj }
    this.selected = new Set();
    this.viewMode = 'textured';
    this.history = []; this.future = [];
    this.measureMode = null; this.measurePts = [];
    this.scaleToMeters = 1;          // model units → metres (calibrated by the user)
    this.sim = null; this.anim = { keys: {}, t: 0, playing: false, duration: 4, loop: true, speed: 1, easing: 'linear' };
    this.pokeMode = false; this.pokeStrength = 2;   // poke: click a part while the simulation runs to push it away from the camera (m/s)
    this._raf = 0; this._disposed = false; this._helpers = [];
    this.snap = { on: false, move: 0.05, rotate: 15, scale: 0.1 };
  }

  // ---------------------------------------------------------------- events
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }

  // ---------------------------------------------------------------- mount / teardown
  mount(el) {
    this.el = el;
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: !lowMemory(), powerPreference: 'high-performance', alpha: false });
    } catch { throw new Error('3D graphics are not available on this device or browser (WebGL could not start).'); }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowMemory() ? 1 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;outline:none;touch-action:none';
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.setAttribute('aria-label', '3D viewport. Drag to orbit, scroll or pinch to zoom, right-drag or two fingers to pan.');
    this.renderer.domElement.tabIndex = 0;
    el.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0d1226');
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; pmrem.dispose();
    this.scene.environmentIntensity = 0.7;
    this.key = new THREE.DirectionalLight(0xffffff, 1.6); this.key.position.set(3, 5, 4); this.scene.add(this.key);
    this.fill = new THREE.AmbientLight(0xffffff, 0.35); this.scene.add(this.fill);

    this.persp = new THREE.PerspectiveCamera(40, 1, 0.01, 2000); this.persp.position.set(2.2, 1.6, 2.6);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
    this.camera = this.persp;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.12;
    this.controls.addEventListener('change', () => this.invalidate());

    this.tc = new TransformControls(this.camera, this.renderer.domElement);
    this.tc.addEventListener('dragging-changed', (e) => { this.controls.enabled = !e.value; });
    this.tc.addEventListener('objectChange', () => { this.refreshSelectionBox(); this.invalidate(); this.emit('transform'); });
    this.tc.addEventListener('mouseDown', () => { this._before = this.tc.object ? this.snapshotObject(this.tc.object) : null; });
    this.tc.addEventListener('mouseUp', () => {
      const o = this.tc.object; if (!o || !this._before) return;
      const before = this._before; const after = this.snapshotObject(o); this._before = null;
      this.push({ label: 'Transform', undo: () => this.restoreObject(o, before), redo: () => this.restoreObject(o, after) });
    });
    this.tcHelper = this.tc.getHelper(); this.scene.add(this.tcHelper);

    this.grid = new THREE.GridHelper(10, 20, 0x4b6bff, 0x26304f); this.grid.material.transparent = true; this.grid.material.opacity = 0.6; this.scene.add(this.grid);
    this.axes = new THREE.AxesHelper(1.2); this.axes.visible = false; this.scene.add(this.axes);
    this.bboxHelper = new THREE.Box3Helper(new THREE.Box3(), 0xffd84a); this.bboxHelper.visible = false; this.scene.add(this.bboxHelper);
    this.modelRoot = new THREE.Group(); this.modelRoot.name = 'model'; this.scene.add(this.modelRoot);
    this.measureGroup = new THREE.Group(); this.scene.add(this.measureGroup);
    this.selBoxes = new THREE.Group(); this.scene.add(this.selBoxes);

    this.ray = new THREE.Raycaster(); this.ray.params.Points = { threshold: 0.02 };
    const dom = this.renderer.domElement;
    this._down = (e) => { this._pd = { x: e.clientX, y: e.clientY }; };
    this._up = (e) => { if (this._pd && Math.hypot(e.clientX - this._pd.x, e.clientY - this._pd.y) < 5 && !this.tc.dragging) this.handleClick(e); this._pd = null; };
    dom.addEventListener('pointerdown', this._down); dom.addEventListener('pointerup', this._up);
    this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(el);
    this.resize(); this.invalidate();
  }

  dispose() {
    this._disposed = true; cancelAnimationFrame(this._raf); cancelAnimationFrame(this._simRaf);
    this._ro?.disconnect();
    const dom = this.renderer?.domElement; dom?.removeEventListener('pointerdown', this._down); dom?.removeEventListener('pointerup', this._up);
    this.controls?.dispose(); this.tc?.dispose?.();
    this.scene?.traverse((o) => { o.geometry?.dispose?.(); [].concat(o.material || []).forEach((m) => { Object.values(m).forEach((v) => v?.isTexture && v.dispose()); m.dispose?.(); }); });
    this.renderer?.dispose(); dom?.remove();
    this.listeners.clear();
  }

  resize() {
    if (!this.el || !this.renderer) return;
    const w = Math.max(1, this.el.clientWidth), h = Math.max(1, this.el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h; this.persp.updateProjectionMatrix();
    this.fitOrtho(); this.invalidate();
  }
  invalidate() {
    if (this._raf || this._disposed) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0; if (this._disposed) return;
      const moving = this.controls.update();             // returns true while damping is still settling
      this.renderer.render(this.scene, this.camera);
      if (moving) this.invalidate();
    });
  }

  // ---------------------------------------------------------------- loading
  async importFile(file) {
    const e = ext(file.name);
    if (!IMPORT_EXTS.includes(e)) throw new Error(`“.${e}” is not supported. Use GLB, glTF, OBJ, STL or PLY.`);
    if (file.size > MAX_IMPORT_BYTES()) throw new Error(`That file is ${(file.size / 1048576).toFixed(0)} MB; the limit on this device is ${(MAX_IMPORT_BYTES() / 1048576).toFixed(0)} MB.`);
    if (!file.size) throw new Error('That file is empty.');
    const buf = await file.arrayBuffer();
    return this.importBuffer(buf, e, file.name);
  }

  async importBuffer(buf, e, name = 'model') {
    let root;
    try {
      if (e === 'glb') root = (await new GLTFLoader().parseAsync(buf, '')).scene;
      else if (e === 'gltf') root = (await new GLTFLoader().parseAsync(new TextDecoder().decode(buf), '')).scene;
      else if (e === 'obj') root = new OBJLoader().parse(new TextDecoder().decode(buf));
      else if (e === 'stl') root = new THREE.Mesh(new STLLoader().parse(buf), new THREE.MeshStandardMaterial({ color: '#c7cde0', roughness: 0.6 }));
      else if (e === 'ply') {
        const g = new PLYLoader().parse(buf);
        const hasColor = !!g.getAttribute('color');
        root = g.index
          ? new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: hasColor ? 0xffffff : '#c7cde0', vertexColors: hasColor, roughness: 0.7, side: THREE.DoubleSide }))
          : new THREE.Points(g, new THREE.PointsMaterial({ size: 0.006, vertexColors: hasColor, color: hasColor ? 0xffffff : '#9fc2ff', sizeAttenuation: true }));
        if (!g.getAttribute('normal') && g.index) g.computeVertexNormals();
      } else throw new Error('Unsupported type');
    } catch (err) {
      if (e === 'gltf') throw new Error('Could not read that glTF. Single-file (embedded) glTF works; a glTF that needs separate .bin/texture files should be exported as GLB.');
      throw new Error(`Could not read that ${e.toUpperCase()} file (${err.message || 'invalid data'}).`);
    }
    root.name = name;
    return this.setModel(root);
  }

  /** Replace the scene model. Flattens every mesh to a child of modelRoot and builds the part list. */
  setModel(root) {
    this.stopSim?.(); this.clearMeasure();
    this.detach();
    for (const p of this.parts) this.disposePart(p);
    this.parts = []; this.selected.clear(); this.history = []; this.future = [];
    this.modelRoot.clear();
    root.updateMatrixWorld(true);
    const found = []; root.traverse((o) => { if ((o.isMesh || o.isPoints) && o.geometry) found.push(o); });
    if (!found.length) throw new Error('That file has no 3D geometry in it.');
    let n = 0;
    for (const o of found) {
      this.modelRoot.attach(o);                              // keeps the world transform
      o.userData.partId = o.userData.partId || uid();
      this.addPart(o, o.name || o.userData.partName || `Part ${++n}`);
    }
    this.applyViewMode(); this.frame(); this.emitParts(); this.emitStats();
    return this.parts.length;
  }

  addPart(object, name, extra = {}) {
    if (object.isMesh) {
      const base = [].concat(object.material)[0];
      const mat = base?.clone ? base.clone() : new THREE.MeshStandardMaterial({ color: '#c7cde0' });
      if (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial) {
        const std = new THREE.MeshStandardMaterial({ color: mat.color ? mat.color.clone() : new THREE.Color('#c7cde0'), map: mat.map || null, vertexColors: !!mat.vertexColors, side: mat.side });
        mat.dispose?.(); object.material = std;
      } else object.material = mat;
    }
    const part = {
      id: object.userData.partId, name: String(name).slice(0, 60), object, locked: false, visible: true, deleted: false, group: null,
      authorMat: object.isMesh ? object.material : null, origMat: object.isMesh ? object.material.clone() : null, base: this.snapshotObject(object), ...extra,
    };
    this.parts.push(part); return part;
  }
  disposePart(p) { p.pointsObj?.geometry && p.pointsObj.material?.dispose?.(); }
  part(id) { return this.parts.find((p) => p.id === id); }
  live() { return this.parts.filter((p) => !p.deleted); }

  // ---------------------------------------------------------------- selection & picking
  handleClick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const targets = this.live().filter((p) => p.visible).map((p) => p.object);
    const hit = this.ray.intersectObjects(targets, false)[0];
    if (this.measureMode) {
      if (!hit) return;
      this.measurePts.push(hit.point.toArray()); this.drawMeasureMarker(hit.point);
      const need = this.measureMode === 'angle' ? 3 : 2;
      if (this.measurePts.length >= need) {
        const pts = this.measurePts.splice(0, need); this.drawMeasureLine(pts);
        this.emit('measure', { mode: this.measureMode, points: pts, ...(need === 2 ? { metres: dist3(pts[0], pts[1]) * this.scaleToMeters, raw: dist3(pts[0], pts[1]) } : { degrees: angleDeg(pts[0], pts[1], pts[2]) }) });
      } else this.emit('measure-progress', { have: this.measurePts.length, need });
      this.invalidate(); return;
    }
    if (this.sim) {
      if (this.pokeMode && hit) { const p = this.parts.find((q) => q.object === hit.object); if (p) { const d = this.camera.getWorldDirection(new THREE.Vector3()); this.nudge(p.id, [d.x, Math.max(d.y, 0) + 0.2, d.z], this.pokeStrength); } }
      return;
    }
    const id = hit ? this.parts.find((p) => p.object === hit.object)?.id : null;
    this.select(id ? [id] : [], e.shiftKey || e.ctrlKey || e.metaKey);
  }

  select(ids, additive = false) {
    if (!additive) this.selected.clear();
    for (const id of ids) { if (additive && this.selected.has(id)) this.selected.delete(id); else this.selected.add(id); }
    this.refreshSelectionBox(); this.attachGizmo(); this.emit('selection', [...this.selected]); this.invalidate();
  }
  primary() { const id = [...this.selected][0]; return id ? this.part(id) : null; }
  refreshSelectionBox() {
    this.selBoxes.clear();
    for (const id of this.selected) { const p = this.part(id); if (p && !p.deleted && p.visible) { const b = new THREE.BoxHelper(p.object, p.locked ? 0xff6b6b : 0x00e5ff); this.selBoxes.add(b); } }
  }
  attachGizmo() {
    const p = this.primary();
    if (p && !p.locked && !p.deleted && p.visible && this.gizmoMode) { this.tc.attach(p.object); this.tc.setMode(this.gizmoMode); this.applySnap(); this.tcHelper.visible = true; }
    else this.detach();
  }
  detach() { this.tc?.detach(); }
  setGizmo(mode) { this.gizmoMode = mode; this.attachGizmo(); this.invalidate(); }   // 'translate' | 'rotate' | 'scale' | null
  setSnap(snap) { Object.assign(this.snap, snap); this.applySnap(); }
  applySnap() {
    this.tc.setTranslationSnap(this.snap.on ? this.snap.move : null);
    this.tc.setRotationSnap(this.snap.on ? THREE.MathUtils.degToRad(this.snap.rotate) : null);
    this.tc.setScaleSnap(this.snap.on ? this.snap.scale : null);
  }

  // ---------------------------------------------------------------- history (undo / redo)
  push(cmd) { if (GEOM.has(cmd.label)) this.emit('geometry'); this.history.push(cmd); if (this.history.length > 100) this.history.shift(); this.future = []; this.emit('history'); this.emit('dirty'); }
  undo() { const c = this.history.pop(); if (!c) return false; c.undo(); if (GEOM.has(c.label)) this.emit('geometry'); this.future.push(c); this.afterEdit(); return true; }
  redo() { const c = this.future.pop(); if (!c) return false; c.redo(); if (GEOM.has(c.label)) this.emit('geometry'); this.history.push(c); this.afterEdit(); return true; }
  afterEdit() { this.refreshSelectionBox(); this.attachGizmo(); this.emitParts(); this.emitStats(); this.emit('history'); this.emit('dirty'); this.invalidate(); }
  snapshotObject(o) { return { p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray() }; }
  restoreObject(o, s) { o.position.fromArray(s.p); o.quaternion.fromArray(s.q); o.scale.fromArray(s.s); o.updateMatrixWorld(true); this.afterEdit(); }

  // ---------------------------------------------------------------- part operations
  rename(id, name) { const p = this.part(id); if (!p) return; const old = p.name; const nn = String(name).trim().slice(0, 60) || old; this.push({ label: 'Rename', undo: () => { p.name = old; }, redo: () => { p.name = nn; } }); p.name = nn; this.emitParts(); }
  setVisible(id, v) { const p = this.part(id); if (!p) return; const old = p.visible; const apply = (x) => { p.visible = x; p.object.visible = x && !p.deleted; }; apply(v); this.push({ label: 'Visibility', undo: () => apply(old), redo: () => apply(v) }); this.afterEdit(); }
  setLocked(id, v) { const p = this.part(id); if (!p) return; p.locked = v; this.attachGizmo(); this.refreshSelectionBox(); this.emitParts(); this.emit('dirty'); }
  remove(ids) {
    const ps = ids.map((i) => this.part(i)).filter((p) => p && !p.locked && !p.deleted);
    if (!ps.length) return 0;
    const set = (v) => ps.forEach((p) => { p.deleted = v; p.object.visible = !v && p.visible; if (v) this.selected.delete(p.id); });
    set(true); this.push({ label: 'Delete', undo: () => set(false), redo: () => set(true) }); this.afterEdit(); return ps.length;
  }
  duplicate(ids) {
    const made = [];
    for (const id of ids) {
      const p = this.part(id); if (!p || p.deleted) continue;
      const o = p.object.clone(false); o.userData = { ...p.object.userData, partId: uid() };
      if (o.isMesh) o.material = p.object.material.clone();
      o.position.x += 0.05; this.modelRoot.add(o);
      const np = this.addPart(o, `${p.name} copy`); np.group = p.group; made.push(np);
    }
    if (!made.length) return [];
    this.push({
      label: 'Duplicate',
      undo: () => made.forEach((n) => { this.modelRoot.remove(n.object); this.parts = this.parts.filter((x) => x !== n); this.selected.delete(n.id); }),
      redo: () => made.forEach((n) => { this.modelRoot.add(n.object); this.parts.push(n); }),
    });
    this.select(made.map((m) => m.id)); this.afterEdit(); return made.map((m) => m.id);
  }
  setGroup(ids, group) { const ps = ids.map((i) => this.part(i)).filter(Boolean); const old = ps.map((p) => p.group); ps.forEach((p) => { p.group = group || null; }); this.push({ label: 'Group', undo: () => ps.forEach((p, i) => { p.group = old[i]; }), redo: () => ps.forEach((p) => { p.group = group || null; }) }); this.emitParts(); }

  setTransform(id, { pos, rot, scale }, key) {
    const p = this.part(id); if (!p || p.locked) return;
    const o = p.object; const before = this.snapshotObject(o);
    if (pos) o.position.set(...pos);
    if (rot) o.rotation.set(...rot.map((d) => THREE.MathUtils.degToRad(d)));
    if (scale) o.scale.set(...scale.map((s) => (Math.abs(s) < 1e-4 ? 1e-4 : s)));
    o.updateMatrixWorld(true);
    const after = this.snapshotObject(o);
    const last = this.history[this.history.length - 1];
    if (key && last?.key === key && Date.now() - last.at < 600) { last.redo = () => this.restoreObject(o, after); last.at = Date.now(); }
    else { this.push({ label: 'Transform', key, at: Date.now(), undo: () => this.restoreObject(o, before), redo: () => this.restoreObject(o, after) }); }
    this.refreshSelectionBox(); this.emit('transform'); this.invalidate();
  }
  resetTransform(id) { const p = this.part(id); if (!p || p.locked) return; const before = this.snapshotObject(p.object); this.restoreObject(p.object, p.base); const after = p.base; this.push({ label: 'Reset transform', undo: () => this.restoreObject(p.object, before), redo: () => this.restoreObject(p.object, after) }); }
  transformOf(p) { const o = p.object; return { pos: o.position.toArray(), rot: [o.rotation.x, o.rotation.y, o.rotation.z].map((r) => THREE.MathUtils.radToDeg(r)), scale: o.scale.toArray() }; }

  // ---------------------------------------------------------------- appearance
  setMaterial(id, patch) {
    const p = this.part(id); if (!p?.object.isMesh || p.locked) return;
    const m = p.authorMat; const before = this.matSnapshot(m);
    if (patch.color !== undefined) m.color.set(patch.color);
    if (patch.metalness !== undefined) m.metalness = patch.metalness;
    if (patch.roughness !== undefined) m.roughness = patch.roughness;
    if (patch.opacity !== undefined) { m.opacity = patch.opacity; m.transparent = patch.opacity < 1; m.depthWrite = patch.opacity >= 1; }
    if (patch.preset !== undefined) p.preset = patch.preset;
    m.needsUpdate = true; this.applyViewMode();
    const after = this.matSnapshot(m);
    this.push({ label: 'Material', undo: () => this.matRestore(m, before), redo: () => this.matRestore(m, after) });
    this.emitParts(); this.invalidate();
  }
  applyPreset(id, name) {
    const preset = MATERIAL_PRESETS[name]; const p = this.part(id); if (!p?.object.isMesh) return;
    if (name === 'Original') { const o = p.origMat; this.setMaterial(id, { color: `#${o.color.getHexString()}`, metalness: o.metalness, roughness: o.roughness, opacity: o.opacity, preset: 'Original' }); return; }
    this.setMaterial(id, { opacity: 1, ...preset, preset: name });
  }
  matSnapshot(m) { return { c: m.color.getHex(), me: m.metalness, r: m.roughness, o: m.opacity, t: m.transparent, map: m.map || null, mr: m.map ? m.map.repeat.toArray() : null, mrot: m.map ? m.map.rotation : 0 }; }
  matRestore(m, s) { m.color.setHex(s.c); m.metalness = s.me; m.roughness = s.r; m.opacity = s.o; m.transparent = s.t; m.map = s.map; if (m.map && s.mr) { m.map.repeat.fromArray(s.mr); m.map.rotation = s.mrot; } m.needsUpdate = true; this.applyViewMode(); this.emitParts(); this.invalidate(); }
  materialOf(p) { const m = p.authorMat; return m ? { color: `#${m.color.getHexString()}`, metalness: m.metalness, roughness: m.roughness, opacity: m.opacity, hasMap: !!m.map, preset: p.preset || 'Original', repeat: m.map ? m.map.repeat.x : 1, rotation: m.map ? THREE.MathUtils.radToDeg(m.map.rotation) : 0 } : null; }
  async replaceTexture(id, file) {
    const p = this.part(id); if (!p?.object.isMesh || p.locked) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) throw new Error('Use a PNG, JPG or WebP image as a texture.');
    if (file.size > 12 * 1024 * 1024) throw new Error('That texture is too large (12 MB limit).');
    const bmp = await createImageBitmap(file);
    const tex = new THREE.Texture(bmp); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.flipY = false; tex.needsUpdate = true;
    const m = p.authorMat; const before = this.matSnapshot(m);
    if (!p.object.geometry.getAttribute('uv')) throw new Error('This part has no UV coordinates, so a texture cannot be mapped onto it.');
    m.map = tex; m.color.set('#ffffff'); m.needsUpdate = true; this.applyViewMode();
    const after = this.matSnapshot(m);
    this.push({ label: 'Texture', undo: () => this.matRestore(m, before), redo: () => this.matRestore(m, after) }); this.emitParts(); this.invalidate();
  }
  setTextureTransform(id, { repeat, rotationDeg }) {
    const m = this.part(id)?.authorMat; if (!m?.map) return;
    if (repeat !== undefined) m.map.repeat.set(repeat, repeat);
    if (rotationDeg !== undefined) m.map.rotation = THREE.MathUtils.degToRad(rotationDeg);
    m.map.needsUpdate = true; this.invalidate(); this.emit('dirty');
  }

  // ---------------------------------------------------------------- view modes
  setViewMode(mode) { if (VIEW_MODES.includes(mode)) { this.viewMode = mode; this.applyViewMode(); this.invalidate(); this.emit('viewmode', mode); } }
  applyViewMode() {
    const mode = this.viewMode;
    this._solid ||= new THREE.MeshStandardMaterial({ color: '#cfd6e6', roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide });
    this._wire ||= new THREE.MeshBasicMaterial({ color: '#7fc0ff', wireframe: true });
    this._xray ||= new THREE.MeshStandardMaterial({ color: '#7fd1ff', transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    this._hidden ||= new THREE.MeshBasicMaterial({ visible: false });
    for (const p of this.parts) {
      if (!p.object.isMesh) continue;
      p.object.material = mode === 'solid' ? this._solid : mode === 'wireframe' ? this._wire : mode === 'xray' ? this._xray : mode === 'points' ? this._hidden : (this._loadMats?.get(p.id) || p.authorMat);
      if (mode === 'points') {
        if (!p.pointsObj) { p.pointsObj = new THREE.Points(p.object.geometry, new THREE.PointsMaterial({ size: 0.006, color: '#9fc2ff' })); p.object.add(p.pointsObj); }
        p.pointsObj.visible = true;
      } else if (p.pointsObj) p.pointsObj.visible = false;
    }
  }

  // ---------------------------------------------------------------- camera / scene options
  bounds() { const b = new THREE.Box3(); for (const p of this.live()) if (p.visible) b.expandByObject(p.object); return b.isEmpty() ? new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1)) : b; }
  frame() {
    const b = this.bounds(); const c = b.getCenter(new THREE.Vector3()); const s = b.getSize(new THREE.Vector3());
    const r = Math.max(s.x, s.y, s.z, 0.001); const d = (r / 2 / Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2))) * 1.5;
    this.persp.near = r / 500; this.persp.far = r * 200; this.persp.updateProjectionMatrix();
    this.controls.target.copy(c); this.camera.position.copy(c).add(new THREE.Vector3(1, 0.7, 1.2).normalize().multiplyScalar(d));
    this.grid.scale.setScalar(Math.max(0.1, r / 5)); this.grid.position.y = b.min.y; this.axes.scale.setScalar(r / 2); this.axes.position.set(b.min.x, b.min.y, b.min.z);
    this.ray.params.Points.threshold = r / 200; this.markerSize = r / 80;
    this.fitOrtho(); this.controls.update(); this.updateBBox(); this.invalidate();
  }
  fitOrtho() {
    if (!this.ortho || !this.el) return;
    const aspect = this.el.clientWidth / Math.max(1, this.el.clientHeight);
    const dist = this.camera.position.distanceTo(this.controls.target) || 3;
    const h = dist * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
    this.ortho.left = -h * aspect; this.ortho.right = h * aspect; this.ortho.top = h; this.ortho.bottom = -h; this.ortho.updateProjectionMatrix();
  }
  setProjection(kind) {
    const next = kind === 'ortho' ? this.ortho : this.persp; if (next === this.camera) return;
    next.position.copy(this.camera.position); next.quaternion.copy(this.camera.quaternion); next.up.copy(this.camera.up);
    this.camera = next; this.controls.object = next; this.tc.camera = next; if (kind === 'ortho') { this.ortho.zoom = 1; this.fitOrtho(); }
    this.controls.update(); this.invalidate(); this.emit('projection', kind);
  }
  setView(name) {
    const b = this.bounds(); const c = b.getCenter(new THREE.Vector3()); const d = Math.max(this.camera.position.distanceTo(this.controls.target), 0.01);
    const dir = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001] }[name]; if (!dir) return;
    this.controls.target.copy(c); this.camera.position.copy(c).add(new THREE.Vector3(...dir).normalize().multiplyScalar(d)); this.camera.up.set(0, 1, 0);
    this.controls.update(); this.invalidate();
  }
  setOption(name, v) {
    if (name === 'grid') this.grid.visible = !!v; else if (name === 'axes') this.axes.visible = !!v;
    else if (name === 'bbox') { this.bboxHelper.visible = !!v; this.updateBBox(); }
    else if (name === 'background') this.scene.background = new THREE.Color(v);
    else if (name === 'keyLight') this.key.intensity = Number(v); else if (name === 'ambient') this.fill.intensity = Number(v);
    else if (name === 'environment') this.scene.environmentIntensity = Number(v);
    else if (name === 'exposure') this.renderer.toneMappingExposure = Number(v);
    else if (name === 'lightAngle') this.key.position.set(Math.cos(v) * 5, 5, Math.sin(v) * 5);
    this.invalidate();
  }
  updateBBox() { this.bboxHelper.box.copy(this.bounds()); }
  async screenshot() {
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png'); return (await fetch(url)).blob();
  }
  /**
   * A large, clean, smooth picture of the model for a feed post: square, no grid / gizmo / measurements, textured, and framed
   * so the whole model fits from the angle you are looking at it. It is rendered offscreen-sized (the on-screen view is restored
   * straight afterwards), with hardware anti-aliasing — or, where that is missing, at double size and scaled down smoothly.
   * PNG unless that would be too big to upload, then high-quality JPEG.
   */
  async poster(size = 2048, { maxBytes = 8 * 1024 * 1024 } = {}) {
    const r = this.renderer; if (!r) throw new Error('The viewport is not ready.');
    const gl = r.getContext?.(); const cap = Math.min(gl?.getParameter?.(gl.MAX_RENDERBUFFER_SIZE) || 2048, gl?.getParameter?.(gl.MAX_TEXTURE_SIZE) || 2048);
    const target = Math.max(512, Math.min(size, cap, lowMemory() ? 1024 : 4096));
    const msaa = !!gl?.getContextAttributes?.()?.antialias; const px = Math.max(512, Math.min(msaa ? target : target * 2, cap));
    const prevSize = r.getSize(new THREE.Vector2()); const prevRatio = r.getPixelRatio(); const prevMode = this.viewMode; const prevLoads = this._loadMats;
    const hidden = [this.tcHelper, this.selBoxes, this.bboxHelper, this.grid, this.axes, this.measureGroup, this._structure, this._boxGroup].filter(Boolean).map((o) => [o, o.visible]);
    const out = document.createElement('canvas'); out.width = out.height = target;
    try {
      hidden.forEach(([o]) => { o.visible = false; });
      this._loadMats = null; this.viewMode = 'textured'; this.applyViewMode();
      const b = this.bounds(); const centre = b.getCenter(new THREE.Vector3()); const radius = Math.max(b.getSize(new THREE.Vector3()).length() / 2, 1e-4);
      const dir = this.camera.position.clone().sub(this.controls?.target || centre); if (dir.lengthSq() < 1e-12) dir.set(1, 0.7, 1.2); dir.normalize();
      const cam = new THREE.PerspectiveCamera(35, 1, radius / 100, radius * 100); cam.position.copy(centre).addScaledVector(dir, fitDistance(radius, 35)); cam.lookAt(centre); cam.updateMatrixWorld(true);
      r.setPixelRatio(1); r.setSize(px, px, false); r.render(this.scene, cam);
      const g = out.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(r.domElement, 0, 0, target, target);   // must happen before anything awaits
    } finally {
      r.setPixelRatio(prevRatio); r.setSize(prevSize.x, prevSize.y, false);
      hidden.forEach(([o, v]) => { o.visible = v; }); this._loadMats = prevLoads; this.viewMode = prevMode; this.applyViewMode(); this.invalidate();
    }
    const toBlob = (type, q) => new Promise((res) => out.toBlob(res, type, q));
    let blob = await toBlob('image/png'); let type = 'image/png';
    if (blob && blob.size > maxBytes) { blob = await toBlob('image/jpeg', 0.93); type = 'image/jpeg'; }
    if (!blob) throw new Error('Could not render the picture.');
    return { blob, type, width: target, height: target };
  }
  async thumbnail(max = 512) {
    const src = this.renderer.domElement; const k = Math.min(1, max / Math.max(src.width, src.height));
    this.renderer.render(this.scene, this.camera);
    const c = document.createElement('canvas'); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }

  // ---------------------------------------------------------------- measuring
  setMeasureMode(mode) { this.measureMode = mode; this.measurePts = []; if (mode) { this.select([]); this.setGizmo(null); } this.renderer.domElement.style.cursor = mode ? 'crosshair' : ''; }
  drawMeasureMarker(v) { const m = new THREE.Mesh(new THREE.SphereGeometry(this.markerSize || 0.01, 12, 12), new THREE.MeshBasicMaterial({ color: '#ffd84a', depthTest: false })); m.position.copy(v); m.renderOrder = 10; this.measureGroup.add(m); }
  drawMeasureLine(pts) { const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p))); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#ffd84a', depthTest: false })); l.renderOrder = 10; this.measureGroup.add(l); }
  clearMeasure() { this.measureGroup?.clear(); this.measurePts = []; this.invalidate?.(); }

  /** Area / volume / topology of the visible parts in world space (model units → metres via scaleToMeters). */
  analyse() {
    let area = 0, volume = 0, tris = 0, verts = 0, closed = true, boundary = 0, nonManifold = 0, any = false; const textures = new Set();
    for (const p of this.live()) {
      if (!p.visible || !p.object.isMesh) continue; any = true;
      const g = p.object.geometry; const pos = g.getAttribute('position'); const wp = new Float32Array(pos.count * 3); const v = new THREE.Vector3();
      p.object.updateMatrixWorld(true);
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(p.object.matrixWorld); wp[i * 3] = v.x; wp[i * 3 + 1] = v.y; wp[i * 3 + 2] = v.z; }
      const idx = g.index ? Array.from(g.index.array) : undefined;
      area += surfaceArea(wp, idx); volume += Math.abs(signedVolume(wp, idx));
      const t = meshTopology(wp, idx); tris += t.triangles; verts += t.vertices; closed = closed && t.closed; boundary += t.boundaryEdges; nonManifold += t.nonManifoldEdges;
      const m = p.authorMat; if (m?.map?.image) textures.add(`${m.map.image.width}×${m.map.image.height}`);
    }
    const k = this.scaleToMeters;
    return { any, areaM2: area * k * k, volumeM3: closed && any ? volume * k ** 3 : null, closed: any && closed, boundaryEdges: boundary, nonManifoldEdges: nonManifold, triangles: tris, vertices: verts, textures: [...textures] };
  }
  size() { const s = this.bounds().getSize(new THREE.Vector3()); const k = this.scaleToMeters; return { x: s.x * k, y: s.y * k, z: s.z * k }; }
  stats() {
    let tris = 0, verts = 0, points = 0; const tex = new Set();
    for (const p of this.live()) {
      const g = p.object.geometry; const n = g.getAttribute('position').count;
      if (p.object.isPoints) points += n; else { verts += n; tris += (g.index ? g.index.count : n) / 3; }
      const m = p.authorMat; if (m?.map?.image) tex.add(`${m.map.image.width}×${m.map.image.height}`);
    }
    return { parts: this.live().length, triangles: Math.round(tris), vertices: verts, points, textures: [...tex] };
  }
  emitStats() { this.emit('stats', this.stats()); }
  emitParts() { this.emit('parts', this.parts.map((p) => ({ id: p.id, name: p.name, locked: p.locked, visible: p.visible, deleted: p.deleted, group: p.group, kind: p.object.isPoints ? 'points' : 'mesh', tris: p.object.isMesh ? Math.round((p.object.geometry.index ? p.object.geometry.index.count : p.object.geometry.getAttribute('position').count) / 3) : 0 }))); }

  // ---------------------------------------------------------------- geometry tools (work on the current model)
  worldOf(p) { /* parts are direct children of an identity root, so local == world */ return p.object; }
  swapGeometry(p, next, label) {
    const prev = p.object.geometry; p.object.geometry = next; if (p.pointsObj) { p.pointsObj.geometry = next; }
    this.push({ label, undo: () => { p.object.geometry = prev; if (p.pointsObj) p.pointsObj.geometry = prev; }, redo: () => { p.object.geometry = next; if (p.pointsObj) p.pointsObj.geometry = next; } });
    this.afterEdit();
  }
  smooth(id, iterations = 2) {
    const p = this.part(id); if (!p?.object.isMesh || p.locked) throw new Error('Select an unlocked mesh part first.');
    const g = p.object.geometry; const pos = g.getAttribute('position'); const idx = g.index ? Array.from(g.index.array) : undefined;
    if (pos.count > 150000) throw new Error('This part is too large to smooth in the browser (150k vertices max). Simplify it first.');
    const r = laplacianSmooth(pos.array, idx, iterations, 0.5);
    const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.BufferAttribute(r.positions, 3)); ng.setIndex(r.indices); ng.computeVertexNormals();
    this.swapGeometry(p, ng, 'Smooth');
  }
  subdivide(id) {
    const p = this.part(id); if (!p?.object.isMesh || p.locked) throw new Error('Select an unlocked mesh part first.');
    const g = p.object.geometry; const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    if (tris * 4 > 400000) throw new Error('Subdividing would exceed 400k triangles. Simplify first.');
    const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.BufferAttribute(subdivideFlat(g.getAttribute('position').array, g.index ? g.index.array : undefined), 3)); ng.computeVertexNormals();
    this.swapGeometry(p, ng, 'Subdivide');
  }
  async simplify(id, ratio) {
    const p = this.part(id); if (!p?.object.isMesh || p.locked) throw new Error('Select an unlocked mesh part first.');
    const g = p.object.geometry; const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    if (tris < 200) throw new Error('This part is already very simple.');
    if (tris > 120000) throw new Error('This part is too large to simplify in the browser (120k triangles max). Reduce it with the export budget instead.');
    await new Promise((r) => setTimeout(r, 30));                       // let the "working" state paint
    let src = g.clone(); src.deleteAttribute('normal'); src.deleteAttribute('uv'); src = mergeVertices(src, 1e-5);
    const remove = Math.floor(src.getAttribute('position').count * (1 - ratio));
    const out = new SimplifyModifier().modify(src, remove); out.computeVertexNormals();
    this.swapGeometry(p, out, 'Simplify');
  }
  repair(id) {
    const p = this.part(id); if (!p?.object.isMesh || p.locked) throw new Error('Select an unlocked mesh part first.');
    let g = p.object.geometry.clone(); g.deleteAttribute('normal'); g = mergeVertices(g, 1e-5); g.computeVertexNormals();
    this.swapGeometry(p, g, 'Repair'); return meshTopology(g.getAttribute('position').array, g.index ? Array.from(g.index.array) : undefined);
  }
  /** Split one mesh into its disconnected pieces. Honest limit: only pieces that are NOT connected to each other can be separated. */
  split(id) {
    const p = this.part(id); if (!p?.object.isMesh || p.locked) throw new Error('Select an unlocked mesh part first.');
    const g = p.object.geometry; const pos = g.getAttribute('position'); const idx = g.index ? Array.from(g.index.array) : undefined;
    if (pos.count > 300000) throw new Error('This part is too large to analyse in the browser.');
    const comps = connectedComponents(pos.array, idx);
    if (comps.length < 2) return 0;
    const src = g.index ? g : g;
    const triVerts = (t) => (idx ? [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]] : [t * 3, t * 3 + 1, t * 3 + 2]);
    const made = [];
    const attrs = Object.keys(src.attributes);
    comps.slice(0, 40).forEach((tris, n) => {
      const ng = new THREE.BufferGeometry();
      for (const a of attrs) {
        const at = src.getAttribute(a); const arr = new at.array.constructor(tris.length * 3 * at.itemSize);
        tris.forEach((t, i) => triVerts(t).forEach((v, k) => { for (let c = 0; c < at.itemSize; c++) arr[(i * 3 + k) * at.itemSize + c] = at.array[v * at.itemSize + c]; }));
        ng.setAttribute(a, new THREE.BufferAttribute(arr, at.itemSize, at.normalized));
      }
      const o = new THREE.Mesh(ng, p.authorMat.clone()); o.position.copy(p.object.position); o.quaternion.copy(p.object.quaternion); o.scale.copy(p.object.scale);
      o.userData = { partId: uid() }; this.modelRoot.add(o); made.push(this.addPart(o, `${p.name} piece ${n + 1}`));
    });
    const was = p.deleted; p.deleted = true; p.object.visible = false; this.selected.delete(p.id);
    this.push({
      label: 'Split',
      undo: () => { made.forEach((m) => { this.modelRoot.remove(m.object); this.parts = this.parts.filter((x) => x !== m); }); p.deleted = was; p.object.visible = p.visible; },
      redo: () => { made.forEach((m) => { this.modelRoot.add(m.object); this.parts.push(m); }); p.deleted = true; p.object.visible = false; },
    });
    this.applyViewMode(); this.select(made.map((m) => m.id)); this.afterEdit(); return made.length;
  }

  // ---------------------------------------------------------------- state (parts / transforms / materials) for variants & autosave
  captureState() {
    return {
      v: 1, scaleToMeters: this.scaleToMeters,
      parts: this.parts.map((p) => ({ id: p.id, name: p.name, visible: p.visible, locked: p.locked, deleted: p.deleted, group: p.group, ...this.transformOf(p), mat: this.materialOf(p) })),
    };
  }
  applyState(s) {
    if (!s?.parts) return;
    if (Number.isFinite(s.scaleToMeters)) this.scaleToMeters = s.scaleToMeters;
    for (const d of s.parts) {
      const p = this.part(d.id); if (!p) continue;               // parts that no longer exist (geometry was split/replaced) are skipped
      p.name = d.name ?? p.name; p.visible = d.visible !== false; p.locked = !!d.locked; p.deleted = !!d.deleted; p.group = d.group ?? null; p.object.visible = p.visible && !p.deleted;
      p.object.position.set(...(d.pos || [0, 0, 0])); p.object.rotation.set(...(d.rot || [0, 0, 0]).map((x) => THREE.MathUtils.degToRad(x))); p.object.scale.set(...(d.scale || [1, 1, 1]));
      if (d.mat && p.authorMat) { const m = p.authorMat; m.color.set(d.mat.color); m.metalness = d.mat.metalness; m.roughness = d.mat.roughness; m.opacity = d.mat.opacity; m.transparent = d.mat.opacity < 1; m.depthWrite = d.mat.opacity >= 1; p.preset = d.mat.preset; if (m.map) { m.map.repeat.set(d.mat.repeat || 1, d.mat.repeat || 1); m.map.rotation = THREE.MathUtils.degToRad(d.mat.rotation || 0); } m.needsUpdate = true; }
    }
    this.modelRoot.updateMatrixWorld(true); this.applyViewMode(); this.select([...this.selected].filter((i) => this.part(i) && !this.part(i).deleted));
    this.emitParts(); this.emitStats(); this.invalidate();
  }
  /** Lightweight ghost of a state, for before/after comparison: returns a function that restores the live state. */
  withState(s, fn) { const keep = this.captureState(); this.applyState(s); try { return fn(); } finally { this.applyState(keep); } }

  // ---------------------------------------------------------------- export
  exportGroup({ maxTriangles = 0, all = false } = {}) {
    const group = new THREE.Group(); group.name = 'CHEX scan';
    const live = all ? this.parts : this.live().filter((p) => p.visible); let tris = 0;
    live.forEach((p) => { const g = p.object.geometry; tris += p.object.isMesh ? (g.index ? g.index.count : g.getAttribute('position').count) / 3 : 0; });
    const ratio = maxTriangles && tris > maxTriangles ? maxTriangles / tris : 1;
    for (const p of live) {
      const c = p.object.clone(false); c.name = p.name; c.userData = { ...p.object.userData, partName: p.name, group: p.group || undefined };
      if (c.isMesh) c.material = p.authorMat;
      c.visible = true;
      group.add(c);
      c.position.copy(p.object.position); c.quaternion.copy(p.object.quaternion); c.scale.copy(p.object.scale);
    }
    group.updateMatrixWorld(true); return { group, ratio, tris };
  }
  async exportModel(format, { maxTriangles = 0, onProgress, all = false } = {}) {
    const { group, ratio } = this.exportGroup({ maxTriangles, all });
    if (!group.children.length) throw new Error('There is nothing visible to export.');
    if (ratio < 1) {
      let i = 0;
      for (const c of group.children) {
        if (c.isMesh) {
          const g = c.geometry; const n = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
          if (n > 300 && n <= 150000) { let s = g.clone(); s.deleteAttribute('normal'); s.deleteAttribute('uv'); s = mergeVertices(s, 1e-5); const out = new SimplifyModifier().modify(s, Math.floor(s.getAttribute('position').count * (1 - ratio))); out.computeVertexNormals(); c.geometry = out; }
        }
        onProgress?.(++i / group.children.length); await new Promise((r) => setTimeout(r, 0));
      }
    }
    const f = format.toLowerCase();
    if (f === 'glb' || f === 'gltf') {
      const res = await new GLTFExporter().parseAsync(group, { binary: f === 'glb', onlyVisible: !all, maxTextureSize: 4096 });
      return f === 'glb' ? new Blob([res], { type: 'model/gltf-binary' }) : new Blob([JSON.stringify(res)], { type: 'model/gltf+json' });
    }
    if (f === 'obj') return new Blob([new OBJExporter().parse(group)], { type: 'text/plain' });
    if (f === 'stl') return new Blob([new STLExporter().parse(group, { binary: true })], { type: 'model/stl' });
    if (f === 'ply') return new Promise((resolve, reject) => { try { new PLYExporter().parse(group, (r) => resolve(new Blob([r], { type: 'application/octet-stream' })), { binary: true }); } catch (e) { reject(e); } });
    throw new Error('Unknown export format.');
  }

  // ---------------------------------------------------------------- simplified physics + animation
  startSim({ fixedIds = [], restitution = 0.25, gravity = -9.81, friction = 0.9, timeScale = 1, autoPause = true } = {}) {
    this.stopSim(); this.select([]); this.setGizmo(null);
    const live = this.live().filter((p) => p.visible && p.object.isMesh); if (!live.length) throw new Error('There is nothing to simulate.');
    const k = this.scaleToMeters; const b0 = this.bounds();
    const initial = new Map(live.map((p) => [p.id, this.snapshotObject(p.object)]));
    const bodies = live.map((p) => { const bb = new THREE.Box3().setFromObject(p.object); return makeBody({ id: p.id, min: bb.min.toArray(), max: bb.max.toArray(), mass: Math.max(1e-6, bb.getSize(new THREE.Vector3()).toArray().reduce((a, c) => a * c, 1)) , fixed: fixedIds.includes(p.id) }); });
    const origin = bodies.map((b) => [...b.pos]);
    // Lift the whole model a little so there is something to see fall.
    const lift = (b0.max.y - b0.min.y) * 0.25 + 0.05 / Math.max(k, 1e-6);
    bodies.forEach((b) => { if (!b.fixed) b.pos[1] += lift; });
    const begin = bodies.map((b) => [...b.pos]);
    this.sim = { bodies, origin, begin, initial, opts: { restitution, friction, gravity: gravity / Math.max(k, 1e-6), ground: b0.min.y }, timeScale, autoPause, settledFor: 0, playing: false, t: 0 };
    this.rebuildBoxes(); this.applySim(); this.emit('sim', { playing: false }); return bodies.length;
  }
  applySim() {
    const s = this.sim; if (!s) return;
    s.bodies.forEach((b, i) => {
      const p = this.part(b.id); if (!p) return; const base = s.initial.get(b.id).p;
      p.object.position.set(base[0] + b.pos[0] - s.origin[i][0], base[1] + b.pos[1] - s.origin[i][1], base[2] + b.pos[2] - s.origin[i][2]);
    });
    this._boxGroup?.children.forEach((l, i) => { const b = s.bodies[i]; if (b) l.position.set(b.pos[0], b.pos[1], b.pos[2]); });
    this.modelRoot.updateMatrixWorld(true); this.invalidate();
  }
  /** Change gravity / bounce / friction / speed while the simulation is set up (or running). */
  updateSim({ gravity, restitution, friction, timeScale, autoPause } = {}) {
    const s = this.sim; if (!s) return; const k = Math.max(this.scaleToMeters, 1e-6);
    if (gravity !== undefined) s.opts.gravity = -Math.abs(gravity) / k;
    if (restitution !== undefined) s.opts.restitution = restitution;
    if (friction !== undefined) s.opts.friction = friction;
    if (timeScale !== undefined) s.timeScale = Math.min(3, Math.max(0.05, timeScale));
    if (autoPause !== undefined) s.autoPause = !!autoPause;
  }
  /** Give a part a quick shove: `dv` is a speed change in m/s along `dir`. Starts playing if the simulation was paused. */
  nudge(id, dir, dv = 2) {
    const s = this.sim; if (!s) throw new Error('Set up the simulation first, then push a part.');
    const b = s.bodies.find((x) => x.id === id); if (!b) throw new Error('That part is not in the simulation.');
    if (b.fixed) throw new Error('That part is set to stay fixed, so it will not move. Un-tick “Keep selected fixed” and set up again.');
    applyImpulse(b, dir, dv / Math.max(this.scaleToMeters, 1e-6)); s.settledFor = 0;
    if (!s.playing) this.playSim(true); return true;
  }
  setPoke(on, strength) { this.pokeMode = !!on; if (strength !== undefined) this.pokeStrength = strength; if (this.renderer) this.renderer.domElement.style.cursor = on && this.sim ? 'pointer' : ''; }
  /** Show / hide the boxes the simulation actually collides (they are only boxes — that is the whole model). */
  showBoxes(on) { this._boxesOn = !!on; this.rebuildBoxes(); this.invalidate(); }
  rebuildBoxes() {
    if (this._boxGroup) { this._boxGroup.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); this.scene.remove(this._boxGroup); this._boxGroup = null; }
    if (!this._boxesOn || !this.sim) return;
    this._boxGroup = new THREE.Group();
    for (const b of this.sim.bodies) { const l = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(b.half[0] * 2, b.half[1] * 2, b.half[2] * 2)), new THREE.LineBasicMaterial({ color: b.fixed ? '#ffd84a' : '#5cf2c8', depthTest: false, transparent: true, opacity: 0.85 })); l.renderOrder = 9; l.position.set(...b.pos); this._boxGroup.add(l); }
    this.scene.add(this._boxGroup);
  }
  _simStats() { const s = this.sim; if (!s) return null; return { t: s.t, moving: movingCount(s.bodies, 0.05 / Math.max(this.scaleToMeters, 1e-6)), total: s.bodies.filter((b) => !b.fixed).length }; }
  playSim(on = true) {
    const s = this.sim; if (!s) return; s.playing = on; this.emit('sim', { playing: on }); cancelAnimationFrame(this._simRaf);
    if (!on) return; let last = performance.now(); this._statTick = 0; s.settledFor = 0;
    const loop = (now) => {
      if (!this.sim?.playing || this._disposed) return;
      const dt = Math.min(0.033, (now - last) / 1000) * (s.timeScale || 1); last = now;
      const n = Math.max(1, Math.ceil(dt / (1 / 60))); for (let i = 0; i < n; i++) stepWorld(s.bodies, dt / n, s.opts);
      s.t += dt; this.applySim();
      const st = this._simStats(); if (++this._statTick % 6 === 0) this.emit('sim-stats', st);
      if (s.autoPause) { s.settledFor = st.moving === 0 && s.t > 0.3 ? s.settledFor + dt : 0; if (s.settledFor > 1) { this.emit('sim-stats', st); this.playSim(false); this.emit('sim', { playing: false, settled: true }); return; } }
      this._simRaf = requestAnimationFrame(loop);
    };
    this._simRaf = requestAnimationFrame(loop);
  }
  resetSim() {
    const s = this.sim; if (!s) return; cancelAnimationFrame(this._simRaf); s.playing = false; s.t = 0; s.settledFor = 0;
    s.bodies.forEach((b, i) => { b.pos = [...s.begin[i]]; b.vel = [0, 0, 0]; });
    this.applySim(); this.emit('sim', { playing: false }); this.emit('sim-stats', this._simStats()); this.invalidate();
  }
  stopSim() {
    cancelAnimationFrame(this._simRaf); this.setPoke(false);
    if (this.sim) { for (const [id, snap] of this.sim.initial) { const p = this.part(id); if (p) { p.object.position.fromArray(snap.p); p.object.quaternion.fromArray(snap.q); p.object.scale.fromArray(snap.s); } } this.sim = null; this.emit('sim', { playing: false, stopped: true }); }
    this.rebuildBoxes?.(); this.stopAnim?.(); this.invalidate?.();
  }
  /** Hinge demo: swing one part about an edge of its own bounding box. `axis` is 'x'|'y'|'z'; the pivot is the min edge on the perpendicular side. */
  startHinge(id, axis = 'y', amplitudeDeg = 60) {
    const p = this.part(id); if (!p?.object.isMesh) throw new Error('Select a part to use as the door / lid first.');
    this.stopAnim(); const bb = new THREE.Box3().setFromObject(p.object); const pivot = new THREE.Vector3(bb.min.x, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2);
    if (axis === 'x') pivot.set((bb.min.x + bb.max.x) / 2, bb.min.y, (bb.min.z + bb.max.z) / 2); if (axis === 'z') pivot.set((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, bb.min.z);
    const snap = this.snapshotObject(p.object); const ax = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
    this.anim.hinge = { p, snap, pivot, ax, amplitudeDeg }; this.playAnim(true);
  }
  setKey(id, t) { const p = this.part(id); if (!p) return; const list = (this.anim.keys[id] ||= []); const tr = this.transformOf(p); const key = { t, pos: tr.pos, rot: tr.rot.map((d) => THREE.MathUtils.degToRad(d)), scale: tr.scale }; const i = list.findIndex((k) => Math.abs(k.t - t) < 0.05); if (i >= 0) list[i] = key; else list.push(key); list.sort((a, b) => a.t - b.t); this.emit('anim', this.anim); }
  clearKeys(id) { if (id) delete this.anim.keys[id]; else this.anim.keys = {}; this.emit('anim', this.anim); }
  setAnimTime(t) { this.anim.t = t; this.applyAnim(); }
  applyAnim() {
    const a = this.anim;
    if (a.hinge) { const { p, snap, pivot, ax, amplitudeDeg } = a.hinge; const ang = hingeAngle(a.t, amplitudeDeg); const q = new THREE.Quaternion().setFromAxisAngle(ax, ang); const base = new THREE.Vector3().fromArray(snap.p).sub(pivot).applyQuaternion(q).add(pivot); p.object.position.copy(base); p.object.quaternion.copy(q).multiply(new THREE.Quaternion().fromArray(snap.q)); }
    if (a.joint) {
      const { kind, p, snap, pivot, ax, travel, amp } = a.joint; const base = new THREE.Vector3().fromArray(snap.p); const q0 = new THREE.Quaternion().fromArray(snap.q);
      if (kind === 'slider') { p.object.position.copy(base).addScaledVector(ax, sliderOffset(a.t, travel)); p.object.quaternion.copy(q0); }
      else { const [rx, rz] = ballAngles(a.t, amp); const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)); p.object.position.copy(base.sub(pivot).applyQuaternion(q).add(pivot)); p.object.quaternion.copy(q).multiply(q0); }
    }
    for (const [id, keys] of Object.entries(a.keys)) { const s = sampleKeys(keys, a.t, a.easing); const p = this.part(id); if (s && p) { p.object.position.set(...s.pos); p.object.rotation.set(...s.rot); p.object.scale.set(...s.scale); } }
    this.modelRoot.updateMatrixWorld(true); this.invalidate();
  }
  playAnim(on = true) {
    const a = this.anim; a.playing = on; this.emit('anim', a); cancelAnimationFrame(this._animRaf); if (!on) return; let last = performance.now();
    const loop = (now) => {
      if (!a.playing || this._disposed) return; a.t += ((now - last) / 1000) * (a.speed || 1); last = now;
      let done = false;
      if (!a.hinge && !a.joint && a.t > a.duration) { if (a.loop) a.t %= a.duration || 1; else { a.t = a.duration; a.playing = false; done = true; } }
      this.applyAnim(); this.emit('anim-time', a.t); if (done) this.emit('anim', a); else this._animRaf = requestAnimationFrame(loop);
    };
    this._animRaf = requestAnimationFrame(loop);
  }
  stopAnim() {
    const a = this.anim; cancelAnimationFrame(this._animRaf); a.playing = false;
    for (const key of ['hinge', 'joint']) if (a[key]) { const { p, snap } = a[key]; p.object.position.fromArray(snap.p); p.object.quaternion.fromArray(snap.q); a[key] = null; }
    this.emit('anim', a); this.invalidate?.();
  }
  /** Slider (drawer) or ball (joystick) joint demo. slider: `amount` = travel as % of the part's size along `axis`; ball: `amount` = tilt in degrees. */
  startJoint(id, kind = 'slider', axis = 'x', amount = 50) {
    const p = this.part(id); if (!p?.object.isMesh) throw new Error('Select a part to move first (a drawer, a joystick…).');
    if (!['slider', 'ball'].includes(kind)) throw new Error('Unknown joint type.');
    this.stopAnim(); const bb = new THREE.Box3().setFromObject(p.object); const size = bb.getSize(new THREE.Vector3());
    const ax = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
    const pivot = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.min.y, (bb.min.z + bb.max.z) / 2);   // ball joint sits under the part
    this.anim.joint = { kind, p, snap: this.snapshotObject(p.object), pivot, ax, travel: size.getComponent('xyz'.indexOf(axis)) * (amount / 100), amp: amount };
    this.playAnim(true);
  }
  resetAnim() { this.stopAnim(); this.anim.t = 0; this.applyAnim(); this.emit('anim-time', 0); }
  setAnimOptions({ duration, loop, speed, easing } = {}) {
    const a = this.anim;
    if (duration !== undefined) { a.duration = Math.min(60, Math.max(1, duration)); if (a.t > a.duration) { a.t = a.duration; this.applyAnim(); this.emit('anim-time', a.t); } }
    if (loop !== undefined) a.loop = !!loop;
    if (speed !== undefined) a.speed = Math.min(4, Math.max(0.1, speed));
    if (easing !== undefined) a.easing = easing;
    this.emit('anim', a);
  }
  deleteKey(id, index) { const list = this.anim.keys[id]; if (!list || !list[index]) return; list.splice(index, 1); if (!list.length) delete this.anim.keys[id]; this.emit('anim', this.anim); }

  // ---------------------------------------------------------------- structural visualisation (geometry only — NOT stress analysis)
  _boxesOfParts() {
    return this.live().filter((p) => p.visible && p.object.isMesh).map((p) => { const bb = new THREE.Box3().setFromObject(p.object); const sz = bb.getSize(new THREE.Vector3()); return { p, body: makeBody({ id: p.id, min: bb.min.toArray(), max: bb.max.toArray(), mass: Math.max(1e-9, sz.x * sz.y * sz.z) }) }; });
  }
  /** Balance + load-path check of the model as it stands right now. Returns numbers in metres; nothing is drawn until showStructure(). */
  analyseStructure() {
    const items = this._boxesOfParts(); if (!items.length) throw new Error('There is nothing visible to analyse.');
    const bodies = items.map((i) => i.body); const b0 = this.bounds(); const k = this.scaleToMeters; const tol = Math.max(b0.getSize(new THREE.Vector3()).y * 0.01, 1e-6);
    const st = stability(bodies, { ground: b0.min.y, tol }); const loads = stackLoads(bodies, tol);
    return { ...st, k, tol, ground: b0.min.y, parts: items.map((i, n) => ({ id: i.p.id, name: i.p.name, ...loads[n] })), marginM: st.margin * k, comHeightM: st.comHeight * k };
  }
  /** Draw (or clear) the centre of mass, footprint and a blue→red tint showing how much weight rests on each part. */
  showStructure({ com = true, loads = true } = {}, on = true) {
    this.clearStructure(); if (!on) return null;
    const r = this.analyseStructure(); this._structure = new THREE.Group(); this.scene.add(this._structure);
    if (com && r.com) {
      const size = Math.max(this.bounds().getSize(new THREE.Vector3()).length() * 0.02, 1e-4);
      const m = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 16), new THREE.MeshBasicMaterial({ color: r.stable ? '#5cf2c8' : '#ff5c7a', depthTest: false })); m.position.set(...r.com); m.renderOrder = 11; this._structure.add(m);
      const drop = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...r.com), new THREE.Vector3(r.com[0], r.ground, r.com[2])]), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: size, gapSize: size, depthTest: false })); drop.computeLineDistances(); drop.renderOrder = 11; this._structure.add(drop);
      if (r.support) { const { min, max } = r.support; const y = r.ground + 1e-4; const pts = [[min[0], y, min[1]], [max[0], y, min[1]], [max[0], y, max[1]], [min[0], y, max[1]], [min[0], y, min[1]]].map((a) => new THREE.Vector3(...a)); const f = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: r.stable ? '#5cf2c8' : '#ff5c7a', depthTest: false })); f.renderOrder = 11; this._structure.add(f); }
    }
    if (loads) {
      this._loadMats = new Map(); const peak = Math.max(...r.parts.map((p) => p.rel), 1e-9);
      for (const p of r.parts) this._loadMats.set(p.id, new THREE.MeshStandardMaterial({ color: heatColor(p.rel / peak), roughness: 0.6, metalness: 0.05 }));
      if (this.viewMode !== 'textured') this.setViewMode('textured'); else this.applyViewMode();
    }
    this.invalidate(); return r;
  }
  clearStructure() {
    if (this._structure) { this._structure.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); this.scene?.remove(this._structure); this._structure = null; }
    if (this._loadMats) { this._loadMats.forEach((m) => m.dispose()); this._loadMats = null; this.applyViewMode(); }
    this.invalidate?.();
  }

  // ---------------------------------------------------------------- material appearance comparison
  _preset(p, name) {
    if (name === 'Original') { const o = p.origMat; return { color: `#${o.color.getHexString()}`, metalness: o.metalness, roughness: o.roughness, opacity: o.opacity }; }
    return { opacity: 1, ...MATERIAL_PRESETS[name] };
  }
  _paint(m, v) {
    if (v.color !== undefined) m.color.set(v.color); if (v.metalness !== undefined) m.metalness = v.metalness; if (v.roughness !== undefined) m.roughness = v.roughness;
    if (v.opacity !== undefined) { m.opacity = v.opacity; m.transparent = v.opacity < 1; m.depthWrite = v.opacity >= 1; } m.needsUpdate = true;
  }
  _matTargets(ids) { return (ids?.length ? ids.map((i) => this.part(i)) : this.live().filter((p) => p.visible)).filter((p) => p && p.object.isMesh && !p.locked && p.authorMat); }
  /** Temporarily show a preset on the given parts (or every visible part) WITHOUT touching undo history. */
  previewMaterial(name, ids) {
    this.revertMaterialPreview(); if (!(name in MATERIAL_PRESETS)) return 0;
    const targets = this._matTargets(ids); if (!targets.length) return 0;
    this._mp = { name, on: true, items: targets.map((p) => ({ p, before: this.matSnapshot(p.authorMat) })) };
    for (const { p } of this._mp.items) this._paint(p.authorMat, this._preset(p, name));
    this.applyViewMode(); this.emit('matpreview', { name, on: true, count: targets.length }); this.invalidate(); return targets.length;
  }
  /** Flip between the preview and the untouched materials (A/B). */
  togglePreviewCompare() {
    const mp = this._mp; if (!mp) return false; mp.on = !mp.on;
    for (const { p, before } of mp.items) { if (mp.on) this._paint(p.authorMat, this._preset(p, mp.name)); else this.matRestore(p.authorMat, before); }
    this.applyViewMode(); this.emit('matpreview', { name: mp.name, on: mp.on, count: mp.items.length }); this.invalidate(); return mp.on;
  }
  revertMaterialPreview() {
    const mp = this._mp; if (!mp) return; this._mp = null;
    for (const { p, before } of mp.items) this.matRestore(p.authorMat, before);
    this.emit('matpreview', null); this.invalidate();
  }
  /** Keep the previewed material as a normal (undoable) edit. */
  commitMaterialPreview() {
    const mp = this._mp; if (!mp) return 0; const { name, items } = mp; this.revertMaterialPreview();
    for (const { p } of items) this.applyPreset(p.id, name); return items.length;
  }
  /** Render the model once per preset and return small side-by-side pictures. Nothing is kept: every material is restored. */
  materialSheet(names, ids, width = 200) {
    const targets = this._matTargets(ids); if (!targets.length) throw new Error('There is nothing to preview materials on.');
    this.revertMaterialPreview(); const before = targets.map((p) => this.matSnapshot(p.authorMat)); const src = this.renderer.domElement;
    const k = width / Math.max(1, src.width); const c = document.createElement('canvas'); c.width = width; c.height = Math.max(1, Math.round(src.height * k)); const g = c.getContext('2d'); const out = [];
    const hide = [this.tcHelper, this.selBoxes, this.bboxHelper].map((o) => [o, o?.visible]); hide.forEach(([o]) => { if (o) o.visible = false; });
    try {
      for (const name of names) {
        if (!(name in MATERIAL_PRESETS)) continue;
        targets.forEach((p) => this._paint(p.authorMat, this._preset(p, name))); this.applyViewMode();
        this.renderer.render(this.scene, this.camera); g.clearRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height); out.push({ name, url: c.toDataURL('image/jpeg', 0.82) });
      }
    } finally { targets.forEach((p, i) => this.matRestore(p.authorMat, before[i])); hide.forEach(([o, v]) => { if (o) o.visible = v; }); this.applyViewMode(); this.invalidate(); }
    return out;
  }
}
