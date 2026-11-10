import { useEffect, useRef } from 'react';
import { connectSocket } from './socket.js';
import { CLIENT_ID } from './api.js';

// useLive(scopes, callback): run `callback(event)` whenever ANOTHER user (or another tab/device of
// yours) changes something in one of `scopes` ('posts','reels','stories','notes','highlights','users').
// Bursts are merged (350 ms), the tab's own writes are ignored (the UI already shows them), and the
// callback also runs when the socket reconnects or the tab becomes visible again, so nothing is missed
// while the phone was asleep or offline.
export function useLive(scopes, callback, { enabled = true } = {}) {
  const cb = useRef(callback);
  cb.current = callback;
  const key = Array.isArray(scopes) ? scopes.join(',') : String(scopes);
  useEffect(() => {
    if (!enabled) return undefined;
    const want = new Set(key.split(','));
    const socket = connectSocket();
    let timer = null, last = null;
    const fire = (ev) => {
      last = ev || last;
      clearTimeout(timer);
      timer = setTimeout(() => { try { cb.current?.(last || {}); } catch { /* ignore */ } last = null; }, 350);
    };
    const onUpdate = (ev) => {
      if (!ev || !want.has(ev.scope)) return;
      if (ev.from && ev.from === CLIENT_ID) return;
      fire(ev);
    };
    const onConnect = () => fire({ scope: 'reconnect' });
    const onVisible = () => { if (document.visibilityState === 'visible') fire({ scope: 'visible' }); };
    socket.on('live:update', onUpdate);
    socket.io.on('reconnect', onConnect);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      socket.off('live:update', onUpdate);
      socket.io.off('reconnect', onConnect);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, enabled]);
}
