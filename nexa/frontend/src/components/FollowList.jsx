import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';

// Popup with two tabs — Followers and Following — for one profile. If the account is
// private and the viewer isn't allowed in, the server answers 403 and we show a lock.
export default function FollowList({ username, initialTab = 'followers', followerCount, followingCount, onClose, onOpenProfile }) {
  const [tab, setTab] = useState(initialTab);
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let live = true;
    setUsers(null); setError(''); setLocked(false);
    const load = tab === 'followers' ? api.getFollowers : api.getFollowing;
    load(username)
      .then(res => { if (live) setUsers(res.users); })
      .catch(err => {
        if (!live) return;
        if (err.code === 'PRIVATE_ACCOUNT' || /private/i.test(err.message || '')) setLocked(true);
        else setError(err.message || 'Could not load the list.');
      });
    return () => { live = false; };
  }, [username, tab]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fl-back" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass-card fl-box" role="dialog" aria-label={tab === 'followers' ? 'Followers' : 'Following'}>
        <div className="fl-head">
          <span>@{username}</span>
          <button className="btn-ghost" style={{ width: 'auto', padding: '4px 12px' }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="fl-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'followers'} className={`fl-tab${tab === 'followers' ? ' on' : ''}`} onClick={() => setTab('followers')}>
            {followerCount ?? ''} Followers
          </button>
          <button role="tab" aria-selected={tab === 'following'} className={`fl-tab${tab === 'following' ? ' on' : ''}`} onClick={() => setTab('following')}>
            {followingCount ?? ''} Following
          </button>
        </div>
        <div className="fl-list">
          {locked && <div className="fl-empty">🔒 This account is private.<br />Only people they follow can see their followers and following.</div>}
          {error && <div className="fl-empty">{error}</div>}
          {!locked && !error && users === null && <div className="fl-empty"><span className="loading-dot" /> Loading…</div>}
          {users?.length === 0 && <div className="fl-empty">{tab === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</div>}
          {users?.map(u => (
            <button key={u.id} className="fl-row" onClick={() => { onClose(); onOpenProfile?.(u.username); }}>
              <Avatar user={u} size={42} />
              <span>
                <div className="fl-name">{u.displayName}</div>
                <div className="fl-handle">@{u.username}</div>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
