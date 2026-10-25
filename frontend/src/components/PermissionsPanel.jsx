import { useCallback, useEffect, useState } from 'react';
import { PERMS, getAllStatuses, requestPermission, requestAll } from '../permissions.js';

const BADGE = {
  granted: { text: '✓ Allowed', cls: 'ok' },
  denied: { text: 'Blocked', cls: 'bad' },
  prompt: { text: 'Not asked', cls: '' },
  unsupported: { text: 'Not on this phone', cls: '' },
  insecure: { text: 'Needs https', cls: 'bad' },
};

// List of every phone permission with its state and an Allow button. Used in the first-run sheet and in Settings.
export default function PermissionsPanel({ onChange }) {
  const [st, setSt] = useState({});
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => { const s = await getAllStatuses(); setSt(s); onChange?.(s); }, [onChange]);

  useEffect(() => {
    refresh();
    // the person may change a permission in the phone's settings and come back
    const again = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', again);
    window.addEventListener('focus', again);
    return () => { document.removeEventListener('visibilitychange', again); window.removeEventListener('focus', again); };
  }, [refresh]);

  const allowOne = async (key) => { setBusy(true); await requestPermission(key); await refresh(); setBusy(false); };
  const allowAll = async () => { setBusy(true); await requestAll(); await refresh(); setBusy(false); };
  const undecided = Object.values(st).some((s) => s === 'prompt');
  const blocked = Object.values(st).some((s) => s === 'denied');

  return (
    <div className="perm-panel">
      {PERMS.map((p) => {
        const s = st[p.key] || 'prompt';
        const b = BADGE[s] || BADGE.prompt;
        return (
          <div className="perm-row" key={p.key}>
            <span className="perm-ico" aria-hidden>{p.icon}</span>
            <div className="perm-txt"><b>{p.label}</b><small>{p.why}</small></div>
            {s === 'prompt'
              ? <button className="pwa-btn" disabled={busy} onClick={() => allowOne(p.key)}>Allow</button>
              : <span className={`perm-badge ${b.cls}`}>{b.text}</span>}
          </div>
        );
      })}
      <div className="perm-row">
        <span className="perm-ico" aria-hidden>🖼</span>
        <div className="perm-txt"><b>Gallery &amp; files</b><small>Photos and videos from your phone gallery open whenever you tap upload. No permission needed.</small></div>
        <span className="perm-badge ok">✓ Ready</span>
      </div>
      {undecided && <button className="btn-primary perm-all" disabled={busy} onClick={allowAll}>{busy ? 'Waiting for your answer…' : 'Allow all'}</button>}
      {blocked && <p className="perm-help">Some are blocked. Tap the 🔒 beside the web address (or open your phone Settings → Apps → CHEX → Permissions), switch them to Allow, then come back here.</p>}
      <p className="perm-help">Ordinary phone-number calls and your contact list can't be opened by a web app. CHEX voice and video calls work inside the app using the microphone and camera.</p>
    </div>
  );
}
