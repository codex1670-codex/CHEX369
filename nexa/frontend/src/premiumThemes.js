// Premium animated themes. Sits on top of theme.js / colors.js: each theme saves a colour scheme
// (so contrast checks and every var(--…) in the app keep working) and adds accent tokens plus a
// data-premium attribute that premium.css uses for animated backgrounds, rings, glass and motion.
import { saveColors } from './colors.js';

const KEY = 'nexa.premium';
const MOTION_KEY = 'nexa.motion';
const THEME_KEY = 'nexa.theme';

// a/b/c = three accent hues (drifting orbs, rings, buttons). ink = accent used for small text/icons.
export const PREMIUM_THEMES = [
  { id: 'amber',    name: 'Amber Noir',    mode: 'dark',  bgA: '#070403', bgB: '#2e1c0e', angle: 0, text: '#fff4e6', box: '#16100b', a: '#ffb54d', b: '#ff7e33', c: '#ffd98a', ink: '#ffc470', tag: 'Warm, cinematic' },
  { id: 'slate',    name: 'Teal Slate',    mode: 'dark',  bgA: '#13131b', bgB: '#232330', angle: 160, text: '#f3f4f8', box: '#262633', a: '#10d4c0', b: '#18a8f0', c: '#7af0e4', ink: '#3ee6d4', tag: 'Soft, modern' },
  { id: 'aurora',   name: 'Aurora',        mode: 'dark',  bgA: '#050816', bgB: '#10163a', text: '#f4f6ff', box: '#0d1230', a: '#7c5cff', b: '#22d3ee', c: '#ff5ca8', ink: '#a99bff', tag: 'Northern lights' },
  { id: 'obsidian', name: 'Obsidian Gold', mode: 'dark',  bgA: '#060606', bgB: '#1a1408', text: '#fff6dc', box: '#121009', a: '#ffc83d', b: '#ff9a1f', c: '#e8a317', ink: '#ffd66b', tag: 'Black-tie luxe' },
  { id: 'neon',     name: 'Neon Noir',     mode: 'dark',  bgA: '#07040f', bgB: '#1a0630', text: '#fdf4ff', box: '#150a26', a: '#ff2bd6', b: '#00e5ff', c: '#8b5cf6', ink: '#ff7ae8', tag: 'City after dark' },
  { id: 'emerald',  name: 'Emerald Velvet',mode: 'dark',  bgA: '#02110d', bgB: '#07281f', text: '#effff8', box: '#08201a', a: '#10d9a0', b: '#d9f99d', c: '#f5c542', ink: '#5eeac0', tag: 'Deep forest' },
  { id: 'sunset',   name: 'Sunset Glass',  mode: 'light', bgA: '#fff4ec', bgB: '#ffd9ec', text: '#2a0f1f', box: '#fffaf6', a: '#ff7a18', b: '#ff2d75', c: '#8a2be2', ink: '#c2185b', tag: 'Golden-hour gradient' },
  { id: 'rose',     name: 'Rose Quartz',   mode: 'light', bgA: '#fff1f5', bgB: '#f3e8ff', text: '#2b1030', box: '#fffafc', a: '#f472b6', b: '#c084fc', c: '#fda4af', ink: '#a21caf', tag: 'Soft & dreamy' },
  { id: 'pearl',    name: 'Ocean Pearl',   mode: 'light', bgA: '#eefaff', bgB: '#e4ecff', text: '#06223a', box: '#fbfeff', a: '#0ea5e9', b: '#6366f1', c: '#2dd4bf', ink: '#0369a1', tag: 'Clean & breezy' },
];

const VARS = ['--p-a', '--p-b', '--p-c', '--violet', '--violet-bright', '--pink', '--teal', '--violet-ink'];

export const getPremiumId = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
export const getMotion = () => { try { return localStorage.getItem(MOTION_KEY) !== 'off'; } catch { return true; } };

function paint(t) {
  const r = document.documentElement, s = r.style;
  r.setAttribute('data-premium', t.id);
  s.setProperty('--p-a', t.a); s.setProperty('--p-b', t.b); s.setProperty('--p-c', t.c);
  s.setProperty('--violet', t.a); s.setProperty('--violet-bright', t.b);
  s.setProperty('--pink', t.c === '#fda4af' || t.c === '#ffd98a' || t.c === '#7af0e4' ? t.b : t.c);
  s.setProperty('--teal', t.b);
  s.setProperty('--violet-ink', t.ink);      // set last: colors.js writes this too
}

export function applyPremium(id) {
  const t = PREMIUM_THEMES.find(x => x.id === id);
  if (!t) return clearPremium();
  try { localStorage.setItem(THEME_KEY, t.mode); localStorage.setItem(KEY, t.id); } catch { /* not persisted */ }
  document.documentElement.setAttribute('data-theme', t.mode);
  saveColors({ bgA: t.bgA, bgB: t.bgB, text: t.text, box: t.box, angle: t.angle ?? 160 });
  paint(t);
  return t;
}

export function clearPremium() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  const r = document.documentElement;
  r.removeAttribute('data-premium');
  VARS.forEach(v => r.style.removeProperty(v));
}

export function setMotion(on) {
  try { localStorage.setItem(MOTION_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  document.documentElement.setAttribute('data-motion', on ? 'on' : 'off');
  return on;
}

// Called once at startup, after applyTheme(): re-applies accents only (colours are already saved).
export function initPremium() {
  document.documentElement.setAttribute('data-motion', getMotion() ? 'on' : 'off');
  const t = PREMIUM_THEMES.find(x => x.id === getPremiumId());
  if (t) paint(t);
}
