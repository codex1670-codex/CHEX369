import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './AuthContext.jsx';
import Auth from './pages/Auth.jsx';
import PageTransition from './motion/PageTransition';
import Skeleton from './ui/Skeleton';
import Feed from './pages/Feed.jsx';
import Profile from './pages/Profile.jsx';
import Messages from './pages/Messages.jsx';
import Reels from './pages/Reels.jsx';
import Notifications from './pages/Notifications.jsx';
import Games from './pages/Games.jsx';
import Search from './pages/Search.jsx';
import Settings from './pages/Settings.jsx';
import CoinStore from './pages/CoinStore.jsx';
import Admin from './pages/Admin.jsx';
import Stickies from './pages/Stickies.jsx';
import PrivateSpace from './pages/PrivateSpace.jsx';   // password-protected second profile (replaces the old My life page)
const LearnPage = lazy(() => import('./pages/LearnPage.jsx'));   // CHEX learn: loaded only when opened
import StickyAlerts from './components/StickyAlerts.jsx';
import AlarmRinger from './components/AlarmRinger.jsx';
import Avatar from './components/Avatar.jsx';
import Codex from './components/Codex.jsx';
import CallLayer from './components/CallLayer.jsx';
import InstallBanner from './components/InstallBanner.jsx';
import Splash from './components/Splash.jsx';
import { api, inPrivateSpace } from './api.js';
import { PresenceProvider } from './presence.jsx';
import { tiltMove, tiltLeave } from './ui3d.js';
import { applyTheme, getStoredTheme } from './theme.js';
import { getPremiumId } from './premiumThemes.js';
import { connectSocket, disconnectSocket, getSocket } from './socket.js';
import { setCodexContext, updateCodexContext } from './codexContext.js';
import { announcementForBatch, notifyOnce, alertsEnabled, setAlertsEnabled } from './announce.js';
import { burstEmoji } from './emojiFx.js';
import EmojiRain from './components/EmojiRain.jsx';
import PermissionsPrompt from './components/PermissionsPrompt.jsx';
import { syncPushIfAllowed, watchPush } from './push.js';

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
  const [privateFill, setPrivateFill] = useState(false); // Private space → Chats needs the tall page layout
  const [messageStart, setMessageStart] = useState(null);
  const [searchQuery, setSearchQuery] = useState(null);
  const [searchScope, setSearchScope] = useState(null); // 'reels' when opened by "search reel …"
  const [startReelId, setStartReelId] = useState(null); // reel opened from Search
  const [counts, setCounts] = useState({ messages: 0, other: 0 });
  const [aiAlerts, setAiAlerts] = useState(alertsEnabled());
  useEffect(() => {
    const sync = () => setAiAlerts(alertsEnabled());
    window.addEventListener('chex:alerts-changed', sync);
    return () => window.removeEventListener('chex:alerts-changed', sync);
  }, []);
  const routeRef = useRef('feed');          // current page, readable inside socket handlers
  routeRef.current = route;
  const announcedRef = useRef(null); // ids of unread notifications already spoken (null until first load)
  const [fabOpen, setFabOpen] = useState(false);
  const [coinToast, setCoinToast] = useState('');
  const coinTimer = useRef(null);
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
    if (target && (target === 'stickies' || target === 'mylife' || target === 'learn' || NAV.some(n => n.key === target))) {
      setRoute(target);
      setCodexContext({ screen: target });
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    connectSocket();
    syncPushIfAllowed(); // keep this phone subscribed for home-screen notifications
    const stopWatchingPush = watchPush(); // …and re-check whenever the app comes back to the front
    announcedRef.current = null;
    let timer = null;
    // Reload the badge counts; for anything new, have the AI say who it is from.
    const refresh = async (announce) => {
      if (inPrivateSpace()) return; // the realtime link belongs to the private profile right now — leave the normal badges alone
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
        // live: one chime + one spoken line + emoji burst per new arrival. While you are already inside Messages
        // it stays quiet: just the soft chime, no spoken line.
        if (announce && fresh.length) { notifyOnce(announcementForBatch(fresh), { silent: routeRef.current === 'messages' }); burstEmoji(); }
      } catch { /* offline — keep last counts */ }
    };
    const onEvent = () => { clearTimeout(timer); timer = setTimeout(() => refresh(true), 350); };
    const onCounts = () => refresh(false);
    refresh(false);
    const socket = getSocket();
    ['notification:new', 'message:new', 'message_request:new'].forEach(ev => socket?.on(ev, onEvent));
    const onCoins = (e) => {
      const n = e?.amount || 1;
      setCoinToast(e?.text || `🪙 +${n} CHEX coin${n === 1 ? '' : 's'} — ${e?.reason || 'nice one!'}`);
      clearTimeout(coinTimer.current);
      coinTimer.current = setTimeout(() => setCoinToast(''), 4500);
    };
    socket?.on('coins:earned', onCoins);
    window.addEventListener('chex:refresh-counts', onCounts);
    const onToast = (e) => { setCoinToast(e?.detail?.text || ''); clearTimeout(coinTimer.current); coinTimer.current = setTimeout(() => setCoinToast(''), 3500); };
    window.addEventListener('chex:toast', onToast);
    // Server closed this socket (account deactivated / deleted elsewhere): confirm and sign out right away.
    const onDisc = (reason) => { if (reason === 'io server disconnect') api.me().catch(() => logout()); };
    const onStatus = (e) => { if (e?.userId === user.id && e.status !== 'active') logout(); };
    socket?.on('disconnect', onDisc);
    socket?.on('account:status', onStatus);
    // Back online / back to the app: catch up on anything missed while it slept.
    const onBack = () => { if (document.visibilityState === 'visible') refresh(false); };
    document.addEventListener('visibilitychange', onBack);
    socket?.io?.on('reconnect', onBack);
    return () => {
      socket?.off('disconnect', onDisc);
      socket?.off('account:status', onStatus);
      document.removeEventListener('visibilitychange', onBack);
      socket?.io?.off('reconnect', onBack);
      socket?.off('coins:earned', onCoins);
      clearTimeout(coinTimer.current);
      clearTimeout(timer);
      stopWatchingPush();
      ['notification:new', 'message:new', 'message_request:new'].forEach(ev => socket?.off(ev, onEvent));
      window.removeEventListener('chex:refresh-counts', onCounts);
      window.removeEventListener('chex:toast', onToast);
      disconnectSocket();
    };
  }, [user]);

  // Launch screen: always shown briefly before login/home, then fades out.
  // Premium themes are a paid unlock: if this account hasn't unlocked them (new login on a shared
  // browser, edited storage), fall back to the plain Light/Dark look.
  useEffect(() => {
    if (!user || !getPremiumId()) return;
    api.coins().then(c => { if (!c.unlocked.includes('premium-themes')) applyTheme(getStoredTheme(), true); }).catch(() => {});
  }, [user?.id]);

  // Keep the AI's idea of the current page right on every route change, however it happened:
  // menu, bottom bar, swipe, the phone's Back button, an invite link, or the AI itself.
  useEffect(() => {
    if (user) updateCodexContext({ screen: route });
  }, [route, user]);

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
    const reelId = typeof param === 'object' ? param?.reelId : undefined;
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
    // A tapped game invite: go straight into that room (Games joins it as soon as it opens).
    if (key === 'games' && typeof param === 'object' && param?.joinCode) setJoinCode(String(param.joinCode).replace(/[^a-z0-9]/gi, '').slice(0, 12).toUpperCase());
    if (key === 'messages') setMessageStart(username || null);
    if (key === 'search') setSearchScope(typeof param === 'object' && param?.scope === 'reels' ? 'reels' : null);
    if (key === 'search' && query) setSearchQuery(query);
    if (key === 'reels') setStartReelId(reelId || null);
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
                <button role="menuitem" style={{ '--i': NAV.length }} onPointerMove={tiltMove} onPointerLeave={tiltLeave} className={route === 'mylife' ? 'active' : ''} onClick={() => { setFabOpen(false); navigate('mylife'); }}>
                  <span className="ico">🔒</span><span className="lbl">Private space</span>
                </button>
                <button role="menuitem" style={{ '--i': NAV.length + 1 }} onPointerMove={tiltMove} onPointerLeave={tiltLeave} className={route === 'learn' ? 'active' : ''} onClick={() => { setFabOpen(false); navigate('learn'); }}>
                  <span className="ico">🌍</span><span className="lbl">CHEX learn</span>
                </button>
                <button role="menuitem" style={{ '--i': NAV.length + 2 }} onPointerMove={tiltMove} onPointerLeave={tiltLeave} className={route === 'stickies' ? 'active' : ''} onClick={() => { setFabOpen(false); navigate('stickies'); }}>
                  <span className="ico">📌</span><span className="lbl">Sticky notes</span>
                </button>
                {user.isAdmin && (
                  <button role="menuitem" style={{ '--i': NAV.length + 3 }} onPointerMove={tiltMove} onPointerLeave={tiltLeave} className={route === 'admin' ? 'active' : ''} onClick={() => { setFabOpen(false); navigate('admin'); }}>
                    <span className="ico">🛡️</span><span className="lbl">Admin</span>
                  </button>
                )}
                <button role="menuitemcheckbox" aria-checked={aiAlerts} className="alerts-toggle" style={{ '--i': NAV.length + (user.isAdmin ? 4 : 3) }} onPointerMove={tiltMove} onPointerLeave={tiltLeave} onClick={() => setAlertsEnabled(!aiAlerts)}>
                  <span className="ico">{aiAlerts ? '🔊' : '🔇'}</span><span className="lbl">AI alerts: {aiAlerts ? 'On' : 'Off'}</span>
                </button>
              </div>
            </>
          )}
          <button className={`rail-fab ${fabOpen ? 'open' : ''}`}  onPointerMove={tiltMove} onPointerLeave={tiltLeave} aria-label={totalBadge > 0 ? `Quick actions, ${totalBadge} new` : 'Quick actions'} aria-expanded={fabOpen} onClick={() => setFabOpen(o => !o)}>＋{totalBadge > 0 && !fabOpen && <span className="count-badge fab-badge">{fmtCount(totalBadge)}</span>}</button>
        </div>
        , document.body)}
        <div style={{ flex: 1 }} />
        <button type="button" className="rail-user rail-user-btn" onClick={() => navigate('profile', user.username)} aria-label="Open my profile" title="My profile"><Avatar user={user} size={32} online /></button>
        <button className="rail-item" onClick={logout} aria-label="Log out"><span className="pill">⏻</span><span className="rail-label">Log out</span></button>
      </nav>

      <nav className="nav-bar-mobile" aria-label="Main navigation (phone)">
        {NAV.map((n) => (
          <button key={n.key} type="button" className={route === n.key ? 'active' : ''} aria-label={n.label} aria-current={route === n.key ? 'page' : undefined}
            onClick={() => navigate(n.key, n.key === 'profile' ? user.username : undefined)}>
            <span className="nb-ico" aria-hidden>{n.icon}{badgeFor(n.key) > 0 && <span className="count-badge nb-badge">{fmtCount(badgeFor(n.key))}</span>}</span>
            <span className="nb-lbl">{n.key === 'notifications' ? 'Alerts' : n.key === 'messages' ? 'Chats' : n.label}</span>
          </button>
        ))}
      </nav>

      {coinToast && <div className="coin-toast coin-toast-fixed" role="status">{coinToast}</div>}
      <PageTransition routeKey={route} className={`main-col ${route === 'messages' || (route === 'mylife' && privateFill) ? 'fixed-page' : ''}`} onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd}>
        {route === 'feed' && <Feed onOpenProfile={(u) => navigate('profile', u)} onOpenStickies={() => navigate('stickies')} onOpenLearn={() => navigate('learn')} onOpenAdmin={() => navigate('admin')} />}
        {route === 'search' && <Search onOpenProfile={(u) => navigate('profile', u)} onOpenReel={(id) => navigate('reels', { reelId: id })} initialQuery={searchQuery} initialScope={searchScope} onConsumeQuery={() => setSearchQuery(null)} />}
        {route === 'reels' && <Reels startReelId={startReelId} onConsumeStart={() => setStartReelId(null)} />}
        {route === 'notifications' && <Notifications onOpenProfile={(u) => navigate('profile', u)} onOpenGameInvite={(code) => navigate('games', { joinCode: code })} />}
        {route === 'games' && <Games initialTab={gamesTab} onConsumeInitialTab={() => setGamesTab(null)} initialJoinCode={joinCode} onConsumeJoinCode={() => setJoinCode(null)} />}
        {route === 'settings' && <Settings onBack={() => navigate('profile', user.username)} onOpenProfile={(u) => navigate('profile', u)} onOpenCoins={() => navigate('coins')} onOpenStickies={() => navigate('stickies')} onOpenMyLife={() => navigate('mylife')} />}
        {route === 'stickies' && <Stickies onBack={() => navigate('feed')} />}
        {route === 'mylife' && <PrivateSpace onLayout={setPrivateFill} />}
        {route === 'learn' && <Suspense fallback={<Skeleton label="Loading Learn" />}><LearnPage onBack={() => navigate('feed')} onOpenProfile={(u) => navigate('profile', u)} /></Suspense>}
        {route === 'admin' && user.isAdmin && <Admin onBack={() => navigate('feed')} onOpenProfile={(u) => navigate('profile', u)} />}
        {route === 'coins' && <CoinStore onBack={() => navigate('settings')} onOpenSettings={() => navigate('settings')} />}
        {route === 'profile' && (
          <Profile
            username={profileUsername || user.username}
            initialView={profileView}
            onConsumeInitialView={() => setProfileView(null)}
            onOpenMessage={(u) => navigate('messages', u)}
            onOpenProfile={(u) => navigate('profile', u)}
            onOpenSettings={openSettings}
            onOpenPrivateSpace={() => navigate('mylife')}
          />
        )}
        {route === 'messages' && (
          <Messages startWithUsername={messageStart} onConsumeStart={() => setMessageStart(null)} onOpenReel={(id) => navigate('reels', { reelId: id })} onJoinGame={(code) => navigate('games', { joinCode: code })} />
        )}
      </PageTransition>

      <Codex navigate={navigate} goBack={goBack} currentUser={user} />
      <StickyAlerts onOpen={() => navigate('stickies')} />
      <AlarmRinger />
      <EmojiRain />
      <CallLayer />
      <InstallBanner />
      <PermissionsPrompt />
    </div>
    </PresenceProvider>
  );
}
