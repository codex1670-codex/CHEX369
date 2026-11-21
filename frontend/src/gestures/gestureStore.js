// Smart gestures — device-local settings + the tiny event bus the rest of the app talks to.
//
//  • Customizable gestures (Settings → Smart gestures). Each one is bound to an action from ACTIONS.
//  • Hold Share  → quick-send circle (top 5 people), Hold Search → voice search, Shake → Codex shortcut by default.
//  • Everything lives in this browser (localStorage), like the Floating AI bar and Circle to Ask.
//
// Nothing here touches the DOM on import; components call fireGesture() and <GestureHub> (mounted in App) acts on it.

const KEY = 'chex.gestures';
export const CHANGED = 'chex:gestures-changed';
export const GESTURE_EVENT = 'chex:gesture';

// ---- the gestures ------------------------------------------------------------------------------------------------
// `share: true` gestures carry an item (post/reel) and may use the share-only actions.
// `section` only decides which heading the gesture sits under in Settings.
export const SECTIONS = [
  ['buttons', 'On a button', 'Work on one specific button'],
  ['screen',  'Anywhere on the screen', 'Touch gestures that work on any page — no button needed'],
  ['phone',   'Move the phone', 'Use the phone itself'],
];
export const GESTURES = [
  // on a button
  { id: 'shareHold',   section: 'buttons', icon: '↗',  label: 'Hold Share button',     hint: 'Press and hold ↗ on a post or reel', share: true,  def: 'quickShare' },
  { id: 'searchHold',  section: 'buttons', icon: '🔍', label: 'Hold Search icon',      hint: 'Press and hold Search in the bottom bar',        def: 'voiceSearch' },
  { id: 'homeDouble',  section: 'buttons', icon: '🏠', label: 'Double-tap Home icon',  hint: 'Tap Home twice, quickly',                         def: 'scrollTop' },
  // anywhere on the screen
  { id: 'twoTap',      section: 'screen',  icon: '✌️', label: 'Two-finger tap',        hint: 'Tap the screen with two fingers at once',         def: 'none' },
  { id: 'threeTap',    section: 'screen',  icon: '🖐', label: 'Three-finger tap',      hint: 'Tap the screen with three fingers at once',       def: 'none' },
  { id: 'twoSwipeUp',  section: 'screen',  icon: '⤴️', label: 'Two-finger swipe up',   hint: 'Slide two fingers up together',                   def: 'none' },
  { id: 'twoSwipeDown',section: 'screen',  icon: '⤵️', label: 'Two-finger swipe down', hint: 'Slide two fingers down together',                 def: 'none' },
  { id: 'edgeRight',   section: 'screen',  icon: '👈', label: 'Swipe in from right edge', hint: 'Start at the right edge, slide left',          def: 'none' },
  { id: 'edgeLeft',    section: 'screen',  icon: '👉', label: 'Swipe in from left edge',  hint: 'Start at the left edge, slide right',          def: 'none' },
  // move the phone
  { id: 'shake',       section: 'phone',   icon: '📳', label: 'Shake phone',           hint: 'Shake the phone firmly, side to side',            def: 'codexMini' },
  { id: 'flipDown',    section: 'phone',   icon: '🙈', label: 'Flip phone face-down',  hint: 'Lay the phone screen-down on a table and CHEX closes', def: 'exitApp', fixed: 'exitApp' },   // fixed: always exits, can't be changed
];

// ---- the actions a gesture can run -------------------------------------------------------------------------------
export const PAGES = [
  ['feed', 'Home', '🏠'], ['search', 'Search', '🔍'], ['reels', 'Reels', '🎬'], ['messages', 'Chats', '💬'],
  ['notifications', 'Alerts', '🔔'], ['games', 'Games', '🎮'], ['profile', 'My profile', '👤'], ['settings', 'Settings', '⚙️'],
  ['stickies', 'Sticky notes', '📌'], ['learn', 'CHEX learn', '🌍'], ['sim3d', 'CHEX Simulation', '🧊'],
  ['mylife', 'Private space', '🔒'], ['coins', 'CHEX Coins', '🪙'],
];

