import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';
import { useAuth } from '../AuthContext.jsx';

// "Share" for a post or a reel: lists the people you follow and who follow you, lets you search
// (also for anyone else on the app), pick one or more and send it to their chat.
// kind: 'post' | 'reel'.
export default function ShareSheet({ kind, id, onClose }) {
  const { user } = useAuth();
  const [people, setPeople] = useState(null);   // following + followers, merged
  const [query, setQuery] = useState('');
  const [found, setFound] = useState([]);       // server search matches (anyone on the app)
  const [picked, setPicked] = useState([]);     // usernames
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    Promise.allSettled([api.getFollowing(user.username), api.getFollowers(user.username)]).then(([fing, fers]) => {
      if (!live) return;
      const following = fing.status === 'fulfilled' ? fing.value.users : [];
      const followers = fers.status === 'fulfilled' ? fers.value.users : [];
      const byId = new Map();
      following.forEach(u => byId.set(u.id, { ...u, rel: 'Following' }));
      followers.forEach(u => byId.set(u.id, byId.has(u.id) ? { ...byId.get(u.id), rel: 'Mutual' } : { ...u, rel: 'Follows you' }));
      setPeople([...byId.values()].filter(u => u.id !== user.id));
    });
    return () => { live = false; };
  }, [user.username, user.id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const matches = (u) => !q || u.username.toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q);
  const shown = useMemo(() => (people || []).filter(matches), [people, q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Anyone else on the app, found by search (people you don't follow and who don't follow you).
  useEffect(() => {
    if (!q) { setFound([]); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      api.searchUsers(query.trim()).then(res => { if (live) setFound(res.users || []); }).catch(() => {});
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const others = found.filter(u => u.id !== user.id && !(people || []).some(p => p.id === u.id));

  const toggle = (username) => setPicked(list => (list.includes(username) ? list.filter(x => x !== username) : [...list, username]));

  const send = async () => {
    if (!picked.length || busy) return;
    setBusy(true); setError('');
    try {
      const res = await api.shareItem(kind, id, picked, note.trim());
      const sent = res.results.filter(r => r.status === 'sent').length;
      const requests = res.results.filter(r => r.status === 'message_request').length;
      const failed = res.results.length - sent - requests;
      const parts = [];
      if (sent) parts.push(`Sent to ${sent} ${sent === 1 ? 'chat' : 'chats'}`);
      if (requests) parts.push(`${requests} will arrive as a message request`);
      if (failed) parts.push(`${failed} could not be sent`);
      setStatus(parts.join(' · ') + '.');
      if (!failed) setTimeout(onClose, 1300);
    } catch (err) {
      setError(err.message || 'Could not share.');
    } finally { setBusy(false); }
  };

  const Row = ({ u, rel, isMe }) => {
    const on = picked.includes(u.username);
    return (
      <button type="button" className={`fl-row share-row${on ? ' on' : ''}`} role="checkbox" aria-checked={on} onClick={() => toggle(u.username)}>
        <Avatar user={u} size={42} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <div className="fl-name">{isMe ? 'Your notes (just you)' : u.displayName}</div>
          <div className="fl-handle">@{u.username}{rel ? ` · ${rel}` : ''}</div>
        </span>
        <span className="share-check" aria-hidden="true">{on ? '✓' : ''}</span>
      </button>
    );
  };

  const showMe = !q || 'you your notes me'.includes(q) || user.username.toLowerCase().includes(q);

  return createPortal(
    <div className="fl-back" data-noswipe onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass-card fl-box" role="dialog" aria-label={`Share ${kind}`}>
        <div className="fl-head">
          <span>Share {kind === 'reel' ? 'reel' : 'post'}</span>
          <button className="btn-ghost" style={{ width: 'auto', padding: '4px 12px' }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: '10px 14px 0' }}>
          <input className="share-search" autoFocus placeholder="Search people…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div className="fl-list" style={{ minHeight: 120 }}>
          {people === null && <div className="fl-empty"><span className="loading-dot" /> Loading…</div>}
          {people && showMe && <Row u={user} isMe />}
          {people && shown.length === 0 && others.length === 0 && q && <div className="fl-empty">No one found for “{query.trim()}”.</div>}
          {people && people.length === 0 && !q && <div className="fl-empty">You don’t follow anyone and no one follows you yet — search to find people.</div>}
          {shown.map(u => <Row key={u.id} u={u} rel={u.rel} />)}
          {others.length > 0 && <div className="share-section">More people</div>}
          {others.map(u => <Row key={u.id} u={u} />)}
        </div>
        <div className="share-foot">
          {picked.length > 0 && (
            <input className="share-search" placeholder="Add a message (optional)…" value={note} maxLength={500} onChange={e => setNote(e.target.value)} />
          )}
          {error && <div className="error-banner">{error}</div>}
          {status && <div className="request-banner" role="status">{status}</div>}
          <button className="btn-primary" disabled={!picked.length || busy} onClick={send}>
            {busy ? 'Sending…' : picked.length ? `Send to ${picked.length} ${picked.length === 1 ? 'person' : 'people'}` : 'Pick who to send to'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
