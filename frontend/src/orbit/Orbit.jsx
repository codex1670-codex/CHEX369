import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import Avatar from '../components/Avatar.jsx';
import { GESTURE_EVENT } from '../gestures/gestureStore.js';
import { alertsEnabled } from '../announce.js';
import OrbitIcon from './OrbitIcon.jsx';
import OrbitCustomize from './OrbitCustomize.jsx';
import OrbitAI from './OrbitAI.jsx';
import {
  SATELLITES, ALL_CARDS, loadOrbit, saveOrbit, resolveMode, reducedMotion, liteDevice,
  loadMenu, saveMenu, resolveRing, resolveRadial, MENU_CHANGED,
  ringRadius, frontIndex, angleFromFront, snapTheta, ringIndexForRoute,
} from './orbitStore.js';

// CHEX ORBIT — a 3D glass carousel of every CHEX module.
//   • Swipe / drag / wheel / ← → turns the ring (inertia + snap).  Swipe down closes.  Tap a card to face it, tap again to expand it.
//   • Expanded cards become a "workspace" with live data and quick actions.  The orb at the bottom opens a radial quick-action menu.
//   • 3D is driven by one requestAnimationFrame loop that only runs while something moves, and only touches transform/opacity.
//   • Reduced motion, no-3D browsers and the "Flat" switch all get a plain 2D grid with the same actions.