export const ACTIONS = [
  { id: 'none',        label: 'Do nothing',                  icon: '🚫', group: 'Off' },
  { id: 'exitApp',     label: 'Exit the app',                icon: '🚪', group: 'System', hidden: true },   // only used by the fixed Flip face-down gesture
  { id: 'quickShare',  label: 'Quick-send circle (top 5)',   icon: '⭕', group: 'Share', shareOnly: true },
  { id: 'sharePicker', label: 'Full share sheet',            icon: '↗',  group: 'Share', shareOnly: true },
  { id: 'voiceSearch', label: 'Voice search',                icon: '🎙', group: 'Smart' },
  { id: 'codexMini',   label: 'Codex bar',                   icon: '🤖', group: 'Codex' },
  { id: 'codexFull',   label: 'Codex full panel',            icon: '🗂', group: 'Codex' },
  { id: 'codexTalk',   label: 'Talk to Codex (mic on)',      icon: '🗣', group: 'Codex' },
  { id: 'circleAsk',   label: 'Circle to Ask',               icon: '🔵', group: 'Codex' },
  { id: 'scrollTop',   label: 'Scroll to top',               icon: '⬆️', group: 'Smart' },
  { id: 'toggleSound', label: 'Mute / unmute AI alerts',     icon: '🔊', group: 'Smart' },
  ...PAGES.map(([key, label, icon]) => ({ id: `go:${key}`, label: `Open ${label}`, icon, group: 'Go to' })),
];
const ACTION_IDS = new Set(ACTIONS.map(a => a.id));
export const actionById = (id) => ACTIONS.find(a => a.id === id) || ACTIONS[0];
export const actionsFor = (gesture) => ACTIONS.filter(a => !a.hidden && (!a.shareOnly || gesture.share));

// ---- shake sensitivity -------------------------------------------------------------------------------------------
// Threshold = change in acceleration (m/s²) between two readings that counts as one "jolt"; 3 jolts in ~1 s = a shake.
export const SENSITIVITY = { low: 30, medium: 22, high: 15 };

// ---- storage -----------------------------------------------------------------------------------------------------
const defaults = () => ({
  map: Object.fromEntries(GESTURES.map(g => [g.id, g.def])),
  shakeSens: 'medium',
  people: { mode: 'auto', list: [] },   // mode 'auto' = recent chats then people you follow; 'custom' = your own picks first
});

export function loadGestures() {
  const d = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return d;
    const map = { ...d.map };
    for (const g of GESTURES) {
      const v = raw.map?.[g.id];
      const a = typeof v === 'string' && ACTION_IDS.has(v) ? v : null;
      if (a && (!actionById(a).shareOnly || g.share)) map[g.id] = a;
      if (g.fixed) map[g.id] = g.fixed;      // permanent gestures ignore anything saved
    }
    const people = raw.people && typeof raw.people === 'object' ? raw.people : d.people;
    return {
      map,
      shakeSens: Object.hasOwn(SENSITIVITY, raw.shakeSens) ? raw.shakeSens : d.shakeSens,
      people: {
        mode: people.mode === 'custom' ? 'custom' : 'auto',
        list: (Array.isArray(people.list) ? people.list : []).filter(u => u && typeof u.username === 'string').slice(0, 5)
          .map(u => ({ id: u.id, username: u.username, displayName: u.displayName || u.username, avatarColor: u.avatarColor, displayMode: u.displayMode, avatarPhotoUrl: u.avatarPhotoUrl, profileVideoUrl: u.profileVideoUrl })),
      },
    };
  } catch { return d; }
}

export function saveGestures(next) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not persisted */ }
  try { window.dispatchEvent(new Event(CHANGED)); } catch { /* old browser */ }
  return next;
}

