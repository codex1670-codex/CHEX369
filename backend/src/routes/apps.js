import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { findApp, launchInfo } from '../appCatalog.js';

const router = Router();

function appDTO(app) {
  const aliases = db.prepare('SELECT alias FROM app_aliases WHERE app_id = ?').all(app.id).map(a => a.alias);
  return {
    id: app.id, displayName: app.display_name, launchUrlWeb: app.launch_url_web,
    hasSearch: !!app.search_url_template, nativeOnly: !!app.native_only, aliases,
  };
}

router.get('/', requireAuth, (_req, res) => {
  const apps = db.prepare('SELECT * FROM app_registry ORDER BY display_name ASC').all();
  res.json({ apps: apps.map(appDTO) });
});

// Resolves a free-text app name (and optional search words) to launch info for the phone:
//  - the installed app is opened by Android package / iOS URL scheme,
//  - if it is not installed (or this is a computer) the client falls back to Google.
// The frontend does the actual launching (appLauncher.js); this never fakes success.
router.post('/resolve', requireAuth, (req, res) => {
  const { query, searchFor } = req.body || {};
  if (!String(query || '').trim()) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Provide an app name.' } });
  }
  const app = findApp(db, query);
  if (!app) {
    // Not in the catalog at all: still useful — let Google find it.
    const name = String(query).trim().slice(0, 80);
    return res.json({
      resolved: true, launchable: true, app: { id: null, displayName: name, aliases: [] },
      launch: { id: null, name, android: null, ios: null, webUrl: null, searchUrl: null, fallbackUrl: `https://www.google.com/search?q=${encodeURIComponent(searchFor ? `${name} ${searchFor}` : `${name} app`)}` },
      url: `https://www.google.com/search?q=${encodeURIComponent(name)}`,
    });
  }
  const launch = launchInfo(app, searchFor);
  res.json({ resolved: true, launchable: true, app: appDTO(app), launch, url: launch.webUrl || launch.fallbackUrl });
});

export default router;
