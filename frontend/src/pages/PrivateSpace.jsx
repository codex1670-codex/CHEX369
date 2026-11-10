import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, setPrivateSession, inPrivateSpace } from '../api.js';
import { AuthContext } from '../AuthContext.jsx';
import { reconnectSocket } from '../socket.ts';
import Feed from './Feed.jsx';
import Search from './Search.jsx';
import Reels from './Reels.jsx';
import Messages from './Messages.jsx';
import Profile from './Profile.jsx';
import '../private.css';

const TABS = [
  { key: 'home', label: 'Home', icon: '🏠' },
  { key: 'search', label: 'Search', icon: '🔍' },
  { key: 'reels', label: 'Reels', icon: '🎬' },
  { key: 'messages', label: 'Chats', icon: '💬' },
  { key: 'gallery', label: 'Gallery', icon: '🖼️' },
  { key: 'profile', label: 'Profile', icon: '👤' },
];
const AUTO_LOCK_MS = 5 * 60 * 1000; // locks itself after 5 minutes with the app in the background

// ---------------- password gate / first-time setup ----------------
function Gate({ phase, onSession }) {
  const [form, setForm] = useState({ username: '', displayName: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const setup = phase === 'setup';

  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (setup && form.password !== form.confirm) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    try {
      const session = setup
        ? await api.privateSetup({ username: form.username.trim().toLowerCase(), displayName: form.displayName.trim(), password: form.password })
        : await api.privateEnter(form.password);
      setForm({ username: '', displayName: '', password: '', confirm: '' });
      onSession(session);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="pv-gate">
      <form className="glass-card pv-gate-card" onSubmit={submit} autoComplete="off">
        <div className="pv-lock" aria-hidden="true">🔒</div>
        <h2>{setup ? 'Create your private space' : 'Private space'}</h2>
        <p className="pv-sub">{setup
          ? 'A second, password-protected profile with its own username, followers and chats. Posts, reels and people are shared with the normal app; your Messages and Profile stay separate. No games, CHEX learn or sticky notes here.'
          : 'Enter your private password to open it.'}</p>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {setup && <>
          <div className="field"><label>Private username</label><input value={form.username} onChange={set('username')} placeholder="e.g. night.owl" autoCapitalize="none" autoCorrect="off" required /></div>
          <div className="field"><label>Private display name</label><input value={form.displayName} onChange={set('displayName')} placeholder="Name shown in your private space" /></div>
        </>}
        <div className="field"><label>{setup ? 'Private password (6+ characters)' : 'Password'}</label>
          <input type="password" value={form.password} onChange={set('password')} placeholder="Password" autoComplete="new-password" autoFocus required /></div>
        {setup && <div className="field"><label>Confirm password</label><input type="password" value={form.confirm} onChange={set('confirm')} placeholder="Confirm password" autoComplete="new-password" required /></div>}
        <button className="btn-primary" disabled={busy}>{busy ? 'Please wait…' : setup ? 'Create & open' : 'Unlock'}</button>
      </form>
    </div>
  );
}

// ---------------- private gallery ----------------
function Gallery() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);
  const fileRef = useRef(null);
  const load = useCallback(() => api.privateGallery().then(r => setItems(r.items)).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    const files = [...(e.target.files || [])]; e.target.value = '';
    if (!files.length) return;
    setBusy(true); setError('');
    for (const f of files) {
      try { const r = await api.privateGalleryUpload(f); setItems(list => [r.item, ...(list || [])]); }
      catch (err) { setError(err.message); }
    }
    setBusy(false);
  };
  const remove = async (it) => {
    if (!window.confirm('Delete this from your private gallery?')) return;
    try { await api.privateGalleryDelete(it.id); setItems(list => list.filter(x => x.id !== it.id)); setView(null); } catch (err) { setError(err.message); }
  };
  const download = (it) => { const a = document.createElement('a'); a.href = it.url; a.download = it.name || `chex-private-${it.id}`; document.body.appendChild(a); a.click(); a.remove(); };

  return (
    <div className="pv-gallery">
      <div className="pv-gallery-head">
        <div><b>Private gallery</b><div className="pv-sub">Photos and videos saved from CHEX, or added from your device. Only visible here.</div></div>
        <button className="btn-primary" style={{ width: 'auto', padding: '9px 16px' }} disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Adding…' : '＋ Add'}</button>
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={add} />
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {items === null && <div className="empty-state"><span className="loading-dot" /> Loading…</div>}
      {items?.length === 0 && <div className="empty-state"><div className="glyph">🖼️</div>Nothing here yet. Use “🔒 Save to private” on any photo or video in CHEX, or tap ＋ Add.</div>}
      <div className="pv-grid">
        {items?.map(it => (
          <button key={it.id} type="button" className="pv-tile" onClick={() => setView(it)} aria-label={`Open ${it.kind}`}>
            {it.kind === 'video' ? <video src={it.url} muted playsInline preload="metadata" /> : <img src={it.url} alt="" loading="lazy" />}
            {it.kind === 'video' && <span className="pv-play" aria-hidden="true">▶</span>}
          </button>
        ))}
      </div>
      {view && createPortal(
        <div className="pv-viewer" role="dialog" aria-modal="true" onClick={() => setView(null)}>
          <div className="pv-viewer-bar" onClick={e => e.stopPropagation()}>
            <button type="button" className="btn-ghost" onClick={() => download(view)}>⬇️ Download</button>
            <button type="button" className="btn-ghost" onClick={() => remove(view)}>🗑️ Delete</button>
            <button type="button" className="btn-ghost" onClick={() => setView(null)} aria-label="Close">✕</button>
          </div>
          <div className="pv-viewer-media" onClick={e => e.stopPropagation()}>
            {view.kind === 'video' ? <video src={view.url} controls autoPlay playsInline /> : <img src={view.url} alt="" />}
          </div>
        </div>, document.body)}
    </div>
  );
}

