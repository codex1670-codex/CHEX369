// Circle to Ask — capturing ONLY the circled area, and reading ONLY its text.
//
// Why draw the page instead of using the browser's screen-capture (getDisplayMedia)?
//   • No scary "share your entire screen" prompt, and it works on phones where that API doesn't exist.
//   • We draw from a COPY of the page, so passwords, card fields, chat bubbles and typed text can be blacked
//     out before a single pixel exists. Screen capture would grab them and we'd have to hope to blur them later.
//   • It can never see another app, a notification, or anything outside CHEX.
import { overlapFraction, fitSize } from './region.js';
import { CONTROLS_ONLY_ROUTES, NO_PICTURE_ROUTES, SENSITIVE_SELECTOR, BUBBLE_SELECTOR, maskSensitiveIn, redactText } from './sensitive.js';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'IFRAME']);
const CONTROL_SELECTOR = 'button, a, [role="button"], [role="tab"], [role="switch"], [role="menuitem"], label, summary, h1, h2, h3, [aria-label]';
const squash = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

const ownText = (el) => { let t = ''; for (const n of el.childNodes) if (n.nodeType === 3) t += ` ${n.nodeValue}`; return squash(t, 200); };

// What the circled area says: visible text + the buttons/links in it. Sensitive elements are skipped entirely.
export function collectRegionText(rect, { doc = document, route = '', getRect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; } } = {}) {
  const controlsOnly = CONTROLS_ONLY_ROUTES.has(route);
  const view = doc.defaultView;
  let skipped = 0;
  const found = [];
  const controls = [];

  const walker = doc.createTreeWalker(doc.body, 1 /* SHOW_ELEMENT */, {
    acceptNode(el) {
      if (SKIP_TAGS.has(el.tagName) || el.hasAttribute('data-circle-ui') || el.hidden || el.getAttribute('aria-hidden') === 'true') return 2; // REJECT subtree
      if (el.matches(`${SENSITIVE_SELECTOR},${BUBBLE_SELECTOR}`)) { skipped++; return 2; }
      try { const cs = view?.getComputedStyle?.(el); if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return 2; } catch { /* ignore */ }
      return 1; // ACCEPT (children are still visited)
    },
  });

  for (let el = walker.nextNode(); el; el = walker.nextNode()) {
    const isControl = el.matches(CONTROL_SELECTOR);
    const r = getRect(el);
    if (overlapFraction(r, rect) < 0.5) continue;
    if (isControl) {
      const label = squash(el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.querySelector?.('img[alt]')?.getAttribute('alt'), 40);
      if (label && !controls.includes(label) && !(el.matches('h1,h2,h3,label') )) controls.push(label);
    }
    if (controlsOnly && !isControl) continue;
    const text = ownText(el) || (isControl ? squash(el.getAttribute('aria-label') || el.getAttribute('title'), 80) : '') || squash(el.tagName === 'IMG' ? el.getAttribute('alt') : '', 80);
    if (text) found.push({ x: r.x, y: r.y, text });
  }

  found.sort((a, b) => (Math.abs(a.y - b.y) < 6 ? a.x - b.x : a.y - b.y));
  const parts = [];
  for (const f of found) if (parts[parts.length - 1] !== f.text) parts.push(f.text);
  const { text, count } = redactText(parts.join(' · '), 1200);
  const { text: ctl } = redactText(controls.slice(0, 10).join(', '), 300);
  return { text: ctl ? `${text} || Buttons and links here: ${ctl}`.trim() : text, controls: controls.slice(0, 10), hidden: skipped + count };
}

// Scale a canvas down and encode it as a small JPEG (≤ maxBytes), trying lower quality, then a smaller size.
export function encodeJpeg(source, { maxEdge = 1024, maxBytes = 900_000, createCanvas = () => document.createElement('canvas') } = {}) {
  let edge = maxEdge;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { w, h } = fitSize(source.width, source.height, edge);
    const c = createCanvas(); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.drawImage(source, 0, 0, w, h);
    for (const q of [0.72, 0.6, 0.5]) {
      const url = c.toDataURL('image/jpeg', q);
      const data = url.slice(url.indexOf(',') + 1);
      if (data.length * 0.75 <= maxBytes) return { mediaType: 'image/jpeg', data, previewUrl: url, width: w, height: h, bytes: Math.round(data.length * 0.75) };
    }
    edge = Math.round(edge * 0.75);
  }
  throw new Error('picture too large');
}

const pageBackground = (doc) => (doc.documentElement.getAttribute('data-theme') === 'light' ? '#ffffff' : '#0b1020');

// Returns { image|null, text, controls, hidden, reason? }. Never throws: any failure falls back to text-only.
export async function captureRegion(rect, {
  route = '', doc = document, win = window, maxEdge = 1024, maxBytes = 900_000, timeoutMs = 10_000,
  loadHtml2canvas = () => import('html2canvas').then((m) => m.default || m), createCanvas,
} = {}) {
  const read = collectRegionText(rect, { doc, route });
  const base = { text: read.text, controls: read.controls, hidden: read.hidden };
  if (NO_PICTURE_ROUTES.has(route)) return { ...base, image: null, reason: 'text-only-screen' };

  try {
    const h2c = await loadHtml2canvas();
    let masked = 0;
    const canvas = await Promise.race([
      h2c(doc.documentElement, {
        x: rect.x + (win.scrollX || 0), y: rect.y + (win.scrollY || 0), width: Math.round(rect.w), height: Math.round(rect.h),
        scale: Math.min(win.devicePixelRatio || 1, 2), useCORS: true, allowTaint: false, logging: false, backgroundColor: pageBackground(doc),
        ignoreElements: (el) => !!el.hasAttribute?.('data-circle-ui'),
        onclone: (cloned) => { masked = maskSensitiveIn(cloned); },
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('capture timed out')), timeoutMs)),
    ]);
    const image = encodeJpeg(canvas, { maxEdge, maxBytes, createCanvas });
    return { ...base, hidden: base.hidden + masked, image };
  } catch {
    // Cross-origin pictures can taint the canvas, very large pages can time out, etc. Text still works.
    return { ...base, image: null, reason: 'capture-failed' };
  }
}