export const actionFor = (gestureId) => loadGestures().map[gestureId] || 'none';
export function setGestureAction(gestureId, actionId) {
  const cur = loadGestures();
  return saveGestures({ ...cur, map: { ...cur.map, [gestureId]: actionId } });
}
export const resetGestures = () => saveGestures(defaults());

// ---- firing ------------------------------------------------------------------------------------------------------
// ctx: for share gestures { kind, id, thumb, thumbType, x, y }; for others whatever the caller has.
export function fireGesture(gestureId, ctx = {}) {
  const action = actionFor(gestureId);
  if (action === 'none') return false;
  try { navigator.vibrate?.(15); } catch { /* no haptics */ }
  window.dispatchEvent(new CustomEvent(GESTURE_EVENT, { detail: { gestureId, action, ctx } }));
  return true;
}

// ---- long-press / double-tap helpers for plain buttons (bottom bar, ＋/⋯) ---------------------------------------------
// Plain functions (not hooks) so they work inside .map(); one press at a time, so module state is enough.
const HOLD_MS = 480;
let hold = null;            // { id, timer, x, y }
let swallowClickFor = null; // gesture id whose click must be ignored (the click that follows a fired long press)

const cancelHold = () => { if (hold) { clearTimeout(hold.timer); hold = null; } };

// Spread on a button:  <button {...holdProps('searchHold')} …>. It only reacts when that gesture has an action,
// so with "Do nothing" the button behaves exactly as before.
export function holdProps(gestureId) {
  return {
    onPointerDown: (e) => {
      if ((e.button !== undefined && e.button > 0) || actionFor(gestureId) === 'none') return;
      cancelHold();
      swallowClickFor = null;
      const x = e.clientX, y = e.clientY;
      hold = { id: gestureId, x, y, timer: setTimeout(() => {
        hold = null;
        if (fireGesture(gestureId, { x, y })) swallowClickFor = gestureId;
      }, HOLD_MS) };
    },
    onPointerMove: (e) => { if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 12) cancelHold(); },
    onPointerUp: cancelHold, onPointerLeave: cancelHold, onPointerCancel: cancelHold,
    onContextMenu: (e) => { if (actionFor(gestureId) !== 'none') e.preventDefault(); },   // no phone "save/copy" menu on a held icon
    onClickCapture: (e) => { if (swallowClickFor === gestureId) { swallowClickFor = null; e.stopPropagation(); e.preventDefault(); } },
    style: { WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' },
  };
}

let lastTap = { id: null, t: 0 };
// Call from a button's onClick. Returns true on the second tap within 320 ms (and the gesture has an action).
export function registerTap(gestureId) {
  const now = Date.now();
  const double = lastTap.id === gestureId && now - lastTap.t < 320;
  lastTap = double ? { id: null, t: 0 } : { id: gestureId, t: now };
  return double && fireGesture(gestureId);
}

// ---- top-5 people ------------------------------------------------------------------------------------------------
let peopleCache = { at: 0, key: '', list: null };

// The five people shown in the quick-send circle. `api` + `me` are passed in so this file stays dependency-free.
export async function loadTopPeople(api, me, { force = false } = {}) {
  const cfg = loadGestures().people;
  const key = `${me?.id}|${cfg.mode}|${cfg.list.map(u => u.username).join(',')}`;
  if (!force && peopleCache.list && peopleCache.key === key && Date.now() - peopleCache.at < 60_000) return peopleCache.list;

  const out = [];
  const seen = new Set([me?.id]);
  const add = (u) => { if (u && u.id && !seen.has(u.id) && out.length < 5) { seen.add(u.id); out.push(u); } };
  if (cfg.mode === 'custom') cfg.list.forEach(add);
  if (out.length < 5) {
    try {
      const { conversations = [] } = await api.conversations();
      for (const c of conversations) {
        if (c.type === 'group' || c.name) continue;
        add((c.participants || []).find(p => p.id !== me?.id));
      }
    } catch { /* offline: fall through to following */ }
  }
  if (out.length < 5 && me?.username) {
    try { (await api.getFollowing(me.username)).users?.forEach(add); } catch { /* none */ }
  }
  peopleCache = { at: Date.now(), key, list: out };
  return out;
}
export const clearPeopleCache = () => { peopleCache = { at: 0, key: '', list: null }; };

