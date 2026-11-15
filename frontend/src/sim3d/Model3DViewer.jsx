import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clampParams, prepareModel, fillPositions, blendSeamNormals, extents, textureFromCutout, TEXTURE_SIZE } from './model3d.js';

const FINISH = { matte: { roughness: 0.85, metalness: 0 }, glossy: { roughness: 0.22, metalness: 0.05 }, metal: { roughness: 0.28, metalness: 0.95 } };
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Decode a cut-out PNG (URL) into a canvas, capped at TEXTURE_SIZE.
function loadCutoutCanvas(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const k = Math.min(1, TEXTURE_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c);
    };
    img.onerror = () => reject(new Error('Could not load the 3D object.'));
    img.src = url;
  });
}

/**
 * The actual WebGL scene. `source` is { canvas } (an RGBA cut-out canvas) or { url } (a cut-out PNG).
 * Drag to rotate all the way round, pinch / wheel to zoom (wheel zoom is off when `lockScroll`, so
 * a feed can still scroll past it). Imperative: ref.setView('front' | 'side' | 'back' | 'top').
 */
const Scene3D = forwardRef(function Scene3D({ source, params, lockScroll = false, onReady, onError }, ref) {
  const mountRef = useRef(null);
  const S = useRef({});            // three.js objects, kept out of React state
  const paramsRef = useRef(params); paramsRef.current = clampParams(params);
  const cb = useRef({}); cb.current = { onReady, onError };

  // 1) renderer, camera, lights, controls, render loop — once
  useEffect(() => {
    const mount = mountRef.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
    catch { cb.current.onError?.(new Error('3D is not available on this device.')); return undefined; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;outline:none';
    renderer.domElement.setAttribute('aria-label', '3D object. Drag to rotate.');
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2.5, 3, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9db8ff, 0.8); rim.position.set(-3, 1.5, -3.5); scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0.9, 0.5, 5.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 1.5; controls.maxDistance = 14; controls.rotateSpeed = 0.9;
    let resume;
    controls.addEventListener('start', () => { clearTimeout(resume); controls.autoRotate = false; S.current.tween = null; });
    controls.addEventListener('end', () => { clearTimeout(resume); resume = setTimeout(() => { controls.autoRotate = paramsRef.current.spin && !reducedMotion(); }, 2500); });

    const resize = () => {
      const w = mount.clientWidth || 1, h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(mount); resize();

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const tw = S.current.tween;
      if (tw) {
        tw.t = Math.min(1, tw.t + 0.07);
        const e = 1 - Math.pow(1 - tw.t, 3);
        camera.position.copy(tw.from).lerp(tw.to, e).setLength(tw.from.length() + (tw.to.length() - tw.from.length()) * e);
        if (tw.t >= 1) S.current.tween = null;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    Object.assign(S.current, { renderer, scene, camera, controls, pmrem, ro, resume: () => clearTimeout(resume) });
    return () => {
      cancelAnimationFrame(raf); clearTimeout(resume); ro.disconnect(); controls.dispose();
      const { mesh, texture } = S.current;
      if (mesh) { mesh.geometry.dispose(); mesh.material.dispose(); scene.remove(mesh); }
      texture?.dispose();
      scene.environment?.dispose(); pmrem.dispose();
      renderer.dispose(); renderer.forceContextLoss?.();
      renderer.domElement.remove();
      S.current = {};
    };
  }, []);

  // 2) (re)build the model whenever the cut-out changes
  const sourceKey = source?.canvas ? source.version : source?.url;
  useEffect(() => {
    const s = S.current;
    if (!s.renderer || !source) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const canvas = source.canvas || await loadCutoutCanvas(source.url);
        if (cancelled || !S.current.renderer) return;
        const w = canvas.width, h = canvas.height;
        const rgba = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
        const prep = prepareModel(rgba, w, h);
        if (!prep.objectCells) throw new Error('No object found in this picture.');
        const positions = new Float32Array(prep.vertexCount * 3);
        fillPositions(prep, paramsRef.current, positions);

        const geo = new THREE.BufferGeometry();
        const attr = new THREE.BufferAttribute(positions, 3); attr.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('position', attr);
        geo.setAttribute('uv', new THREE.BufferAttribute(prep.uvs, 2));
        geo.setIndex(new THREE.BufferAttribute(prep.index, 1));
        geo.computeVertexNormals(); blendSeamNormals(geo.attributes.normal.array, prep); geo.computeBoundingSphere();

        const texture = new THREE.CanvasTexture(textureFromCutout(canvas));
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, s.renderer.capabilities.getMaxAnisotropy());
        const material = new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, material);

        if (s.mesh) { s.mesh.geometry.dispose(); s.mesh.material.dispose(); s.scene.remove(s.mesh); }
        s.texture?.dispose();
        s.scene.add(mesh);
        Object.assign(s, { mesh, texture, prep, positions, material });

        // frame the object
        const [ex, ey, ez] = extents(positions);
        const halfV = (s.camera.fov * Math.PI) / 360;                       // half the vertical field of view
        const halfMin = Math.min(halfV, Math.atan(Math.tan(halfV) * s.camera.aspect));
        const fit = (Math.hypot(ex, ey, ez) / Math.sin(halfMin)) * 1.04;    // whole object stays in view from every angle
        s.fitDistance = fit;
        s.camera.position.set(0.35, 0.18, 1).setLength(fit);
        s.controls.target.set(0, 0, 0); s.controls.update();
        applyLook();
        cb.current.onReady?.();
      } catch (e) { if (!cancelled) cb.current.onError?.(e); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  // 3) shape + look from the settings
  const applyLook = () => {
    const s = S.current, p = paramsRef.current;
    if (!s.mesh) return;
    const f = FINISH[p.finish];
    const m = s.material;
    m.roughness = f.roughness; m.metalness = f.metalness;
    const tint = new THREE.Color(p.tint);
    if (p.clay) { m.map = null; m.color.set(p.tintAmount > 0 ? p.tint : '#d8d0c4'); }
    else { m.map = s.texture; m.color.set(0xffffff).lerp(tint, p.tintAmount); }
    m.wireframe = p.wireframe;
    m.needsUpdate = true;
    s.scene.background = new THREE.Color(p.bg);
    s.controls.autoRotate = p.spin && !reducedMotion() && !s.tween;
    s.controls.autoRotateSpeed = p.spinSpeed * 2;
    s.controls.enableZoom = !lockScroll;
    s.renderer.domElement.style.touchAction = lockScroll ? 'pan-y' : 'none';
  };
  useEffect(() => {
    const s = S.current;
    if (!s.mesh) return;
    fillPositions(s.prep, paramsRef.current, s.positions);
    s.mesh.geometry.attributes.position.needsUpdate = true;
    s.mesh.geometry.computeVertexNormals(); blendSeamNormals(s.mesh.geometry.attributes.normal.array, s.prep); s.mesh.geometry.attributes.normal.needsUpdate = true; s.mesh.geometry.computeBoundingSphere();
    applyLook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, lockScroll]);

  useImperativeHandle(ref, () => ({
    setView(name) {
      const s = S.current; if (!s.camera) return;
      const d = s.fitDistance || 5;
      const to = { front: [0, 0, 1], side: [1, 0, 0], back: [0, 0, -1], top: [0, 1, 0.001] }[name] || [0, 0, 1];
      s.controls.autoRotate = false;
      s.tween = { from: s.camera.position.clone(), to: new THREE.Vector3(...to).setLength(d), t: 0 };
    },
  }));

  return <div ref={mountRef} className="sim-canvas" />;
});

/**
 * Public viewer. Give it `url` (a posted cut-out) or `canvas` (+ `version`, bumped when the canvas
 * is redrawn) and the settings. With `lazy` (feeds) the 3D scene only exists while the post is on
 * screen — otherwise a still picture is shown — so a long feed never runs out of WebGL contexts.
 */
const Model3DViewer = forwardRef(function Model3DViewer({ url, canvas, version = 0, params, lazy = false, lockScroll = false, className = '', style, onReady }, ref) {
  const p = clampParams(params);
  const wrapRef = useRef(null);
  const [visible, setVisible] = useState(!lazy);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!lazy) return undefined;
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return undefined; }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '150px' });
    io.observe(el);
    return () => io.disconnect();
  }, [lazy]);
  useEffect(() => { if (!visible) setReady(false); }, [visible]);

  const source = canvas ? { canvas, version } : url ? { url } : null;
  return (
    <div ref={wrapRef} className={`sim-viewer ${className}`} style={{ background: p.bg, ...style }}>
      {url && !ready && <img className="sim-poster" src={url} alt="" draggable={false} />}
      {visible && !error && source && (
        <Scene3D ref={ref} source={source} params={params} lockScroll={lockScroll}
          onReady={() => { setReady(true); onReady?.(); }} onError={(e) => setError(e?.message || '3D is not available here.')} />
      )}
      {visible && !ready && !error && <div className="sim-loading" role="status">Building 3D…</div>}
      {error && <div className="sim-error" role="alert">{error}</div>}
    </div>
  );
});

export default Model3DViewer;
