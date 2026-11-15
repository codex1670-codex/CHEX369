import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Interactive viewer for a model published from the 3D Scanning Studio. The post's thumbnail is shown first and the
 * GLB is only downloaded once the card scrolls near the screen. Rendering is on demand (no idle GPU use).
 */
export default function GlbPostViewer({ url, poster, name = '3D model' }) {
  const box = useRef(null); const [state, setState] = useState('idle'); // idle | loading | ready | error
  useEffect(() => {
    const el = box.current; if (!el) return undefined; let cleanup = null; let dead = false;
    const start = async () => {
      setState('loading');
      try {
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none';
        const scene = new THREE.Scene(); const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
        scene.add(new THREE.DirectionalLight(0xffffff, 1.4)); const cam = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
        const gltf = await new GLTFLoader().loadAsync(url); if (dead) { renderer.dispose(); return; }
        scene.add(gltf.scene); const b = new THREE.Box3().setFromObject(gltf.scene); const c = b.getCenter(new THREE.Vector3()); const r = Math.max(...b.getSize(new THREE.Vector3()).toArray(), 0.001);
        cam.near = r / 200; cam.far = r * 100; cam.position.copy(c).add(new THREE.Vector3(1, 0.7, 1.2).normalize().multiplyScalar((r / 2 / Math.tan(THREE.MathUtils.degToRad(20))) * 1.4)); cam.updateProjectionMatrix();
        const controls = new OrbitControls(cam, renderer.domElement); controls.target.copy(c); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.autoRotate = true; controls.autoRotateSpeed = 1.2; controls.update();
        let raf = 0; const draw = () => { raf = 0; if (dead) return; const moving = controls.update(); renderer.render(scene, cam); if (moving || controls.autoRotate) raf = requestAnimationFrame(draw); };
        const kick = () => { if (!raf) raf = requestAnimationFrame(draw); };
        controls.addEventListener('start', () => { controls.autoRotate = false; kick(); }); controls.addEventListener('change', kick);
        const resize = () => { const w = el.clientWidth, h = el.clientHeight || 1; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); kick(); };
        const ro = new ResizeObserver(resize); ro.observe(el); el.appendChild(renderer.domElement); resize(); setState('ready');
        cleanup = () => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); scene.traverse((o) => { o.geometry?.dispose?.(); [].concat(o.material || []).forEach((m) => { Object.values(m).forEach((v) => v?.isTexture && v.dispose()); m.dispose?.(); }); }); renderer.dispose(); renderer.domElement.remove(); };
      } catch { if (!dead) setState('error'); }
    };
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '300px' }); io.observe(el);
    return () => { dead = true; io.disconnect(); cleanup?.(); };
  }, [url]);
  return (
    <div ref={box} className="sim-viewer" style={{ position: 'relative', aspectRatio: '1 / 1', maxHeight: 'min(80vh, 760px)', background: '#0d1226' }} role="img" aria-label={`Interactive 3D model: ${name}. Drag to rotate.`}>
      {state !== 'ready' && poster && <img src={poster} alt="" decoding="async" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />}
      {state === 'loading' && <div className="sim-loading">Loading 3D model…</div>}
      {state === 'error' && <div className="sim-error">Could not load this 3D model on your device.</div>}
    </div>
  );
}