// ---- motion permission (iPhone/iPad only ask for it, and only from a tap) -------------------------------------------
export const motionSupported = () => typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
export const motionNeedsPermission = () => motionSupported() && typeof window.DeviceMotionEvent?.requestPermission === 'function';
export async function requestMotionPermission() {
  if (!motionSupported()) return 'unsupported';
  if (!motionNeedsPermission()) return 'granted';
  try { return await window.DeviceMotionEvent.requestPermission(); } catch { return 'denied'; }
}

// ---- shake detector ----------------------------------------------------------------------------------------------
// Returns a stop() function. Calls onShake() after 3 hard jolts within ~1 s, then waits 2.5 s before it can fire again.
export function startShakeDetector(onShake, getThreshold = () => SENSITIVITY.medium) {
  let last = null, jolts = [], quietUntil = 0;
  const onMotion = (e) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const now = Date.now();
    if (last) {
      const delta = Math.hypot(a.x - last.x, a.y - last.y, a.z - last.z);
      if (delta > getThreshold() && now > quietUntil) {
        if (!jolts.length || now - jolts[jolts.length - 1] > 90) jolts.push(now);   // one jolt per ~90 ms, not per sample
        jolts = jolts.filter(t => now - t < 1000);
        if (jolts.length >= 3) { jolts = []; quietUntil = now + 2500; onShake(); }
      }
    }
    last = { x: a.x, y: a.y, z: a.z };
  };
  window.addEventListener('devicemotion', onMotion);
  return () => window.removeEventListener('devicemotion', onMotion);
}

