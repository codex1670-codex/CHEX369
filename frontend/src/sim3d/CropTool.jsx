import { useEffect, useMemo, useRef, useState } from 'react';

// Customizable crop for Quick 3D. `crop` is { x, y, w, h } as fractions (0..1) of the photo, so it is
// independent of the photo's resolution. Drag the box to move it, drag a handle to resize it, pick an
// aspect ratio, or fine-tune each edge with the sliders.
// Draw mode: trace around the object with a finger / mouse. The drawn shape becomes the cut-out
// (`crop.path` = list of { x, y } fractions of the photo; x/y/w/h then hold the path's bounding box).
export const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 };
export const isFullCrop = (c) => !c || (!c.path && c.x <= 0.001 && c.y <= 0.001 && c.w >= 0.999 && c.h >= 0.999);
const pathBox = (pts) => {
  let l = 1, t = 1, r = 0, b = 0;
  for (const p of pts) { l = Math.min(l, p.x); t = Math.min(t, p.y); r = Math.max(r, p.x); b = Math.max(b, p.y); }
  return { x: l, y: t, w: r - l, h: b - t };
};
const MIN = 0.06;                       // smallest crop edge, as a fraction of the photo
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function applyCrop(photo, crop) {
  if (!photo || isFullCrop(crop)) return photo;
  const sx = Math.round(crop.x * photo.width); const sy = Math.round(crop.y * photo.height);
  const sw = Math.max(16, Math.min(photo.width - sx, Math.round(crop.w * photo.width)));
  const sh = Math.max(16, Math.min(photo.height - sy, Math.round(crop.h * photo.height)));
  const c = document.createElement('canvas'); c.width = sw; c.height = sh;
  const ctx = c.getContext('2d');
  if (crop.path && crop.path.length > 2) {          // drawn shape: keep only the pixels inside the outline
    ctx.beginPath();
    crop.path.forEach((p, i) => { const X = p.x * photo.width - sx; const Y = p.y * photo.height - sy; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
    ctx.closePath(); ctx.clip();
    c.drawnMask = true;                              // makeCutout uses this outline as the object's mask
  }
  ctx.drawImage(photo, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

const ASPECTS = [['free', 'Free', null], ['orig', 'Original', 'orig'], ['1:1', '1 : 1', 1], ['4:3', '4 : 3', 4 / 3], ['3:4', '3 : 4', 3 / 4], ['16:9', '16 : 9', 16 / 9]];
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export default function CropTool({ photo, crop, onChange }) {
  const [aspect, setAspect] = useState('free');
  const [mode, setMode] = useState(crop?.path ? 'draw' : 'box');   // 'box' = rectangle, 'draw' = freehand outline
  const [live, setLive] = useState(null);                          // outline being drawn right now
  const [note, setNote] = useState('');
  const liveRef = useRef(null);
  const [box, setBox] = useState(crop || FULL_CROP);          // live while dragging; committed on release
  const wrap = useRef(null); const cv = useRef(null); const drag = useRef(null);
  const W = photo.width; const H = photo.height;

  useEffect(() => { setBox(crop || FULL_CROP); }, [crop]);
  useEffect(() => {                                              // preview of the whole photo
    const c = cv.current; if (!c) return;
    const k = Math.min(1, 900 / Math.max(W, H));
    c.width = Math.round(W * k); c.height = Math.round(H * k);
    c.getContext('2d').drawImage(photo, 0, 0, c.width, c.height);
  }, [photo, W, H]);

  const ratio = useMemo(() => {
    const a = ASPECTS.find((x) => x[0] === aspect)?.[2];
    return a === 'orig' ? W / H : a || null;                     // pixel width / height, or null = free
  }, [aspect, W, H]);

  const commit = (b) => { setBox(b); onChange(isFullCrop(b) ? null : b); };

  // Largest centred box with the given ratio (used when an aspect is chosen).
  const fit = (r) => {
    let w = 1; let h = (W / r) / H;
    if (h > 1) { h = 1; w = (H * r) / W; }
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  };
  const pickAspect = (id) => {
    setAspect(id);
    const a = ASPECTS.find((x) => x[0] === id)[2];
    const r = a === 'orig' ? W / H : a;
    if (r) commit(fit(r)); else if (id === 'free') commit(box);
  };

  const pt = (e) => { const r = wrap.current.getBoundingClientRect(); return { fx: clamp((e.clientX - r.left) / r.width, 0, 1), fy: clamp((e.clientY - r.top) / r.height, 0, 1) }; };

  // ---- Draw mode: trace around the object ----
  const drawDown = (e) => {
    if (mode !== 'draw') return;
    e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId);
    const { fx, fy } = pt(e);
    liveRef.current = [{ x: fx, y: fy }]; setLive(liveRef.current); setNote('');
  };
  const drawMove = (e) => {
    const L = liveRef.current; if (!L) return;
    const { fx, fy } = pt(e); const last = L[L.length - 1];
    if (Math.hypot((fx - last.x) * W, (fy - last.y) * H) < Math.max(3, Math.min(W, H) * 0.006)) return;   // skip tiny steps
    liveRef.current = [...L, { x: fx, y: fy }]; setLive(liveRef.current);
  };
  const drawUp = () => {
    const L = liveRef.current; liveRef.current = null; setLive(null);
    if (!L) return;
    const bb = pathBox(L);
    if (L.length < 8 || bb.w < MIN || bb.h < MIN) { setNote('Draw a bigger loop around the object.'); return; }
    commit({ ...bb, path: L });
  };
  const clearDrawing = () => { setNote(''); commit(FULL_CROP); };
  const switchMode = (m) => {
    setMode(m); setNote('');
    if (m === 'box' && box.path) commit({ x: box.x, y: box.y, w: box.w, h: box.h });   // keep the rectangle around the drawing
  };

  const down = (mode) => (e) => {
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = pt(e);
    drag.current = { mode, start: p, orig: { ...box } };
  };
  const move = (e) => {
    const d = drag.current; if (!d) return;
    const { fx, fy } = pt(e); const o = d.orig;
    if (d.mode === 'move') {
      const x = clamp(o.x + (fx - d.start.fx), 0, 1 - o.w); const y = clamp(o.y + (fy - d.start.fy), 0, 1 - o.h);
      setBox({ ...o, x, y }); return;
    }
    let l = o.x; let t = o.y; let r = o.x + o.w; let b = o.y + o.h;
    const m = d.mode;
    if (ratio && m.length === 2) {                               // corner resize with a locked aspect ratio
      const ax = m.includes('w') ? r : l; const ay = m.includes('n') ? b : t;
      const maxW = m.includes('w') ? ax : 1 - ax; const maxH = m.includes('n') ? ay : 1 - ay;
      const k = (ratio * H) / W;                                 // width fraction per height fraction
      let wf = Math.max(Math.abs(fx - ax), Math.abs(fy - ay) * k);
      wf = clamp(wf, MIN, Math.max(MIN, Math.min(maxW, maxH * k)));
      const hf = wf / k;
      l = m.includes('w') ? ax - wf : ax; r = m.includes('w') ? ax : ax + wf;
      t = m.includes('n') ? ay - hf : ay; b = m.includes('n') ? ay : ay + hf;
    } else {
      if (m.includes('w')) l = clamp(fx, 0, r - MIN);
      if (m.includes('e')) r = clamp(fx, l + MIN, 1);
      if (m.includes('n')) t = clamp(fy, 0, b - MIN);
      if (m.includes('s')) b = clamp(fy, t + MIN, 1);
    }
    setBox({ x: l, y: t, w: r - l, h: b - t });
  };
  const up = () => { if (!drag.current) return; drag.current = null; commit(box); };

  // Slider fine-tune: Left/Top/Right/Bottom insets as % of the photo.
  const inset = { left: box.x, top: box.y, right: 1 - box.x - box.w, bottom: 1 - box.y - box.h };
  const setInset = (side, pct) => {
    const v = pct / 100; const i = { ...inset, [side]: v };
    i.left = clamp(i.left, 0, 1 - MIN - i.right); i.right = clamp(i.right, 0, 1 - MIN - i.left);
    i.top = clamp(i.top, 0, 1 - MIN - i.bottom); i.bottom = clamp(i.bottom, 0, 1 - MIN - i.top);
    setAspect('free');
    commit({ x: i.left, y: i.top, w: 1 - i.left - i.right, h: 1 - i.top - i.bottom });
  };
  const pxW = Math.round(box.w * W); const pxH = Math.round(box.h * H);

  return (
    <div className="sim-crop">
      <div className="sim-crop-aspects" role="radiogroup" aria-label="Crop style">
        <button type="button" role="radio" aria-checked={mode === 'box'} className={mode === 'box' ? 'on' : ''} onClick={() => switchMode('box')}>▭ Box</button>
        <button type="button" role="radio" aria-checked={mode === 'draw'} className={mode === 'draw' ? 'on' : ''} onClick={() => switchMode('draw')}>✏️ Draw</button>
      </div>
      {mode === 'box' && <div className="sim-crop-aspects" role="radiogroup" aria-label="Crop shape">
        {ASPECTS.map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={aspect === id} className={aspect === id ? 'on' : ''} onClick={() => pickAspect(id)}>{label}</button>)}
      </div>}
      <div className={`sim-crop-stage${mode === 'draw' ? ' drawing' : ''}`} ref={wrap} onPointerDown={drawDown}
        onPointerMove={(e) => { move(e); drawMove(e); }} onPointerUp={() => { up(); drawUp(); }} onPointerCancel={() => { up(); drawUp(); }} style={{ aspectRatio: `${W} / ${H}` }}>
        <canvas ref={cv} aria-label="Photo to crop" />
        {mode === 'box' ? (
          <>
            <div className="sim-crop-shade" style={{ clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${box.x * 100}% ${box.y * 100}%,${box.x * 100}% ${(box.y + box.h) * 100}%,${(box.x + box.w) * 100}% ${(box.y + box.h) * 100}%,${(box.x + box.w) * 100}% ${box.y * 100}%,${box.x * 100}% ${box.y * 100}%)` }} />
            <div className="sim-crop-box" onPointerDown={down('move')} style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}>
              <i className="g1" /><i className="g2" /><i className="g3" /><i className="g4" />
              {HANDLES.filter((h) => !(ratio && h.length === 1)).map((h) => <span key={h} className={`sim-crop-h h-${h}`} onPointerDown={down(h)} aria-hidden="true" />)}
            </div>
          </>
        ) : (
          <svg className="sim-crop-draw" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {(() => {
              const pts = live || box.path;
              if (!pts) return null;
              const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(p.x * 100).toFixed(2)} ${(p.y * 100).toFixed(2)}`).join('');
              return (
                <>
                  {!live && <path d={`M0 0H100V100H0Z${d}Z`} fillRule="evenodd" className="shade" />}
                  <path d={live ? d : `${d}Z`} className="line-under" vectorEffect="non-scaling-stroke" />
                  <path d={live ? d : `${d}Z`} className="line" vectorEffect="non-scaling-stroke" />
                </>
              );
            })()}
          </svg>
        )}
      </div>
      <p className="sim-help" role="status">
        {mode === 'draw'
          ? (note || (box.path ? `Outline set (${pxW} × ${pxH} px). Only what is inside it becomes your 3D object — draw again to redo it.` : 'Draw a loop around the object with your finger or mouse, then lift to finish.'))
          : `Crop: ${pxW} × ${pxH} px${isFullCrop(box) ? ' (whole photo)' : ''}. Drag the box to move it, drag a corner to resize.`}
      </p>
      {mode === 'box' && [['left', 'Left'], ['top', 'Top'], ['right', 'Right'], ['bottom', 'Bottom']].map(([k, label]) => (
        <label className="sim-slider" key={k}>
          <span className="sim-slider-top"><span>Trim {label.toLowerCase()}</span><b>{Math.round(inset[k] * 100)}%</b></span>
          <input type="range" min="0" max="90" step="1" value={Math.round(inset[k] * 100)} onChange={(e) => setInset(k, Number(e.target.value))} aria-label={`Trim ${label.toLowerCase()}`} />
        </label>
      ))}
      <button type="button" className="btn-ghost" style={{ width: 'auto', padding: '8px 14px' }} onClick={() => { setAspect('free'); setNote(''); commit(FULL_CROP); }} disabled={isFullCrop(box)}>{mode === 'draw' ? '🗑 Clear drawing' : '↺ Reset crop'}</button>
    </div>
  );
}
