import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface Props { size?: number; className?: string }

/**
 * A slowly rotating gold wireframe orb with orbiting particles — the CHEX brand mark in 3D.
 * Renders nothing when WebGL is unavailable (old devices, jsdom) or when the OS asks for reduced
 * motion, so it is purely progressive enhancement.
 */
export default function Orb3D({ size = 180, className }: Props) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return; // no WebGL
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size, size);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 4.2;

    const gold = new THREE.Color('#d4a72c');
    const orb = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.2, 2),
      new THREE.MeshBasicMaterial({ color: gold, wireframe: true, transparent: true, opacity: 0.85 }),
    );
    scene.add(orb);

    const COUNT = 220;
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const r = 1.7 + Math.random() * 0.6;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: gold, size: 0.035, transparent: true, opacity: 0.9 }));
    scene.add(points);

    let raf = 0;
    let visible = true;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible) return;
      orb.rotation.y += 0.006;
      orb.rotation.x += 0.0025;
      points.rotation.y -= 0.0035;
      renderer.render(scene, camera);
    };
    tick();

    const onVis = () => { visible = !document.hidden; };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      orb.geometry.dispose(); (orb.material as THREE.Material).dispose();
      geo.dispose(); (points.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [size]);

  return <div ref={host} className={className} style={{ width: size, height: size, margin: '0 auto' }} aria-hidden="true" />;
}
