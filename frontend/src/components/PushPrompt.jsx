import { useEffect, useState } from 'react';
import { enablePush, pushSupported } from '../push.js';

// Asks once for permission to show CHEX notifications on the phone's home screen / notification shade.
export default function PushPrompt() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!pushSupported() || Notification.permission !== 'default') return;
    if (localStorage.getItem('chex.pushAsked') === '1') return;
    const t = setTimeout(() => setShow(true), 4000); // after the splash, so it isn't the first thing they see
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  const close = () => { try { localStorage.setItem('chex.pushAsked', '1'); } catch { /* ignore */ } setShow(false); };
  const allow = async () => { await enablePush(); close(); };
  return (
    <div className="pwa-banner" role="dialog" aria-label="Allow notifications">
      <span>🔔 Allow notifications to get messages on your home screen.</span>
      <button className="pwa-btn" onClick={allow}>Allow</button>
      <button className="pwa-x" onClick={close} aria-label="Not now">✕</button>
    </div>
  );
}
