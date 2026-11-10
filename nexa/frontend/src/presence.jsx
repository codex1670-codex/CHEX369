// Live "who is online" state for the whole app. The server pushes a small event whenever
// someone connects or disconnects, and sends the full list once on (re)connect.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getSocket } from './socket.js';

const PresenceContext = createContext(new Set());

export function PresenceProvider({ children, enabled = true }) {
  const [online, setOnline] = useState(() => new Set());

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let socket = null;
    let timer = null;
    const loadAll = () => socket?.emit('presence:list', (res) => { if (!cancelled && res?.online) setOnline(new Set(res.online)); });
    const onUpdate = ({ userId, online: isOn }) => setOnline(prev => {
      if (prev.has(userId) === !!isOn) return prev;
      const next = new Set(prev);
      if (isOn) next.add(userId); else next.delete(userId);
      return next;
    });
    // The socket is created by App after sign-in; wait for it, then (re)load on every connect.
    const attach = () => {
      socket = getSocket();
      if (!socket) { timer = setTimeout(attach, 300); return; }
      socket.on('presence:update', onUpdate);
      socket.on('connect', loadAll);
      if (socket.connected) loadAll();
    };
    attach();
    return () => {
      cancelled = true; clearTimeout(timer);
      socket?.off('presence:update', onUpdate);
      socket?.off('connect', loadAll);
      setOnline(new Set());
    };
  }, [enabled]);

  const value = useMemo(() => online, [online]);
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export const useOnlineSet = () => useContext(PresenceContext);
export const useIsOnline = (userId) => !!userId && useContext(PresenceContext).has(userId);
