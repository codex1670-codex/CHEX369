import { useEffect, useState } from 'react';
import PermissionsPanel from './PermissionsPanel.jsx';
import { getAllStatuses, anyUndecided } from '../permissions.js';

// First-run sheet: asks once for notifications, microphone, camera, location and the rest.
// (Replaces the old notifications-only prompt.) Everything stays available later in Settings.
export default function PermissionsPrompt() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem('chex.permsAsked') === '1') return; } catch { /* ignore */ }
    let t;
    getAllStatuses().then((s) => { if (anyUndecided(s)) t = setTimeout(() => setShow(true), 4000); }); // after the splash
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  const close = () => { try { localStorage.setItem('chex.permsAsked', '1'); } catch { /* ignore */ } setShow(false); };
  return (
    <div className="perm-scrim" role="dialog" aria-modal="true" aria-label="Allow permissions">
      <div className="perm-sheet glass-card">
        <div className="perm-title">Allow CHEX on your phone</div>
        <p className="perm-sub">So calls, camera, voice and notifications work. You can change any of these later in Settings.</p>
        <PermissionsPanel />
        <button className="btn-ghost perm-done" onClick={close}>Done</button>
      </div>
    </div>
  );
}
