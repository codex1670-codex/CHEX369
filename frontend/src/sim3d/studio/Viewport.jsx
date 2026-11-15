import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StudioEngine, VIEW_MODES } from './engine.js';

const MODE_LABEL = { textured: 'Textured', solid: 'Solid', wireframe: 'Wireframe', xray: 'X-ray', points: 'Points' };

/**
 * The persistent 3D viewport. The engine lives for as long as this component is mounted; `onEngine` hands it to
 * the studio once WebGL has started (or `onFail` explains why it could not — no GPU, blocked, etc.).
 */
const Viewport = forwardRef(function Viewport({ onEngine, onFail, hidden, children }, ref) {
  const mountRef = useRef(null); const wrapRef = useRef(null); const engRef = useRef(null);
  const [mode, setMode] = useState('textured'); const [proj, setProj] = useState('persp');
  const [opts, setOpts] = useState({ grid: true, axes: false, bbox: false });
  const [full, setFull] = useState(false);

  useEffect(() => {
    const eng = new StudioEngine();
    try { eng.mount(mountRef.current); } catch (e) { onFail?.(e.message); return undefined; }
    engRef.current = eng; onEngine?.(eng);
    const off = eng.on((t, d) => { if (t === 'viewmode') setMode(d); if (t === 'projection') setProj(d); });
    const onFs = () => { setFull(document.fullscreenElement === wrapRef.current); eng.resize(); };
    document.addEventListener('fullscreenchange', onFs);
    return () => { off(); document.removeEventListener('fullscreenchange', onFs); eng.dispose(); engRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (!hidden) requestAnimationFrame(() => engRef.current?.resize()); }, [hidden]);
  useImperativeHandle(ref, () => ({ engine: () => engRef.current }), []);

  const eng = () => engRef.current;
  const toggle = (k) => { const v = !opts[k]; setOpts((o) => ({ ...o, [k]: v })); eng()?.setOption(k, v); };
  const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else wrapRef.current?.requestFullscreen?.().catch(() => {}); };
  const shot = async () => {
    try {
      const blob = await eng().screenshot(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'chex-scan.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch { window.dispatchEvent(new CustomEvent('chex:toast', { detail: { text: 'Could not capture the viewport.' } })); }
  };

  return (
    <div ref={wrapRef} className={`ss-viewport ${hidden ? 'hidden' : ''} ${full ? 'full' : ''}`} data-noswipe="">
      <div ref={mountRef} className="ss-canvas" />
      <div className="ss-vbar ss-vbar-top" role="toolbar" aria-label="Viewport display">
        {VIEW_MODES.map((m) => <button key={m} type="button" className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => eng()?.setViewMode(m)}>{MODE_LABEL[m]}</button>)}
      </div>
      <div className="ss-vbar ss-vbar-bottom" role="toolbar" aria-label="Camera and helpers">
        {['front', 'back', 'left', 'right', 'top', 'bottom'].map((v) => <button key={v} type="button" onClick={() => eng()?.setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
        <button type="button" onClick={() => eng()?.frame()} title="Reset camera (F)">⟲ Reset</button>
        <button type="button" className={proj === 'ortho' ? 'on' : ''} aria-pressed={proj === 'ortho'} onClick={() => eng()?.setProjection(proj === 'ortho' ? 'persp' : 'ortho')}>{proj === 'ortho' ? 'Orthographic' : 'Perspective'}</button>
        <button type="button" className={opts.grid ? 'on' : ''} aria-pressed={opts.grid} onClick={() => toggle('grid')}>Grid</button>
        <button type="button" className={opts.axes ? 'on' : ''} aria-pressed={opts.axes} onClick={() => toggle('axes')}>Axes</button>
        <button type="button" className={opts.bbox ? 'on' : ''} aria-pressed={opts.bbox} onClick={() => toggle('bbox')}>Box</button>
        <button type="button" onClick={shot} aria-label="Save a screenshot">📸</button>
        <button type="button" onClick={fullscreen} aria-label={full ? 'Exit full screen' : 'Full screen'}>{full ? '⤡' : '⤢'}</button>
      </div>
      {children}
    </div>
  );
});
export default Viewport;
