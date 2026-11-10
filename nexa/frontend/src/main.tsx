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
import { getStoredTheme, applyTheme } from './theme.js';
import { initPremium } from './premiumThemes.js';
import { apply3D } from './ui3d.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { initKeyboardAware } from './keyboard.js';

// Applied before first paint so there's no flash of the wrong theme.
applyTheme(getStoredTheme());
initPremium();
apply3D();
initKeyboardAware();

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
