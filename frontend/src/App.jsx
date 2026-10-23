import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './AuthContext.jsx';
import Auth from './pages/Auth.jsx';
import Feed from './pages/Feed.jsx';
import Profile from './pages/Profile.jsx';
import Messages from './pages/Messages.jsx';
import Reels from './pages/Reels.jsx';
import Notifications from './pages/Notifications.jsx';
import Games from './pages/Games.jsx';
import Search from './pages/Search.jsx';
import Settings from './pages/Settings.jsx';
import Avatar from './components/Avatar.jsx';
import Codex from './components/Codex.jsx';
import CallLayer from './components/CallLayer.jsx';
import InstallBanner from './components/InstallBanner.jsx';
import Splash from './components/Splash.jsx';
import { api } from './api.js';
import { PresenceProvider } from './presence.jsx';
import { tiltMove, tiltLeave } from './ui3d.js';
import { connectSocket, disconnectSocket, getSocket } from './socket.js';
import { setCodexContext } from './codexContext.js';
import { announcementForBatch, notifyOnce, alertsEnabled, setAlertsEnabled } from './announce.js';
import PushPrompt from './components/PushPrompt.jsx';
import { syncPushIfAllowed } from './push.js';

const NAV = [
  { key: 'feed', label: 'Home', icon: '🏠' },
  { key: 'search', label: 'Search', icon: '🔍' },
  { key: 'reels', label: 'Reels', icon: '🎬' },
  { key: 'messages', label: 'Messages', icon: '💬' },
  { key: 'notifications', label: 'Notifications', icon: '🔔' },
  { key: 'games', label: 'Games', icon: '🎮' },
  { key: 'profile', label: 'Profile', icon: '👤' },
];