// ---------------- private settings (change password) ----------------
function PrivateSettings({ onClose, onLock }) {
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [msg, setMsg] = useState(''); const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault(); setError(''); setMsg('');
    try { await api.privatePassword(cur, next); setMsg('Password changed.'); setCur(''); setNext(''); } catch (err) { setError(err.message); }
  };
  return createPortal(
    <div className="pv-viewer" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="glass-card pv-gate-card" onSubmit={save} onClick={e => e.stopPropagation()}>
        <h2>Private settings</h2>
        {error && <div className="error-banner">{error}</div>}
        {msg && <div className="request-banner">{msg}</div>}
        <div className="field"><label>Current password</label><input type="password" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" required /></div>
        <div className="field"><label>New password (6+ characters)</label><input type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" required /></div>
        <button className="btn-primary">Change password</button>
        <button type="button" className="btn-ghost" style={{ marginTop: 8, width: '100%' }} onClick={onLock}>🔒 Lock now</button>
        <button type="button" className="btn-ghost" style={{ marginTop: 8, width: '100%' }} onClick={onClose}>Close</button>
      </form>
    </div>, document.body);
}

// ---------------- the space itself ----------------
export default function PrivateSpace({ onLayout }) {
  const auth = useContext(AuthContext);
  const [phase, setPhase] = useState('loading');   // loading | setup | locked | open
  const [shadow, setShadow] = useState(null);
  const [tab, setTab] = useState('home');
  const [profileUsername, setProfileUsername] = useState(null);
  const [msgStart, setMsgStart] = useState(null);
  const [reelId, setReelId] = useState(null);
  const [settings, setSettings] = useState(false);
  const hiddenAt = useRef(0);

  useEffect(() => { api.privateStatus().then(r => setPhase(r.exists ? 'locked' : 'setup')).catch(() => setPhase('locked')); }, []);

  const open = (session) => {
    setPrivateSession(session.token);
    reconnectSocket();            // the realtime connection now belongs to the private profile
    setShadow(session.user); setTab('home'); setProfileUsername(null); setPhase('open');
  };
  const lock = useCallback(() => {
    if (inPrivateSpace()) { setPrivateSession(null); reconnectSocket(); window.dispatchEvent(new Event('chex:refresh-counts')); }
    setShadow(null); setSettings(false); setPhase(p => (p === 'open' ? 'locked' : p));
  }, []);

  // Leaving the page, an expired session, or a long time in the background always locks it again.
  useEffect(() => () => { if (inPrivateSpace()) { setPrivateSession(null); reconnectSocket(); window.dispatchEvent(new Event('chex:refresh-counts')); } }, []);
  useEffect(() => {
    const expired = () => lock();
    const vis = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > AUTO_LOCK_MS) lock();
    };
    window.addEventListener('chex:private-expired', expired);
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('chex:private-expired', expired); document.removeEventListener('visibilitychange', vis); };
  }, [lock]);

  // Messages need the tall "fixed" page layout; tell the shell.
  useEffect(() => { onLayout?.(phase === 'open' && tab === 'messages'); return () => onLayout?.(false); }, [phase, tab, onLayout]);

  // Everything inside acts as the private profile (posts, chats, follows, calls …).
  const ctx = useMemo(() => (auth && shadow ? { ...auth, user: shadow, setUser: (u) => setShadow(prev => (typeof u === 'function' ? u(prev) : u)), logout: async () => lock(), clearSession: lock } : auth), [auth, shadow, lock]);

  const openProfile = (u) => { setProfileUsername(u || shadow?.username); setTab('profile'); };
  const openChat = (u) => { setMsgStart(u); setTab('messages'); };

  if (phase === 'loading') return <div className="empty-state"><span className="loading-dot" /> Loading…</div>;
  if (phase !== 'open' || !shadow) return <Gate phase={phase} onSession={open} />;

  return (
    <AuthContext.Provider value={ctx}>
      <div className={`pv-space ${tab === 'messages' ? 'pv-fill' : ''}`}>
        <div className="pv-head">
          <div className="pv-title"><span aria-hidden="true">🔒</span> Private space <small>@{shadow.username}</small></div>
          <div className="pv-head-actions">
            <button type="button" className="btn-ghost" onClick={() => setSettings(true)} aria-label="Private settings">⚙️</button>
            <button type="button" className="btn-ghost" onClick={lock}>Lock</button>
          </div>
        </div>
        <div className="tabs pv-tabs" role="tablist">
          {TABS.map(t => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''}
              onClick={() => { setTab(t.key); if (t.key === 'profile') setProfileUsername(shadow.username); }}>{t.icon} {t.label}</button>
          ))}
        </div>
        <div className={`pv-body ${tab === 'messages' ? 'pv-body-fill' : ''}`}>
          {tab === 'home' && <Feed onOpenProfile={openProfile} />}
          {tab === 'search' && <Search onOpenProfile={openProfile} onOpenReel={(id) => { setReelId(id); setTab('reels'); }} />}
          {tab === 'reels' && <Reels startReelId={reelId} onConsumeStart={() => setReelId(null)} />}
          {tab === 'messages' && <Messages startWithUsername={msgStart} onConsumeStart={() => setMsgStart(null)} onOpenReel={(id) => { setReelId(id); setTab('reels'); }} />}
          {tab === 'gallery' && <Gallery />}
          {tab === 'profile' && <Profile username={profileUsername || shadow.username} onOpenMessage={openChat} onOpenProfile={openProfile} onOpenSettings={() => setSettings(true)} />}
        </div>
        {settings && <PrivateSettings onClose={() => setSettings(false)} onLock={lock} />}
      </div>
    </AuthContext.Provider>
  );
}

