import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import AppBackground from './components/AppBackground.jsx';
import { AuthProvider } from './AuthContext.jsx';
import './styles.css';
import './mobile.css';
import './royal.css';
import './premium.css';
import './frames.css';
import './stickies.css';
import './life.css';
import './learn/learn.css';
import './responsive.css';
import './games/games3d.css';
import './polish.css';
import './tailwind.css';
import './compact.css';
import './gestures/gestures.css';   // smart gestures: quick-send circle, voice search, settings card
import './orbit/orbit.css';   // CHEX Orbit: 3D glass launcher (double-tap any screen)
import './glassnav.css';   // floating glass bottom bar + launcher menu
import './moremenu.css';   // launcher menu: round glass orbs + line icons (matches Orbit)
import './premiumglass.css';   // all glass: cards, posts, reels, games, buttons (must stay last)
import { getStoredTheme, applyTheme } from './theme.js';
import { initPremium } from './premiumThemes.js';
import { apply3D } from './ui3d.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { initKeyboardAware } from './keyboard.js';
import { applyCompact, startCompactLayer } from './compact.js';
import { startScrollPerformance } from './scrollPerformance.js';

// Applied before first paint so there's no flash of the wrong theme.
applyTheme(getStoredTheme());
initPremium();
apply3D();
initKeyboardAware();
applyCompact();       // compact mode (icons + short text), on unless switched off in Settings
startCompactLayer();
startScrollPerformance(); // temporarily pause expensive card blur/decorative motion while scrolling

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <AppBackground />
    <ErrorBoundary full title="CHEX hit an unexpected problem.">
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// Offline-capable, installable app (production builds only, so dev hot-reload is unaffected).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
