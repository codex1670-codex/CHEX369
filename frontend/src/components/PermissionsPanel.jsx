import { useCallback, useEffect, useState } from 'react';
import { PERMS, getAllStatuses, requestPermission, requestAll } from '../permissions.js';
import { needsInstall, sendTestPush } from '../push.js';

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
  const [testMsg, setTestMsg] = useState('');
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
  const sendTest = async () => {
    setBusy(true); setTestMsg('');
    const r = await sendTestPush();
    setTestMsg(r.ok ? `Sent to ${r.devices} device${r.devices === 1 ? '' : 's'}. If nothing appears in a few seconds, see the tips below.` : r.reason === 'not-allowed' ? 'Allow notifications first.' : 'This phone is not registered yet. Tap Allow again, or close and reopen CHEX and try once more.');
    setBusy(false);
  };
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
      {st.notifications === 'granted' && <><button className="btn-ghost perm-all" disabled={busy} onClick={sendTest}>Send a test notification</button>{testMsg && <p className="perm-help" role="status">{testMsg}</p>}</>}
      {needsInstall() && <p className="perm-help">iPhone / iPad: notifications only work after you add CHEX to the Home Screen — tap Share, then “Add to Home Screen”, and open CHEX from that icon. (Needs iOS 16.4 or newer.)</p>}
      {st.notifications !== 'unsupported' && <p className="perm-help">Not getting notifications? Make sure they are allowed for this browser or CHEX in your phone Settings → Notifications. On Samsung, Xiaomi, Oppo, Vivo, Realme and Huawei phones, also set the battery for the browser/CHEX to “Unrestricted” (no battery optimisation), otherwise the phone may stop alerts while the app is closed.</p>}
      {undecided && <button className="btn-primary perm-all" disabled={busy} onClick={allowAll}>{busy ? 'Waiting for your answer…' : 'Allow all'}</button>}
      {blocked && <p className="perm-help">Some are blocked. Tap the 🔒 beside the web address (or open your phone Settings → Apps → CHEX → Permissions), switch them to Allow, then come back here.</p>}
      <p className="perm-help">Ordinary phone-number calls and your contact list can't be opened by a web app. CHEX voice and video calls work inside the app using the microphone and camera.</p>
    </div>
  );
}