// ---- screen-wide touch gestures --------------------------------------------------------------------------------------
// Multi-finger taps, two-finger swipes and edge swipes. Passive listeners only, so scrolling and pinch-zoom are never blocked.
// `getActive(id)` lets the caller skip work for gestures set to "Do nothing". Returns a stop() function.
const EDGE_PX = 22;       // how close to the screen edge a swipe must start
export function startScreenGestures(onGesture, getActive = () => true) {
  let t = null;           // current touch session
  let mouse = null;       // desktop edge-swipe (so you can try it with a mouse)

  const centre = (list) => {
    let x = 0, y = 0;
    for (const p of list) { x += p.clientX; y += p.clientY; }
    return { x: x / list.length, y: y / list.length };
  };
  const spread = (list) => (list.length < 2 ? 0 : Math.hypot(list[0].clientX - list[1].clientX, list[0].clientY - list[1].clientY));
  const inField = (el) => !!el?.closest?.('input, textarea, select, [contenteditable="true"], video, canvas, [data-no-gesture]');

  const onStart = (e) => {
    if (!t) t = { t0: Date.now(), max: 0, moved: 0, c0: null, d0: 0, cN: null, dN: 0, blocked: inField(e.target), startX: e.touches[0].clientX };
    t.max = Math.max(t.max, e.touches.length);
    if (e.touches.length >= 2 && !t.c0) { t.c0 = centre(e.touches); t.d0 = spread(e.touches); t.dN = t.d0; }
    if (e.touches.length === 1 && t.max === 1) t.single = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onMove = (e) => {
    if (!t) return;
    if (t.c0 && e.touches.length >= 2) { t.cN = centre(e.touches); t.dN = spread(e.touches); }
    if (t.max === 1 && t.single) t.last = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    const c = centre(e.touches);
    const from = t.c0 || t.single;
    if (from) t.moved = Math.max(t.moved, Math.hypot(c.x - from.x, c.y - from.y));
  };
  const onEnd = (e) => {
    if (!t || e.touches.length > 0) return;       // wait for the last finger to lift
    const s = t; t = null;
    if (s.blocked) return;
    const dur = Date.now() - s.t0;
    const w = window.innerWidth;

    if (s.max >= 2 && s.c0) {
      const dx = s.cN ? s.cN.x - s.c0.x : 0, dy = s.cN ? s.cN.y - s.c0.y : 0;
      const pinched = s.d0 > 0 && s.dN > 0 && Math.abs(s.dN - s.d0) / s.d0 > 0.3;      // fingers moved apart/together = zoom, not a swipe
      if (s.moved < 18 && !pinched && Math.abs(s.dN - s.d0) < 24 && dur < 350) {         // tap (fingers stayed put, no pinch)
        const id = s.max === 2 ? 'twoTap' : s.max === 3 ? 'threeTap' : null;
        if (id && getActive(id)) onGesture(id);
      } else if (s.max === 2 && !pinched && dur < 900 && Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx) * 1.6) {
        const id = dy < 0 ? 'twoSwipeUp' : 'twoSwipeDown';
        if (getActive(id)) onGesture(id);
      }
      return;
    }
    if (s.max === 1 && s.single && s.last && dur < 700) {
      const dx = s.last.x - s.single.x, dy = s.last.y - s.single.y;
      if (Math.abs(dy) > 70 || Math.abs(dx) < 80) return;
      if (s.single.x >= w - EDGE_PX && dx < 0 && getActive('edgeRight')) onGesture('edgeRight');
      else if (s.single.x <= EDGE_PX && dx > 0 && getActive('edgeLeft')) onGesture('edgeLeft');
    }
  };
  const onCancel = () => { t = null; };

  // mouse version of the edge swipe, for desktop testing
  const onMouseDown = (e) => {
    if (e.button !== 0 || inField(e.target)) return;
    const w = window.innerWidth;
    if (e.clientX >= w - EDGE_PX || e.clientX <= EDGE_PX) mouse = { x: e.clientX, y: e.clientY, t0: Date.now(), w };
  };
  const onMouseUp = (e) => {
    const m = mouse; mouse = null;
    if (!m || Date.now() - m.t0 > 900) return;
    const dx = e.clientX - m.x, dy = e.clientY - m.y;
    if (Math.abs(dy) > 70 || Math.abs(dx) < 80) return;
    if (m.x >= m.w - EDGE_PX && dx < 0 && getActive('edgeRight')) onGesture('edgeRight');
    else if (m.x <= EDGE_PX && dx > 0 && getActive('edgeLeft')) onGesture('edgeLeft');
  };

  const opt = { passive: true, capture: true };
  window.addEventListener('touchstart', onStart, opt);
  window.addEventListener('touchmove', onMove, opt);
  window.addEventListener('touchend', onEnd, opt);
  window.addEventListener('touchcancel', onCancel, opt);
  window.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('mouseup', onMouseUp, true);
  return () => {
    window.removeEventListener('touchstart', onStart, opt);
    window.removeEventListener('touchmove', onMove, opt);
    window.removeEventListener('touchend', onEnd, opt);
    window.removeEventListener('touchcancel', onCancel, opt);
    window.removeEventListener('mousedown', onMouseDown, true);
    window.removeEventListener('mouseup', onMouseUp, true);
  };
}

// ---- flip face-down detector -----------------------------------------------------------------------------------------
// Fires once when the phone has lain flat, screen-down, for ~0.7 s; re-arms when it is picked up again.
export function startFlipDetector(onFlip) {
  let since = 0, armed = true;
  const onOrient = (e) => {
    if (e.beta == null || e.gamma == null) return;
    const down = Math.abs(e.beta) > 150 && Math.abs(e.gamma) < 30;
    const upright = Math.abs(e.beta) < 110;
    const now = Date.now();
    if (down) {
      if (!since) since = now;
      if (armed && now - since > 700) { armed = false; onFlip(); }
    } else {
      since = 0;
      if (upright) armed = true;
    }
  };
  window.addEventListener('deviceorientation', onOrient);
  return () => window.removeEventListener('deviceorientation', onOrient);
}
