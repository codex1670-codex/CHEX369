// Phone keyboard handling. When the on-screen keyboard opens, the fixed bottom menu bar, the AI
// button and other floating bits would ride up on top of the keyboard and cover almost the whole
// visible page. We detect the keyboard and put `kb-open` on <html>, and the CSS hides those floating
// controls and lets the page use the full visible height. Also keeps the field you're typing in
// visible. Safe no-op on desktop.
const TEXT_TYPES = new Set(['text', 'search', 'email', 'password', 'url', 'tel', 'number', '']);
const isTextField = el => !!el && (
  el.tagName === 'TEXTAREA' || el.isContentEditable ||
  (el.tagName === 'INPUT' && TEXT_TYPES.has((el.getAttribute('type') || '').toLowerCase())));

export function initKeyboardAware() {
  if (typeof window === 'undefined' || window.__chexKeyboardInit) return;
  window.__chexKeyboardInit = true;
  const root = document.documentElement;
  const vv = window.visualViewport;
  let baseHeight = Math.max(window.innerHeight, vv?.height || 0);
  let open = false;

  const apply = (next) => {
    if (next === open) return;
    open = next;
    root.classList.toggle('kb-open', next);
  };

  const update = () => {
    const h = vv ? vv.height : window.innerHeight;
    root.style.setProperty('--vvh', `${Math.round(h)}px`);
    // Rotation or a taller URL bar changes the "closed" height: only trust it while nothing is focused.
    if (!isTextField(document.activeElement)) baseHeight = Math.max(window.innerHeight, h);
    const shrunk = baseHeight - h > 120;                 // keyboards are 200px+; URL-bar wobble is ~60px
    apply(shrunk && isTextField(document.activeElement));
  };

  const keepVisible = (el) => {
    if (!isTextField(el)) return;
    // Wait for the keyboard animation, then scroll the field into the visible area.
    setTimeout(() => { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* old browser */ } }, 320);
  };

  document.addEventListener('focusin', (e) => { update(); keepVisible(e.target); });
  document.addEventListener('focusout', () => setTimeout(update, 60));
  vv?.addEventListener('resize', update);
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', () => setTimeout(() => { baseHeight = Math.max(window.innerHeight, vv?.height || 0); update(); }, 300));
  update();
}
