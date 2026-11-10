// Opens an app from the catalog the way a phone expects:
//   Android  -> launches the INSTALLED app by package name (Chrome "intent:" link). If the app is
//               not installed, the same link makes Chrome open the Google search instead.
//   iPhone   -> tries the app's URL scheme; if nothing opened after a moment, goes to Google.
//   Computer -> opens the app's website (or Google when it has none).
// `launch` is the object from the server: { name, android, ios, webUrl, searchUrl, fallbackUrl }.

const ua = () => (typeof navigator !== 'undefined' ? navigator.userAgent || '' : '');
export const isAndroid = () => /Android/i.test(ua());
export const isIOS = () => /iPhone|iPad|iPod/i.test(ua()) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// intent://… link that opens `pkg`, or Google (S.browser_fallback_url) if it isn't installed.
export function androidIntentUrl(launch) {
  const fb = `S.browser_fallback_url=${encodeURIComponent(launch.fallbackUrl)}`;
  if (launch.searchUrl) {
    try {
      const u = new URL(launch.searchUrl);
      const scheme = u.protocol.replace(':', '');
      return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=${scheme};package=${launch.android};${fb};end`;
    } catch { /* fall through to a plain launch */ }
  }
  return `intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${launch.android};${fb};end`;
}

// Opens a normal web page (a Google answer, say) in a new tab. window.open() with "noopener" always
// returns null, so the plain call is used and the opener is cleared by hand; if the browser blocks the
// new tab, the page opens in this one rather than silently doing nothing.
export function openExternal(url, { win = window } = {}) {
  let w = null;
  try { w = win.open(url, '_blank'); } catch { /* blocked */ }
  if (w) { try { w.opener = null; } catch { /* cross-origin */ } return 'tab'; }
  win.location.href = url;
  return 'here';
}

// Returns which route was used, so callers/tests can tell: 'android' | 'ios' | 'web' | 'google'.
export function launchApp(launch, { win = window } = {}) {
  if (!launch) return 'none';
  if (isAndroid() && launch.android) {
    win.location.href = androidIntentUrl(launch);
    return 'android';
  }
  if (isIOS() && (launch.ios || launch.webUrl)) {
    if (launch.searchUrl || !launch.ios) { win.location.href = launch.webUrl || launch.fallbackUrl; return 'web'; } // universal links open the app when installed
    let left = false;
    const onHide = () => { left = true; };
    win.document.addEventListener('visibilitychange', onHide, { once: true });
    win.addEventListener('pagehide', onHide, { once: true });
    win.location.href = launch.ios;
    // Still looking at CHEX after 1.6s: the app isn't installed -> Google.
    setTimeout(() => { if (!left && !win.document.hidden) win.location.href = launch.fallbackUrl; }, 1600);
    return 'ios';
  }
  const url = launch.webUrl || launch.fallbackUrl;
  win.open(url, '_blank', 'noopener');
  return launch.webUrl ? 'web' : 'google';
}
