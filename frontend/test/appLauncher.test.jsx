import { describe, it, expect, vi, afterEach } from 'vitest';
import { launchApp, androidIntentUrl } from '../src/appLauncher.js';

const WA = { name: 'WhatsApp', android: 'com.whatsapp', ios: 'whatsapp://', webUrl: 'https://web.whatsapp.com', searchUrl: null, fallbackUrl: 'https://www.google.com/search?q=WhatsApp%20app' };
const YT = { name: 'YouTube', android: 'com.google.android.youtube', ios: 'youtube://', webUrl: 'https://www.youtube.com/results?search_query=cats', searchUrl: 'https://www.youtube.com/results?search_query=cats', fallbackUrl: 'https://www.google.com/search?q=YouTube%20cats' };
const setUA = (ua, platform = 'Linux armv8l', touch = 5) => {
  for (const [k, v] of [['userAgent', ua], ['platform', platform], ['maxTouchPoints', touch]]) {
    Object.defineProperty(navigator, k, { value: v, configurable: true });
  }
};
const fakeWin = () => ({ location: { href: '' }, open: vi.fn(), document: { hidden: false, addEventListener: vi.fn() }, addEventListener: vi.fn() });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('appLauncher', () => {
  it('Android: launches the installed app by package, with Google as the not-installed fallback', () => {
    setUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120');
    const w = fakeWin();
    expect(launchApp(WA, { win: w })).toBe('android');
    expect(w.location.href).toContain('package=com.whatsapp');
    expect(w.location.href).toContain('S.browser_fallback_url=' + encodeURIComponent(WA.fallbackUrl));
    expect(w.location.href.startsWith('intent://')).toBe(true);
  });

  it('Android + search: the intent carries the app link so the app opens on that search', () => {
    const u = androidIntentUrl(YT);
    expect(u).toContain('intent://www.youtube.com/results?search_query=cats#Intent;scheme=https;package=com.google.android.youtube;');
  });

  it('iPhone: tries the app scheme, then falls back to Google if still on screen', () => {
    vi.useFakeTimers();
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari', 'iPhone', 5);
    const w = fakeWin();
    expect(launchApp(WA, { win: w })).toBe('ios');
    expect(w.location.href).toBe('whatsapp://');
    vi.advanceTimersByTime(1700);
    expect(w.location.href).toBe(WA.fallbackUrl);
  });

  it('iPhone: no Google fallback when the app really opened (page hidden)', () => {
    vi.useFakeTimers();
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari', 'iPhone', 5);
    const w = fakeWin();
    launchApp(WA, { win: w });
    w.document.hidden = true;
    vi.advanceTimersByTime(1700);
    expect(w.location.href).toBe('whatsapp://');
  });

  it('computer: opens the website, or Google when the app has none', () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', 'Win32', 0);
    let w = fakeWin();
    expect(launchApp(WA, { win: w })).toBe('web');
    expect(w.open).toHaveBeenCalledWith('https://web.whatsapp.com', '_blank', 'noopener');
    w = fakeWin();
    expect(launchApp({ ...WA, webUrl: null, android: null }, { win: w })).toBe('google');
    expect(w.open).toHaveBeenCalledWith(WA.fallbackUrl, '_blank', 'noopener');
  });
});
