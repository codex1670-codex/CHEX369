import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getStoredTheme, applyTheme } from '../src/theme.js';
import { MODE_DEFAULTS, PRESETS, worstContrast, getActiveColors } from '../src/colors.js';
import { openExternal } from '../src/appLauncher.js';

const root = document.documentElement;
beforeEach(() => { localStorage.clear(); root.removeAttribute('data-theme'); root.removeAttribute('style'); });

describe('default theme is white & gold', () => {
  it('with nothing saved, the app starts in the light (white & gold) theme', () => {
    expect(getStoredTheme()).toBe('light');
    applyTheme(getStoredTheme());
    expect(root.getAttribute('data-theme')).toBe('light');
    const grad = root.style.getPropertyValue('--app-bg-grad');
    expect(grad).toContain('#ffffff');     // white …
    expect(grad).toContain('#fff3c4');     // … fading to pale gold
    expect(root.style.getPropertyValue('--surface')).toBe('#fffdf6');
  });

  it('white & gold letters are easy to read (WCAG AAA-level contrast)', () => {
    expect(worstContrast(MODE_DEFAULTS.light)).toBeGreaterThan(7);
    expect(PRESETS[0].name).toBe('White gold');
  });

  it('a saved dark choice is respected; picking Dark/Light flips everything, Codex included', () => {
    localStorage.setItem('nexa.theme', 'dark');
    expect(getStoredTheme()).toBe('dark');
    applyTheme('dark', true);
    const dark = root.style.getPropertyValue('--bg-deep');
    applyTheme('light', true);
    const light = root.style.getPropertyValue('--bg-deep');
    expect(dark).not.toBe(light);                       // the colour tokens the Codex box reads really change
    expect(getActiveColors()).toEqual(MODE_DEFAULTS.light);
  });
});

describe('Codex follows the theme (no hard-coded dark box)', () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf8');
  const rule = (sel) => (css.match(new RegExp('(?:^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')) || [])[1] || '';
  it('mini box, reply card and panel are painted with theme variables', () => {
    for (const sel of ['.codex-mini', '.codex-mini-reply']) expect(rule(sel)).toContain('var(--bg-deep)');
    expect(rule('.codex-mini')).not.toMatch(/rgba\(16, 12, 30/);
    expect(rule('.codex-mini-reply')).not.toMatch(/rgba\(16, 12, 30/);
    expect(rule('.codex-mini-btn')).toContain('var(--text-hi)');
  });
});

describe('openExternal', () => {
  it('opens a new tab, and clears its opener', () => {
    const tab = { opener: {} };
    const win = { open: vi.fn(() => tab), location: { href: '' } };
    expect(openExternal('https://www.google.com/search?q=x', { win })).toBe('tab');
    expect(win.open).toHaveBeenCalledWith('https://www.google.com/search?q=x', '_blank');
    expect(tab.opener).toBeNull();
  });
  it('if the browser blocks the new tab, it opens in this one instead of doing nothing', () => {
    const win = { open: vi.fn(() => null), location: { href: '' } };
    expect(openExternal('https://www.google.com/search?q=x', { win })).toBe('here');
    expect(win.location.href).toBe('https://www.google.com/search?q=x');
  });
});
