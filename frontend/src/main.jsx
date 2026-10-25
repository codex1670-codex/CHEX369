import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import AppBackground from './components/AppBackground.jsx';
import { AuthProvider } from './AuthContext.jsx';
import './styles.css';
import { getStoredTheme, applyTheme } from './theme.js';
import { apply3D } from './ui3d.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';

// Applied before first paint so there's no flash of the wrong theme.
applyTheme(getStoredTheme());
apply3D();

ReactDOM.createRoot(document.getElementById('root')).render(
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
