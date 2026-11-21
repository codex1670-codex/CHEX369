import { useEffect, useState } from 'react';
import { ORBIT_CHANGED, ORBIT_OPEN, loadOrbit, saveOrbit, reducedMotion, supports3D, loadMenu, resetMenu, isDefaultMenu, MENU_CHANGED } from './orbitStore.js';

// Settings → CHEX ORBIT: switch the double-tap on/off and choose 3D or the flat fallback.
export default function OrbitSettings() {
  const [cfg, setCfg] = useState(loadOrbit);
  const [custom, setCustom] = useState(() => !isDefaultMenu(loadMenu()));
  useEffect(() => {
    const sync = () => setCfg(loadOrbit());
    const syncMenu = () => setCustom(!isDefaultMenu(loadMenu()));
    window.addEventListener(ORBIT_CHANGED, sync); window.addEventListener(MENU_CHANGED, syncMenu);
    return () => { window.removeEventListener(ORBIT_CHANGED, sync); window.removeEventListener(MENU_CHANGED, syncMenu); };
  }, []);
  const set = (patch) => setCfg(saveOrbit({ ...cfg, ...patch }));
  const still = reducedMotion();
  const MODES = [['auto', 'Automatic'], ['3d', '3D glass'], ['2d', 'Flat (2D)']];
  return (
    <div className="glass-card" style={{ padding: 20, marginBottom: 20 }} data-testid="orbit-settings">
      <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display)', fontSize: 16 }}>🪐 CHEX Orbit</h3>
      <p style={{ fontSize: 12.5, color: 'var(--text-mid)', margin: '0 0 10px' }}>
        Double-tap (or double-click) any quiet part of a screen to open Orbit, a 3D glass launcher for Messages, Codex, Gallery, Reels, Profile and the rest of CHEX.
        Photos, videos and reels keep double-tap for likes.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, marginBottom: 10 }}>
        <input type="checkbox" checked={cfg.enabled} onChange={e => set({ enabled: e.target.checked })} />
        Double-tap opens Orbit
      </label>
      <div className="sg-hint" style={{ marginBottom: 6 }}>Look</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {MODES.map(([id, label]) => (
          <button key={id} type="button" className={`btn-ghost${cfg.mode === id ? ' sel' : ''}`} style={{ width: 'auto', padding: '7px 14px' }} aria-pressed={cfg.mode === id} onClick={() => set({ mode: id })}>{label}</button>
        ))}
        <button type="button" className="btn-ghost" style={{ width: 'auto', padding: '7px 14px' }} onClick={() => window.dispatchEvent(new Event(ORBIT_OPEN))}>Try it</button>
      </div>
      <div className="sg-hint" style={{ marginTop: 10 }}>Menu: open Orbit and tap <b>Customize</b> to choose, hide, add and reorder the cards and quick actions.</div>
      {custom && <button type="button" className="btn-ghost" style={{ width: 'auto', padding: '7px 14px', marginTop: 8 }} onClick={() => resetMenu()}>↺ Reset menu to default</button>}
      {still && <div className="sg-hint" style={{ marginTop: 8 }}>Your device asks for reduced motion, so Orbit is shown flat with no animation.</div>}
      {!still && !supports3D() && <div className="sg-hint" style={{ marginTop: 8 }}>This browser can’t draw 3D layers, so Orbit is shown flat.</div>}
    </div>
  );
}
