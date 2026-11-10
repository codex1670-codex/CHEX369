import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { isLand } from './landMask';

interface Props { size?: number; className?: string }

const R = 1.2; // globe radius

/** Fibonacci sphere: evenly spread points, kept only where the map says "land". */
function landPositions(total: number): Float32Array {
  const out: number[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < total; i++) {
    const y = 1 - (i / (total - 1)) * 2;           // 1 → -1
    const lat = Math.asin(y) * (180 / Math.PI);
    const theta = golden * i;
    const lon = ((((theta * 180) / Math.PI + 180) % 360) + 360) % 360 - 180;
    if (!isLand(lat, lon)) continue;
    // Match the map: longitude 0 faces +z, east is +x… (three.js: x = cos(lat)·sin(lon), z = cos(lat)·cos(lon))
    const latR = (lat * Math.PI) / 180, lonR = (lon * Math.PI) / 180;
    out.push(R * Math.cos(latR) * Math.sin(lonR), R * Math.sin(latR), R * Math.cos(latR) * Math.cos(lonR));
  }
  return new Float32Array(out);
}

/** Latitude/longitude grid lines (every 30°) as line segments. */
function graticule(): Float32Array {
  const pts: number[] = [];
  const v = (lat: number, lon: number) => {
    const a = (lat * Math.PI) / 180, b = (lon * Math.PI) / 180;
    return [R * 1.002 * Math.cos(a) * Math.sin(b), R * 1.002 * Math.sin(a), R * 1.002 * Math.cos(a) * Math.cos(b)] as const;
  };
  for (let lat = -60; lat <= 60; lat += 30)
    for (let lon = -180; lon < 180; lon += 6) pts.push(...v(lat, lon), ...v(lat, lon + 6));
  for (let lon = -180; lon < 180; lon += 30)
    for (let lat = -90; lat < 90; lat += 6) pts.push(...v(lat, lon), ...v(lat + 6, lon));
  return new Float32Array(pts);
}

/**
 * A spinning 3D Earth: gold continents drawn as dots, a glassy ocean, a faint lat/long grid and an
 * orbiting ring + satellite. Drag sideways to spin it yourself (it keeps its momentum, then eases
 * back to the slow auto-spin). Vertical swipes still scroll the page.
 *
 * Progressive enhancement: with no WebGL it shows a 🌍 instead, and with "reduce motion" it renders
 * one still frame.
 */
export default function Globe3D({ size = 170, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      setFallback(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size, size);
    renderer.domElement.style.touchAction = 'pan-y'; // horizontal drag = spin, vertical = page scroll
    renderer.domElement.style.cursor = 'grab';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.z = 4.6;

    const gold = new THREE.Color(dark ? '#f2cf63' : '#c99a1c');
    const tilt = new THREE.Group();       // Earth's axial tilt
    tilt.rotation.z = THREE.MathUtils.degToRad(-23.4);
    tilt.rotation.x = THREE.MathUtils.degToRad(14);
    scene.add(tilt);
    const globe = new THREE.Group();      // spins around its own axis
    tilt.add(globe);

    const disposables: { dispose(): void }[] = [];
    const track = <T extends { dispose(): void }>(o: T): T => { disposables.push(o); return o; };

    // ocean
    const ocean = new THREE.Mesh(
      track(new THREE.SphereGeometry(R * 0.995, 48, 32)),
      track(new THREE.MeshBasicMaterial({ color: dark ? 0x16264d : 0xfff1c2, transparent: true, opacity: dark ? 0.85 : 0.55 })),
    );
    globe.add(ocean);

    // grid
    const gGeo = track(new THREE.BufferGeometry());
    gGeo.setAttribute('position', new THREE.BufferAttribute(graticule(), 3));
    globe.add(new THREE.LineSegments(gGeo, track(new THREE.LineBasicMaterial({ color: gold, transparent: true, opacity: 0.22 }))));

    // continents
    const lGeo = track(new THREE.BufferGeometry());
    lGeo.setAttribute('position', new THREE.BufferAttribute(landPositions(9000), 3));
    globe.add(new THREE.Points(lGeo, track(new THREE.PointsMaterial({ color: gold, size: 0.032, sizeAttenuation: true }))));

    // soft atmosphere halo (back-faces only, so it hugs the rim)
    scene.add(new THREE.Mesh(
      track(new THREE.SphereGeometry(R * 1.12, 48, 32)),
      track(new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.1, side: THREE.BackSide })),
    ));

    // orbit ring + satellite
    const orbit = new THREE.Group();
    orbit.rotation.x = THREE.MathUtils.degToRad(72);
    orbit.rotation.y = THREE.MathUtils.degToRad(20);
    scene.add(orbit);
    orbit.add(new THREE.Mesh(
      track(new THREE.TorusGeometry(R * 1.45, 0.006, 8, 120)),
      track(new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.55 })),
    ));
    const sat = new THREE.Mesh(track(new THREE.SphereGeometry(0.05, 12, 12)), track(new THREE.MeshBasicMaterial({ color: gold })));
    orbit.add(sat);

    // start facing India/Asia so the first frame is a recognisable "world"
    globe.rotation.y = THREE.MathUtils.degToRad(-75);

    // interaction: drag to spin, with inertia
    const AUTO = 0.006;
    let vel = AUTO, dragging = false, lastX = 0;
    const el2 = renderer.domElement;
    const down = (e: PointerEvent) => { dragging = true; lastX = e.clientX; el2.style.cursor = 'grabbing'; el2.setPointerCapture?.(e.pointerId); };
    const move = (e: PointerEvent) => { if (!dragging) return; const dx = e.clientX - lastX; lastX = e.clientX; vel = dx * 0.012; globe.rotation.y += vel; };
    const up = () => { dragging = false; el2.style.cursor = 'grab'; };
    el2.addEventListener('pointerdown', down);
    el2.addEventListener('pointermove', move);
    el2.addEventListener('pointerup', up);
    el2.addEventListener('pointercancel', up);

    let raf = 0, t = 0, visible = true;
    const frame = () => {
      if (!dragging) { vel += (AUTO - vel) * 0.04; globe.rotation.y += vel; } // ease back to auto-spin
      t += 0.012;
      sat.position.set(Math.cos(t) * R * 1.45, Math.sin(t) * R * 1.45, 0);
      renderer.render(scene, camera);
    };
    const loop = () => { raf = requestAnimationFrame(loop); if (visible) frame(); };
    if (reduce) frame(); else loop();

    const onVis = () => { visible = !document.hidden; };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      el2.removeEventListener('pointerdown', down);
      el2.removeEventListener('pointermove', move);
      el2.removeEventListener('pointerup', up);
      el2.removeEventListener('pointercancel', up);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      el2.remove();
    };
  }, [size]);

  return (
    <div
      ref={host}
      className={className}
      style={{ width: size, height: size, margin: '0 auto', display: 'grid', placeItems: 'center', fontSize: size * 0.6 }}
      aria-hidden="true"
    >
      {fallback ? '🌍' : null}
    </div>
  );
}