const SAT_IDS = new Set(SATELLITES.map(x => x.id));   // modules that can be added to the ring from Customize
const ARC_FROM = -165, ARC_TO = -15, RADIAL_R = 118;   // degrees on screen (0 = right, −90 = up)
const radialPos = (i, n) => { const a = ((ARC_FROM + ((ARC_TO - ARC_FROM) * i) / Math.max(1, n - 1)) * Math.PI) / 180; return { x: Math.cos(a) * RADIAL_R, y: Math.sin(a) * RADIAL_R }; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fire = (action, ctx = {}) => window.dispatchEvent(new CustomEvent(GESTURE_EVENT, { detail: { gestureId: 'orbit', action, ctx } }));
const VERB = { like: 'liked your post', comment: 'commented', follow: 'followed you', game_invite: 'invited you to a game', message: 'sent a message', reaction: 'reacted to your post' };

export default function Orbit({ onClose, navigate, user, route }) {
  const [cfg, setCfg] = useState(loadOrbit);
  const [mode, setMode] = useState(() => resolveMode(loadOrbit()));
  const [lite, setLite] = useState(() => liteDevice());
  const [menu, setMenu] = useState(loadMenu);   // which cards / quick actions the person chose (Customize tab)
  const items = useMemo(() => resolveRing(menu, user), [menu, user]);
  const quick = useMemo(() => resolveRadial(menu), [menu]);
  const [cust, setCust] = useState(false);       // Customize tab open?
  const [ai, setAi] = useState(null);           // CHEX Orbit AI open? null | 'type' | 'talk'
  const [pages, setPages] = useState(false);     // "All pages" list open?
  const [active, setActive] = useState(() => ringIndexForRoute(route, items));
  const [ws, setWs] = useState(null);          // index of the expanded workspace card, or null
  const [radial, setRadial] = useState(false);
  const [hot, setHot] = useState(-1);          // radial item under the finger
  const [leaving, setLeaving] = useState(false);
  const [counts, setCounts] = useState({ messages: 0, other: 0 });
  const [data, setData] = useState({});        // workspace data by module id
  const [sound, setSound] = useState(alertsEnabled());
  const n = items.length;
  const is3d = mode === '3d';
  const still = reducedMotion();

  const rootRef = useRef(null), ringRef = useRef(null), stageRef = useRef(null), hubRef = useRef(null);
  const cardEls = useRef([]);
  const geo = useRef({ W: 240, H: 320, R: 300 });
  const st = useRef({ theta: -ringIndexForRoute(route, items) * (360 / n), vel: 0, target: null, raf: 0, last: 0, drag: null, moved: false, frames: [], slow: 0, shown: ringIndexForRoute(route, items), wheelAt: 0, wheelAcc: 0 });
  const activeRef = useRef(active); activeRef.current = active;
  const wsRef = useRef(ws); wsRef.current = ws;
  const prevFocus = useRef(null);

  // ---------- closing / navigating ----------
  const close = useCallback((after) => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => { onClose(); after?.(); }, still ? 0 : 200);
  }, [leaving, onClose, still]);
  const openItem = useCallback((it) => {
    const go = () => {
      if (it.codex) window.dispatchEvent(new Event('chex:ai-open'));
      else navigate(it.nav, it.nav === 'profile' ? user.username : undefined);
    };
    close(go);
  }, [close, navigate, user?.username]);

  // ---------- 3D engine ----------
  const paint = useCallback(() => {
    const s = st.current, ring = ringRef.current, root = rootRef.current;
    if (!ring || !root) return;
    const { R } = geo.current;
    ring.style.transform = `translate3d(0,0,${-R}px) rotateY(${s.theta.toFixed(3)}deg)`;
    root.style.setProperty('--th', s.theta.toFixed(2));
    for (let i = 0; i < n; i++) {
      const el = cardEls.current[i]; if (!el) continue;
      const a = Math.abs(angleFromFront(i, s.theta, n));
      el.style.setProperty('--d', clamp(a / (360 / n * 2), 0, 1).toFixed(3));
      el.style.setProperty('--f', clamp(1 - a / (360 / n), 0, 1).toFixed(3));
    }
    const f = frontIndex(s.theta, n);
    if (f !== s.shown) { s.shown = f; setActive(f); try { navigator.vibrate?.(6); } catch { /* no haptics */ } }
  }, [n]);

  const tick = useCallback((t) => {
    const s = st.current;
    const dt = clamp(t - (s.last || t), 1, 50); s.last = t;
    // frame-time watchdog: if the device can't keep ~30fps while moving, drop the live blur
    s.frames.push(dt); if (s.frames.length > 24) s.frames.shift();
    if (s.frames.length === 24) { const avg = s.frames.reduce((a, b) => a + b, 0) / 24; s.slow = avg > 30 ? s.slow + 1 : 0; if (s.slow > 40) { s.slow = 0; setLite(true); } }
    let moving = false;
    if (s.drag) moving = true;
    else if (s.target != null) {
      const diff = s.target - s.theta;
      if (Math.abs(diff) < 0.03) { s.theta = s.target; s.target = null; }
      else { s.theta += diff * (1 - Math.exp(-dt / 105)); moving = true; }     // frame-rate independent ease → same feel at 60 and 120 Hz
    }
    paint();
    if (moving) s.raf = requestAnimationFrame(tick); else { s.raf = 0; s.last = 0; s.frames.length = 0; }
  }, [paint]);
  const wake = useCallback(() => { const s = st.current; if (!s.raf) s.raf = requestAnimationFrame(tick); }, [tick]);

  const rotateTo = useCallback((i) => {            // shortest way round to card i
    const s = st.current, step = 360 / n;
    const want = -i * step;
    let diff = (((want - s.theta) % 360) + 540) % 360 - 180;
    s.target = s.theta + diff; wake();
  }, [n, wake]);
  const rotateBy = useCallback((k) => {
    const s = st.current, step = 360 / n;
    s.target = Math.round(((s.target ?? s.theta)) / step) * step - k * step; wake();
  }, [n, wake]);

  // geometry follows the stage size
  useLayoutEffect(() => {
    const stage = stageRef.current, root = rootRef.current;
    if (!stage || !root) return undefined;
    const measure = () => {
      const r = stage.getBoundingClientRect();
      const W = clamp(Math.min(r.width * 0.64, r.height * 0.62), 176, 300);
      const H = clamp(Math.min(W * 1.34, r.height * 0.94), 236, 410);
      const R = ringRadius(n, W);
      geo.current = { W, H, R };
      root.style.setProperty('--W', `${W}px`); root.style.setProperty('--H', `${H}px`); root.style.setProperty('--R', `${R}px`);
      if (is3d) paint();
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(stage); window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [n, is3d, paint]);
  // the ring changed (cards added / hidden / reordered): keep facing the same card if it is still there
  const faceId = useRef(items[active]?.id);
  const sig = items.map(x => x.id).join('|');
  useLayoutEffect(() => {
    let i = items.findIndex(x => x.id === faceId.current); if (i < 0) i = 0;
    const s = st.current;
    s.theta = -i * (360 / n); s.target = null; s.vel = 0; s.shown = i;
    cardEls.current.length = n;
    setActive(i); setWs(null);
    if (is3d) paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  useEffect(() => { faceId.current = items[active]?.id; }, [items, active]);
  useEffect(() => {
    const sync = () => setMenu(loadMenu());
    window.addEventListener(MENU_CHANGED, sync);
    return () => window.removeEventListener(MENU_CHANGED, sync);
  }, []);
  const changeMenu = useCallback((next) => setMenu(saveMenu(next)), []);

  useLayoutEffect(() => { if (is3d) paint(); }, [is3d, paint]);
  useEffect(() => () => cancelAnimationFrame(st.current.raf), []);

  // ---------- pointer: drag the ring, swipe down to close, swipe up to expand ----------
  const onDown = (e) => {
    if (!is3d || wsRef.current != null || (e.button !== undefined && e.button > 0)) return;
    const s = st.current;
    s.drag = { x: e.clientX, y: e.clientY, lx: e.clientX, lt: performance.now(), axis: null, id: e.pointerId, pull: 0 };
    s.moved = false; s.vel = 0; s.target = null;
  };
  const onMove = (e) => {
    const s = st.current, root = rootRef.current;
    // pointer parallax + glare (mouse only; fingers drive it through the drag itself)
    if (e.pointerType === 'mouse' && root && stageRef.current) {
      const r = stageRef.current.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      root.style.setProperty('--tx', (px * 2 - 1).toFixed(3)); root.style.setProperty('--ty', (py * 2 - 1).toFixed(3));
      root.style.setProperty('--mx', `${(px * 100).toFixed(0)}%`); root.style.setProperty('--my', `${(py * 100).toFixed(0)}%`);
    }
    const d = s.drag; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.axis) {
      if (Math.hypot(dx, dy) < 8) return;
      d.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      s.moved = true;
      try { stageRef.current.setPointerCapture(d.id); } catch { /* pointer gone */ }
      d.lx = e.clientX; d.lt = performance.now();
      if (d.axis === 'x') wake();
    }
    if (d.axis === 'x') {
      const now = performance.now(), ddx = e.clientX - d.lx, ddt = Math.max(1, now - d.lt);
      const perPx = (360 / n) / (geo.current.W * 0.82);
      s.theta += ddx * perPx;
      s.vel = s.vel * 0.6 + ((ddx * perPx) / ddt) * 0.4;
      d.lx = e.clientX; d.lt = now;
      root?.style.setProperty('--tx', clamp(s.vel * 14, -1, 1).toFixed(3));     // cards lean into the swipe
    } else {
      d.pull = dy;
      root?.style.setProperty('--pull', `${clamp(dy, -90, 220).toFixed(0)}px`);
    }
  };
  const onUp = () => {
    const s = st.current, root = rootRef.current, d = s.drag;
    s.drag = null;
    if (!d || !d.axis) return;
    if (d.axis === 'x') {
      s.target = snapTheta(s.theta, s.vel, n); wake();
      root?.style.setProperty('--tx', '0');
    } else {
      root?.style.setProperty('--pull', '0px');
      if (d.pull > 110) close();
      else if (d.pull < -70) setWs(activeRef.current);
    }
  };
  const onWheel = (e) => {
    if (!is3d || ws != null) return;
    const s = st.current, now = performance.now();
    s.wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(s.wheelAcc) > 40 && now - s.wheelAt > 170) { rotateBy(s.wheelAcc > 0 ? 1 : -1); s.wheelAcc = 0; s.wheelAt = now; }
  };

  // gyroscope parallax on phones that expose it without a permission prompt (Android / desktop)
  useEffect(() => {
    if (!is3d || still || typeof window.DeviceOrientationEvent === 'undefined' || typeof window.DeviceOrientationEvent.requestPermission === 'function') return undefined;
    let raf = 0, g = 0, b = 0;
    const on = (e) => { if (e.gamma == null) return; g = e.gamma; b = e.beta; if (!raf) raf = requestAnimationFrame(() => { raf = 0; const r = rootRef.current; if (!r || st.current.drag) return; r.style.setProperty('--tx', clamp(g / 30, -1, 1).toFixed(3)); r.style.setProperty('--ty', clamp((b - 50) / 30, -1, 1).toFixed(3)); }); };
    window.addEventListener('deviceorientation', on);
    return () => { window.removeEventListener('deviceorientation', on); cancelAnimationFrame(raf); };
  }, [is3d, still]);

  // ---------- card activation ----------
  const activate = (i) => {
    if (st.current.moved) { st.current.moved = false; return; }     // that "click" was the end of a drag
    if (is3d && i !== activeRef.current) { rotateTo(i); return; }
    setActive(i); setWs(i);
  };

  // ---------- keyboard + focus ----------
  useEffect(() => {
    prevFocus.current = document.activeElement;
    rootRef.current?.focus({ preventScroll: true });
    return () => { try { prevFocus.current?.focus?.({ preventScroll: true }); } catch { /* element gone */ } };
  }, []);
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); if (ai) setAi(null); else if (pages) setPages(false); else if (cust) setCust(false); else if (radial) setRadial(false); else if (ws != null) setWs(null); else close(); return; }
    if (e.key === 'Tab') {
      const f = [...rootRef.current.querySelectorAll('button:not([disabled]), [tabindex="0"]')].filter(el => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (ws != null || cust || e.target?.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight') { e.preventDefault(); is3d ? rotateBy(1) : setActive(a => (a + 1) % n); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); is3d ? rotateBy(-1) : setActive(a => (a + n - 1) % n); }
  };

  // ---------- live data ----------
  useEffect(() => {
    let live = true;
    api.notifications().then(r => { if (live) setCounts({ messages: r.unreadMessages || 0, other: r.unreadOther || 0 }); }).catch(() => {});
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (ws == null) return undefined;
    const id = items[ws].id;
    if (data[id] !== undefined) return undefined;
    let live = true;
    const put = (v) => { if (live) setData(d => ({ ...d, [id]: v })); };
    if (id === 'messages') api.conversations().then(r => put({ list: (r.conversations || []).slice(0, 5) })).catch(() => put({ error: true }));
    else if (id === 'notifications') api.notifications().then(r => put({ list: (r.notifications || []).slice(0, 5) })).catch(() => put({ error: true }));
    else if (id === 'gallery' || id === 'profile') api.userPosts(user.username).then(r => put({ list: (r.posts || []).slice(0, 6) })).catch(() => put({ error: true }));
    return () => { live = false; };
  }, [ws, items, data, user.username]);
  const badge = (id) => (id === 'messages' ? counts.messages : id === 'notifications' ? counts.other : 0);

  // ---------- radial menu ----------
  const radialHit = (e) => {
    const h = hubRef.current; if (!h) return -1;
    const r = h.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < 48) return -1;
    let best = -1, bd = 1e9;
    quick.forEach((_, i) => { const p = radialPos(i, quick.length); const dd = Math.hypot(dx - p.x, dy - p.y); if (dd < bd) { bd = dd; best = i; } });
    return bd < 44 ? best : -1;
  };
  const hubRef2 = useRef({ t: 0, was: false });
  const onHubDown = (e) => {
    e.stopPropagation();
    hubRef2.current = { t: performance.now(), was: radial };
    setRadial(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer gone */ }
  };
  const onHubMove = (e) => { if (e.buttons || e.pointerType === 'touch') setHot(radialHit(e)); };
  const onHubUp = (e) => {
    const i = radialHit(e); setHot(-1);
    if (i >= 0) { runRadial(quick[i].id); return; }
    const quick = performance.now() - hubRef2.current.t < 280;
    if (quick && hubRef2.current.was) setRadial(false);          // a quick tap on an already-open orb closes it
    else if (!quick) setRadial(false);                           // a long press that ended on the orb: cancel
  };
  const runRadial = (id) => {
    setRadial(false);
    if (id === 'pages') setPages(true);
    else if (id === 'codex') close(() => window.dispatchEvent(new Event('chex:ai-open')));
    else if (id === 'voice') close(() => fire('voiceSearch'));
    else if (id === 'circle') close(() => fire('circleAsk'));
    else if (id === 'settings') close(() => navigate('settings'));
    else if (id === 'sound') { fire('toggleSound'); setTimeout(() => setSound(alertsEnabled()), 60); }
    else if (id === 'flat') toggleFlat();
  };
  const toggleFlat = () => {
    const next = saveOrbit({ ...cfg, mode: mode === '3d' ? '2d' : '3d' });
    setCfg(next); setMode(resolveMode(next)); setWs(null);
  };

  // ---------- render ----------
  const rootCls = `ob-root${is3d ? ' ob-3d' : ' ob-flat'}${lite ? ' ob-lite' : ''}${leaving ? ' ob-leave' : ''}${still ? ' ob-still' : ''}`;
  const wsItem = ws != null ? items[ws] : null;
  const w = wsItem ? data[wsItem.id] : null;

  return createPortal(
    <div ref={rootRef} className={rootCls} role="dialog" aria-modal="true" aria-label="CHEX Orbit" tabIndex={-1} onKeyDown={onKey} data-noswipe data-noorbit>
      <div className="ob-bg" aria-hidden="true" />
      <button type="button" className="ob-scrim" aria-label="Close Orbit" tabIndex={-1} onClick={() => close()} />

      <header className="ob-head">
        <div className="ob-brand"><span className="ob-dot" aria-hidden="true" />CHEX <b>ORBIT</b></div>
        <div className="ob-head-btns">
          <button type="button" className="ob-chip" onClick={() => { setRadial(false); setCust(true); }} aria-haspopup="dialog" aria-expanded={cust} title="Choose and reorder the cards and quick actions">
            <OrbitIcon name="sliders" size={16} /><span>Customize</span>
          </button>
          <button type="button" className="ob-chip" onClick={toggleFlat} disabled={still} aria-pressed={!is3d} title={still ? 'Reduced motion is on, so Orbit stays flat' : 'Switch between 3D and flat'}>
            <OrbitIcon name={is3d ? 'flat' : 'cube3'} size={16} /><span>{is3d ? 'Flat' : '3D'}</span>
          </button>
          <button type="button" className="ob-chip ob-x" onClick={() => close()} aria-label="Close Orbit"><OrbitIcon name="close" size={18} /></button>
        </div>
      </header>

      <main className="ob-stage" ref={stageRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
        <div className="ob-persp">
          <ul className="ob-ring" ref={ringRef} aria-label="Modules">
            {items.map((it, i) => (
              <li key={it.id} className="ob-slot" style={{ '--a': `${i * (360 / n)}deg` }}>
                <button type="button" ref={el => { cardEls.current[i] = el; }} data-i={i} data-active={i === active ? '' : undefined}
                  className={`ob-card${i === active ? ' on' : ''}${Math.abs(((i - active + n + n / 2) % n) - n / 2) <= 1 ? ' near' : ''}`}
                  style={{ '--hue': it.hue, '--i': i }} aria-label={`${it.label}. ${it.hint}${badge(it.id) ? `. ${badge(it.id)} new` : ''}`} aria-current={i === active ? 'true' : undefined}
                  onClick={() => activate(i)}>
                  <span className="ob-tilt">
                    <span className="ob-face" /><span className="ob-glare" aria-hidden="true" />
                    <span className="ob-content">
                      <span className="ob-medal"><OrbitIcon name={it.icon} size={34} />{badge(it.id) > 0 && <span className="ob-badge">{badge(it.id) > 99 ? '99+' : badge(it.id)}</span>}</span>
                      <span className="ob-title">{it.label}</span>
                      <span className="ob-hint">{it.hint}</span>
                      <span className="ob-more" aria-hidden="true"><OrbitIcon name="up" size={14} /> {i === active ? 'Tap to expand' : 'Tap to face'}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </main>

      <div className="ob-dots" aria-hidden="true">{items.map((it, i) => <i key={it.id} className={i === active ? 'on' : ''} />)}</div>


      <footer className="ob-foot">
        <div className="ob-aibar" data-testid="orbit-ai-pill">
          <button type="button" className="ob-aibar-main" onClick={() => setAi('type')} aria-label="Open CHEX Orbit AI">
            <span className="ob-aibar-orb" aria-hidden="true"><i /></span>
            <span className="ob-aibar-t"><b>CHEX Orbit AI</b><span>Ask or tell me what to do</span></span>
          </button>
          <button type="button" className="ob-aibar-mic" onClick={() => setAi('talk')} aria-label="Speak to CHEX Orbit AI"><OrbitIcon name="mic" size={20} /></button>
        </div>
        <p className="ob-tip">{is3d ? 'Swipe to orbit · tap a card to expand · hold the orb for quick actions' : 'Tap a card to expand it · open the orb for quick actions'}</p>
        <div className={`ob-hubwrap${radial ? ' open' : ''}`}>
          {quick.map((r, i) => {
            const p = radialPos(i, quick.length);
            const label = r.id === 'sound' ? (sound ? 'Mute AI alerts' : 'Unmute AI alerts') : r.id === 'flat' ? (is3d ? 'Switch to flat' : 'Switch to 3D') : r.label;
            return (
              <button key={r.id} type="button" tabIndex={radial ? 0 : -1} className={`ob-rad${hot === i ? ' hot' : ''}`} style={{ '--x': `${p.x}px`, '--y': `${p.y}px`, '--n': i }}
                aria-label={label} title={label} onClick={() => runRadial(r.id)}>
                <OrbitIcon name={r.id === 'sound' && !sound ? 'mute' : r.icon} size={22} /><span className="ob-rad-l">{label}</span>
              </button>
            );
          })}
          <button ref={hubRef} type="button" className="ob-hub" aria-label="Quick actions" aria-expanded={radial} aria-haspopup="menu"
            onPointerDown={onHubDown} onPointerMove={onHubMove} onPointerUp={onHubUp} onPointerCancel={() => { setHot(-1); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRadial(r => !r); } }}>
            <span className="ob-hub-core"><OrbitIcon name={radial ? 'close' : 'spark'} size={24} /></span><i className="ob-hub-ring" aria-hidden="true" />
          </button>
        </div>
      </footer>

      {wsItem && (
        <div className="ob-ws-back" onClick={(e) => { if (e.target === e.currentTarget) setWs(null); }}>
          <section className="ob-ws" style={{ '--hue': wsItem.hue }} role="region" aria-label={`${wsItem.label} workspace`}>
            
            <header className="ob-ws-head">
              <span className="ob-medal sm"><OrbitIcon name={wsItem.icon} size={24} /></span>
              <div><h2>{wsItem.label}</h2><p>{wsItem.hint}</p></div>
              <button type="button" className="ob-chip ob-x" onClick={() => setWs(null)} aria-label="Collapse workspace" autoFocus><OrbitIcon name="close" size={18} /></button>
            </header>
            <div className="ob-ws-body">
              <Workspace item={wsItem} data={w} user={user} counts={counts} close={close} navigate={navigate} />
            </div>
            <button type="button" className="ob-open" onClick={() => openItem(wsItem)}>Open {wsItem.label} <OrbitIcon name="open" size={18} /></button>
          </section>
        </div>
      )}

      {ai && <OrbitAI autoListen={ai === 'talk'} onClose={() => setAi(null)}
        onRun={(how, t) => close(() => window.dispatchEvent(how === 'ask' ? new CustomEvent('chex:ai-open', { detail: { text: t } }) : new CustomEvent('chex:codex-open', { detail: { mode: 'full', run: t } })))} />}

      {pages && (
        <div className="ob-cu-back" onClick={(e) => { if (e.target === e.currentTarget) setPages(false); }}>
          <section className="ob-cu" role="region" aria-label="All pages" data-testid="orbit-pages">
            <header className="ob-cu-head">
              <span className="ob-medal sm"><OrbitIcon name="grid" size={22} /></span>
              <div><h2>All pages</h2><p>Every part of CHEX, one tap away.</p></div>
              <button type="button" className="ob-chip ob-x" onClick={() => setPages(false)} aria-label="Close all pages" autoFocus><OrbitIcon name="close" size={18} /></button>
            </header>
            <div className="ob-cu-body">
              <div className="ob-pg-grid">
                {ALL_CARDS.filter(c => !c.adminOnly || user?.isAdmin).map(c => (
                  <button key={c.id} type="button" className="ob-pg" onClick={() => { setPages(false); openItem(c); }}>
                    <span className="ob-cu-ico"><OrbitIcon name={c.icon} size={22} /></span><span>{c.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}

      {cust && <OrbitCustomize menu={menu} user={user} onChange={changeMenu} onClose={() => setCust(false)} />}
    </div>,
    document.body,
  );
}

// ---------- the expanded card: live data + quick actions for each module ----------
function Row({ onClick, children }) { return <button type="button" className="ob-row" onClick={onClick}>{children}</button>; }

function Workspace({ item, data, user, counts, close, navigate }) {
  const loading = data === undefined && ['messages', 'notifications', 'gallery', 'profile'].includes(item.id);
  const err = data?.error;
  const act = (label, icon, fn) => <button key={label} type="button" className="ob-act" onClick={fn}><OrbitIcon name={icon} size={18} />{label}</button>;
  const goto = (key, param) => close(() => navigate(key, param));

  if (item.id === 'messages') {
    return (<>
      <p className="ob-stat"><b>{counts.messages}</b> unread {counts.messages === 1 ? 'message' : 'messages'}</p>
      {loading && <p className="ob-muted">Loading chats…</p>}{err && <p className="ob-muted">Couldn’t load your chats right now.</p>}
      {data?.list?.map(c => {
        const other = (c.participants || []).find(p => p.id !== user.id);
        const name = c.name || other?.displayName || other?.username || 'Chat';
        return (
          <Row key={c.id} onClick={() => goto('messages', !c.name && other ? other.username : undefined)}>
            {other && !c.name ? <Avatar user={other} size={36} showPresence={false} /> : <span className="ob-grp">#</span>}
            <span className="ob-row-t"><b>{name}</b><span>{c.lastMessage?.content || 'No messages yet'}</span></span>
            {c.unreadCount > 0 && <span className="ob-badge st">{c.unreadCount}</span>}
          </Row>
        );
      })}
      {data?.list?.length === 0 && <p className="ob-muted">No chats yet. Search for someone to say hi.</p>}
    </>);
  }
  if (item.id === 'notifications') {
    return (<>
      <p className="ob-stat"><b>{counts.other}</b> new {counts.other === 1 ? 'alert' : 'alerts'}</p>
      {loading && <p className="ob-muted">Loading alerts…</p>}{err && <p className="ob-muted">Couldn’t load your alerts right now.</p>}
      {data?.list?.map(nf => (
        <Row key={nf.id} onClick={() => (nf.type === 'game_invite' && nf.targetId ? goto('games', { joinCode: nf.targetId }) : goto('profile', nf.actor?.username))}>
          {nf.actor && <Avatar user={nf.actor} size={36} showPresence={false} />}
          <span className="ob-row-t"><b>{nf.actor?.displayName || 'Someone'}</b><span>{VERB[nf.type] || String(nf.type || '').replace(/_/g, ' ')}</span></span>
          {!nf.read && <span className="ob-new" aria-label="New" />}
        </Row>
      ))}
      {data?.list?.length === 0 && <p className="ob-muted">You’re all caught up.</p>}
    </>);
  }
  if (item.id === 'gallery' || item.id === 'profile') {
    return (<>
      <div className="ob-me"><Avatar user={user} size={52} showPresence={false} /><span className="ob-row-t"><b>{user.displayName || user.username}</b><span>@{user.username}</span></span></div>
      {item.id === 'gallery' && <>
        {loading && <p className="ob-muted">Loading your media…</p>}{err && <p className="ob-muted">Couldn’t load your media right now.</p>}
        {data?.list?.length > 0 && (
          <div className="ob-thumbs">
            {data.list.map(p => (
              <button key={p.id} type="button" className="ob-thumb" aria-label={p.caption ? `Open ${p.caption.slice(0, 40)}` : 'Open post'} onClick={() => goto('profile', user.username)}>
                {p.mediaUrl && p.mediaType === 'video' ? <video src={p.mediaUrl} muted playsInline preload="metadata" /> : p.mediaUrl ? <img src={p.mediaUrl} alt="" loading="lazy" draggable="false" /> : <span>{(p.caption || '').slice(0, 40)}</span>}
              </button>
            ))}
          </div>
        )}
        {data?.list?.length === 0 && <p className="ob-muted">Nothing posted yet.</p>}
      </>}
      <div className="ob-acts">
        {act('Saved posts', 'gallery', () => goto('saved-posts'))}
        {act('Saved reels', 'reels', () => goto('saved-reels'))}
        {item.id === 'profile' && act('Settings', 'gear', () => goto('settings'))}
        {item.id === 'profile' && act('Coins', 'coin', () => goto('coins'))}
      </div>
    </>);
  }
  if (item.id === 'codex') {
    const chat = () => close(() => window.dispatchEvent(new Event('chex:ai-open')));
    const cmd = (talk) => () => close(() => window.dispatchEvent(new CustomEvent('chex:codex-open', { detail: { mode: 'full', talk } })));
    return (<>
      <p className="ob-muted">Chat, ask for an image or a video, or tell the command bar what to do in CHEX.</p>
      <div className="ob-acts">
        {act('Chat with CHEX AI', 'chat', chat)}{act('Command bar', 'codex', cmd(false))}
        {act('Talk', 'mic', cmd(true))}{act('Circle to Ask', 'lasso', () => close(() => fire('circleAsk')))}
      </div>
    </>);
  }
  if (item.id === 'reels') {
    return (<>
      <p className="ob-muted">Swipe through short videos. Double-tap a reel to like it.</p>
      <div className="ob-acts">{act('Watch reels', 'reels', () => goto('reels'))}{act('Search reels', 'search', () => goto('search', { scope: 'reels' }))}{act('Saved reels', 'gallery', () => goto('saved-reels'))}{act('Reel history', 'note', () => goto('reels-history'))}</div>
    </>);
  }
  if (item.id === 'search') {
    return (<>
      <p className="ob-muted">Find people, posts, hashtags and reels, or just say it.</p>
      <div className="ob-acts">{act('Search', 'search', () => goto('search'))}{act('Voice search', 'mic', () => close(() => fire('voiceSearch')))}{act('Search reels', 'reels', () => goto('search', { scope: 'reels' }))}</div>
    </>);
  }
  if (SAT_IDS.has(item.id)) {
    return <p className="ob-muted">{item.hint}. Tap Open below to go there.</p>;   // the footer's Open button does the navigating
  }
  return (   // Home
    <>
      <p className="ob-muted">Your feed, stories and notes.</p>
      <div className="ob-acts">{act('Open feed', 'home', () => goto('feed'))}{act('Sticky notes', 'note', () => goto('stickies'))}{act('Learn', 'learn', () => goto('learn'))}{act('Games', 'games', () => goto('games'))}</div>
    </>
  );
}
