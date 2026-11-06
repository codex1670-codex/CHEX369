// Real theme persistence — spec #180 ("turn on dark mode" / settings-level theme control).
// The DEFAULT theme (nothing saved yet) is "light" = white & gold; dark (royal navy & gold) is one tap away.
import { applyColors, resetColors } from './colors.js';
import { clearPremium } from './premiumThemes.js';
import type { ThemeName } from './types';

const KEY = 'nexa.theme';

export function getStoredTheme(): ThemeName {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'light';
  } catch {
    return 'light';
  }
}

/**
 * `resetCustom` is true when the person explicitly taps Dark/Light (Settings or Codex): their saved
 * custom colours are cleared so the whole app switches at once. At startup it is false, so a saved
 * colour scheme survives reloads.
 */
export function applyTheme(theme: string, resetCustom = false): ThemeName {
  const t: ThemeName = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(KEY, t); } catch { /* storage unavailable — theme just won't persist */ }
  if (resetCustom) { clearPremium(); resetColors(); } else applyColors();
  return t;
}
