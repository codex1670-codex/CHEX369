let current = { screen: 'feed' };

export function setCodexContext(partial) {
  current = { ...partial };
}

export function updateCodexContext(partial) {
  current = { ...current, ...partial };
}

const squash = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// A live description of whatever page is on screen right now: title, section headings, the selected
// tab, whether a dialog is open, and a short text digest. It is read from the page itself at command
// time, so EVERY page (feed, search, notifications, games, settings, My life, learn, stickies, coins…)
// is visible to the AI without each page having to report anything. Never throws.
export function describePage() {
  try {
    if (typeof document === 'undefined') return null;
    const main = document.querySelector('main.main-col') || document.body;
    const pick = (sel, max) => [...main.querySelectorAll(sel)]
      .filter(el => !el.closest('[hidden], [aria-hidden="true"]'))
      .map(el => squash(el.textContent, 60)).filter(Boolean).slice(0, max);
    const dialog = document.querySelector('[role="dialog"], .modal, [class$="-modal"], [class$="-sheet"]');
    const vw = window.innerWidth || 0;
    return {
      title: squash(document.title, 80),
      headings: pick('h1, h2, h3, .page-title', 8),
      activeTabs: pick('[aria-selected="true"], [aria-current="page"], .tabs .active, .feed-tabs .active, [class*="tab"].active', 6),
      dialogOpen: !!dialog,
      dialogText: dialog ? squash(dialog.textContent, 240) : undefined,
      text: squash(main.innerText || main.textContent, 700),
      device: vw && vw <= 800 ? 'phone' : vw <= 1000 ? 'tablet' : 'desktop',
      viewport: { w: vw, h: window.innerHeight || 0 },
      theme: document.documentElement.getAttribute('data-theme') || undefined,
    };
  } catch { return null; }
}

export function getCodexContext() {
  const page = describePage();
  return page ? { ...current, page } : current;
}