export default function App() {
  const { user, booting, logout } = useAuth();
  const [splashLeaving, setSplashLeaving] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [route, setRoute] = useState('feed');
  const [profileUsername, setProfileUsername] = useState(null);
  const [profileView, setProfileView] = useState(null); // 'saved-posts' | 'saved-reels' | 'reels-history' | 'profile-studio' | null
  const [joinCode, setJoinCode] = useState(null); // from an invite link: /?join=CODE
  const [gamesTab, setGamesTab] = useState(null); // 'discover' | 'friends' | 'mine' | 'tournaments' | null
  const [messageStart, setMessageStart] = useState(null);
  const [searchQuery, setSearchQuery] = useState(null);
  const [counts, setCounts] = useState({ messages: 0, other: 0 });
  const [aiAlerts, setAiAlerts] = useState(alertsEnabled());
  useEffect(() => {
    const sync = () => setAiAlerts(alertsEnabled());
    window.addEventListener('chex:alerts-changed', sync);
    return () => window.removeEventListener('chex:alerts-changed', sync);
  }, []);
  const announcedRef = useRef(null); // ids of unread notifications already spoken (null until first load)
  const [fabOpen, setFabOpen] = useState(false);
  const swipeRef = useRef(null); // touch start point for swipe-to-change-page
  const historyRef = useRef([]); // previous screens, so Codex's "go back" can return to them

  useEffect(() => {
    const t1 = setTimeout(() => setSplashLeaving(true), 2200);
    const t2 = setTimeout(() => setSplashDone(true), 2650);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // Phone/browser Back: from any page it returns to Home (one press), and from Home it leaves the app
  // as normal. Every non-Home page shares a single history entry, so switching pages never piles up.
  useEffect(() => {
    if (!user) return;
    try {
      if (route === 'feed') { if (window.history.state?.chex) window.history.back(); }
      else if (window.history.state?.chex) window.history.replaceState({ chex: route }, '');
      else window.history.pushState({ chex: route }, '');
    } catch { /* history unavailable */ }
  }, [route, user]);
  useEffect(() => {
    const onPop = (e) => {
      const target = e.state?.chex;
      setRoute(target && NAV.some(n => n.key === target) ? target : 'feed');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // PWA home-screen shortcuts open "/?open=messages" or "/?open=reels" — honour them once signed in.
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const code = (params.get('join') || '').replace(/[^a-z0-9]/gi, '').slice(0, 12).toUpperCase();
    if (code) {
      setRoute('games'); setJoinCode(code);
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }
    const target = params.get('open');
    if (target && NAV.some(n => n.key === target)) {
      setRoute(target);
      setCodexContext({ screen: target });
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    connectSocket();
    syncPushIfAllowed(); // keep this phone subscribed for home-screen notifications
    announcedRef.current = null;
    let timer = null;
    // Reload the badge counts; for anything new, have the AI say who it is from.
    const refresh = async (announce) => {
      try {
        const res = await api.notifications();
        setCounts({ messages: res.unreadMessages || 0, other: res.unreadOther || 0 });
        const unreadItems = res.notifications.filter(n => !n.read);
        if (announcedRef.current === null) {
          // App just opened: say once who has been waiting ("Message from user-1, user-2 and user-3").
          announcedRef.current = new Set(unreadItems.map(n => n.id));
          if (unreadItems.length) notifyOnce(announcementForBatch(unreadItems));
          return;
        }
        const fresh = unreadItems.filter(n => !announcedRef.current.has(n.id)).reverse(); // oldest first
        fresh.forEach(n => announcedRef.current.add(n.id));
        if (announce && fresh.length) notifyOnce(announcementForBatch(fresh)); // live: one chime + one spoken line per new arrival
      } catch { /* offline — keep last counts */ }
    };
    const onEvent = () => { clearTimeout(timer); timer = setTimeout(() => refresh(true), 350); };
    const onCounts = () => refresh(false);
    refresh(false);
    const socket = getSocket();
    ['notification:new', 'message:new', 'message_request:new'].forEach(ev => socket?.on(ev, onEvent));
    window.addEventListener('chex:refresh-counts', onCounts);
    return () => {
      clearTimeout(timer);
      ['notification:new', 'message:new', 'message_request:new'].forEach(ev => socket?.off(ev, onEvent));
      window.removeEventListener('chex:refresh-counts', onCounts);
      disconnectSocket();
    };
  }, [user]);

  // Launch screen: always shown briefly before login/home, then fades out.
  if (booting || !splashDone) return <Splash leaving={!booting && splashLeaving} />;
  if (!user) return <Auth />;

  const goBack = () => {
    const prev = historyRef.current.pop();
    if (!prev) return false;
    setProfileUsername(prev.profileUsername);
    setProfileView(prev.profileView);
    setGamesTab(prev.gamesTab);
    setRoute(prev.route);
    setCodexContext({ screen: prev.route });
    return true;
  };

  const navigate = (key, param) => {
    historyRef.current.push({ route, profileUsername, profileView, gamesTab });
    if (historyRef.current.length > 30) historyRef.current.shift();
    const username = typeof param === 'string' ? param : param?.username;
    const query = typeof param === 'object' ? param?.query : undefined;
    const tab = typeof param === 'object' ? param?.tab : undefined;
    const view = typeof param === 'object' ? param?.view : undefined;

    // 'saved-posts' / 'saved-reels' / 'reels-history' are deep links into the current
    // user's own Profile, not separate top-level screens (spec #164/#173's "Open my
    // saved reels" / "Show my reels history" etc).
    if (key === 'saved-posts' || key === 'saved-reels' || key === 'reels-history' || key === 'profile-studio') {
      setProfileUsername(user.username);
      setProfileView(key);
      setRoute('profile');
      setCodexContext({ screen: 'profile' });
      return;
    }
    if (key === 'profile') { setProfileUsername(username || user.username); setProfileView(['saved-posts', 'saved-reels', 'reels-history', 'profile-studio'].includes(view) ? view : null); }
    if (key === 'games') setGamesTab(tab && ['discover', '2players', 'friends', 'mine', 'tournaments'].includes(tab) ? tab : null);
    if (key === 'messages') setMessageStart(username || null);
    if (key === 'search' && query) setSearchQuery(query);
    setRoute(key);
    // Baseline context reset on navigation — the destination page's own effect will
    // shortly enrich this with real content (current reel/profile/conversation) once
    // it mounts and loads. Codex only ever reads this at command time, never earlier.
    setCodexContext({ screen: key });
  };
  const openSettings = () => navigate('settings');
  const badgeFor = (key) => (key === 'messages' ? counts.messages : key === 'notifications' ? counts.other : 0);
  const totalBadge = counts.messages + counts.other;
  const fmtCount = (n) => (n > 99 ? '99+' : String(n));
  // Phone: swipe left/right anywhere on the page to go to the next/previous page (Home → Search → Reels …).
  const swipeBlocked = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (/^(INPUT|TEXTAREA|SELECT|VIDEO|CANVAS|AUDIO)$/.test(n.tagName) || n.isContentEditable || n.dataset?.noswipe !== undefined) return true;
      if (n.scrollWidth > n.clientWidth + 4 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true; // horizontal scrollers (stories, chips…)
    }
    return false;
  };
  const onSwipeStart = (e) => {
    const t = e.touches[0];
    swipeRef.current = e.touches.length === 1 && window.innerWidth <= 800 && !swipeBlocked(e.target) ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
  };
  const onSwipeEnd = (e) => {
    const st = swipeRef.current; swipeRef.current = null;
    if (!st) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - st.x, dy = t.clientY - st.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8 || Date.now() - st.t > 700) return;
    const i = NAV.findIndex(n => n.key === route);
    if (i === -1) return;
    const next = NAV[i + (dx < 0 ? 1 : -1)];
    if (next) navigate(next.key, next.key === 'profile' ? user.username : undefined);
  };


  return (
    <PresenceProvider>
    <div className="app-shell">
      <nav className="nav-rail" aria-label="Main navigation">
        <img className="rail-logo" src="/logo.png" alt="CHEX" width="34" height="34" />
        {createPortal(
        <div className="rail-fab-wrap">
          {fabOpen && (
            <>
              <div className="rail-scrim" onClick={() => setFabOpen(false)} />
              <div className="rail-fab-menu" role="menu">
                {NAV.map((n, i) => (
                  <button key={n.key} role="menuitem" style={{ '--i': i }} onPointerMove={tiltMove} onPointerLeave={tiltLeave} className={route === n.key ? 'active' : ''} onClick={() => { setFabOpen(false); navigate(n.key, n.key === 'profile' ? user.username : undefined); }}>
                    <span className="ico">{n.icon}</span><span className="lbl">{n.label}</span>
                    {badgeFor(n.key) > 0 && <span className="count-badge">{fmtCount(badgeFor(n.key))}</span>}
                  </button>
                ))}
                <button role="menuitemcheckbox" aria-checked={aiAlerts} className="alerts-toggle" style={{ '--i': NAV.length }} onPointerMove={tiltMove} onPointerLeave={tiltLeave} onClick={() => setAlertsEnabled(!aiAlerts)}>
                  <span className="ico">{aiAlerts ? '🔊' : '🔇'}</span><span className="lbl">AI alerts: {aiAlerts ? 'On' : 'Off'}</span>
                </button>
              </div>
            </>
          )}
          <button className={`rail-fab ${fabOpen ? 'open' : ''}`}  onPointerMove={tiltMove} onPointerLeave={tiltLeave} aria-label={totalBadge > 0 ? `Quick actions, ${totalBadge} new` : 'Quick actions'} aria-expanded={fabOpen} onClick={() => setFabOpen(o => !o)}>＋{totalBadge > 0 && !fabOpen && <span className="count-badge fab-badge">{fmtCount(totalBadge)}</span>}</button>
        </div>
        , document.body)}
        <div style={{ flex: 1 }} />
        <div className="rail-user"><Avatar user={user} size={32} fullscreenOnClick online /></div>
        <button className="rail-item" onClick={logout} aria-label="Log out"><span className="pill">⏻</span><span className="rail-label">Log out</span></button>
      </nav>

      <main className={`main-col ${route === 'messages' ? 'fixed-page' : ''}`} onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd}>
        {route === 'feed' && <Feed onOpenProfile={(u) => navigate('profile', u)} />}
        {route === 'search' && <Search onOpenProfile={(u) => navigate('profile', u)} initialQuery={searchQuery} onConsumeQuery={() => setSearchQuery(null)} />}
        {route === 'reels' && <Reels />}
        {route === 'notifications' && <Notifications onOpenProfile={(u) => navigate('profile', u)} />}
        {route === 'games' && <Games initialTab={gamesTab} onConsumeInitialTab={() => setGamesTab(null)} initialJoinCode={joinCode} onConsumeJoinCode={() => setJoinCode(null)} />}
        {route === 'settings' && <Settings onBack={() => navigate('profile', user.username)} />}
        {route === 'profile' && (
          <Profile
            username={profileUsername || user.username}
            initialView={profileView}
            onConsumeInitialView={() => setProfileView(null)}
            onOpenMessage={(u) => navigate('messages', u)}
            onOpenProfile={(u) => navigate('profile', u)}
            onOpenSettings={openSettings}
          />
        )}
        {route === 'messages' && (
          <Messages startWithUsername={messageStart} onConsumeStart={() => setMessageStart(null)} />
        )}
      </main>

      <Codex navigate={navigate} goBack={goBack} currentUser={user} />
      <CallLayer />
      <InstallBanner />
      <PushPrompt />
    </div>
    </PresenceProvider>
  );
}
