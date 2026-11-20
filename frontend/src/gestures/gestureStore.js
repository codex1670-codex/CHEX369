// Smart gestures — device-local settings + the tiny event bus the rest of the app talks to.
//
//  • 10 customizable gestures (Settings → Smart gestures). Each one is bound to an action from ACTIONS.
//  • Hold Share  → quick-send circle (top 5 people), Hold Search → voice search, Shake → Codex shortcut by default.
//  • Everything lives in this browser (localStorage), like the Floating AI bar and Circle to Ask.
//
// Nothing here touches the DOM on import; components call fireGesture() and <GestureHub> (mounted in App) acts on it.

const KEY = 'chex.gestures';
export const CHANGED = 'chex:gestures-changed';
export const GESTURE_EVENT = 'chex:gesture';

// ---- the 10 gestures -------------------------------------------------------------------------------------------
// `share: true` gestures carry an item (post/reel) and may use the share-only actions.
export const GESTURES = [
  { id: 'shareHold',   icon: '↗',  label: 'Hold Share button',     hint: 'Press and hold ↗ on a post or reel', share: true,  def: 'quickShare' },
  { id: 'searchHold',  icon: '🔍', label: 'Hold Search icon',      hint: 'Press and hold Search in the bottom bar',        def: 'voiceSearch' },
  { id: 'shake',       icon: '📳', label: 'Shake phone',           hint: 'Shake the phone firmly, side to side',            def: 'codexMini' },
  { id: 'homeDouble',  icon: '🏠', label: 'Double-tap Home icon',  hint: 'Tap Home twice, quickly',                         def: 'scrollTop' },
  { id: 'homeHold',    icon: '🏠', label: 'Hold Home icon',        hint: 'Press and hold Home',                             def: 'none' },
  { id: 'reelsHold',   icon: '🎬', label: 'Hold Reels icon',       hint: 'Press and hold Reels',                            def: 'none' },
  { id: 'chatsHold',   icon: '💬', label: 'Hold Chats icon',       hint: 'Press and hold Chats',                            def: 'none' },
  { id: 'alertsHold',  icon: '🔔', label: 'Hold Alerts icon',      hint: 'Press and hold Alerts',                           def: 'none' },
  { id: 'profileHold', icon: '👤', label: 'Hold Profile (Me) icon', hint: 'Press and hold Me',                              def: 'none' },
  { id: 'moreHold',    icon: '⋯',  label: 'Hold More (⋯) button',  hint: 'Press and hold More',                             def: 'none' },
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
export const actionsFor = (gesture) => ACTIONS.filter(a => !a.shareOnly || gesture.share);

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
