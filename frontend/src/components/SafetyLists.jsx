import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';

// Settings card: the people I have blocked, muted or restricted, each with a one-tap undo.
const KINDS = [
  { key: 'blocked', label: 'Blocked', load: () => api.blockedUsers(), undo: (u) => api.unblock(u), undoLabel: 'Unblock', done: 'Unblocked',
    blurb: 'Blocked people can’t find your profile, see your posts or stories, or message you. They aren’t told.', empty: 'You haven’t blocked anyone.' },
  { key: 'muted', label: 'Muted', load: () => api.mutedUsers(), undo: (u) => api.unmute(u), undoLabel: 'Unmute', done: 'Unmuted',
    blurb: 'Muted people’s posts, stories and notes are hidden from you. You still follow them and they can still message you.', empty: 'You haven’t muted anyone.' },
  { key: 'restricted', label: 'Restricted', load: () => api.restrictedUsers(), undo: (u) => api.unrestrict(u), undoLabel: 'Unrestrict', done: 'Unrestricted',
    blurb: 'On your posts, a restricted person’s comments are visible only to them and you.', empty: 'You haven’t restricted anyone.' },
];

export default function SafetyLists({ onOpenProfile }) {
  const [tab, setTab] = useState('blocked');
  const [lists, setLists] = useState({ blocked: null, muted: null, restricted: null });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(null); // username being changed
  const [note, setNote] = useState('');

  useEffect(() => {
    let live = true;
    KINDS.forEach(k => {
      k.load()
        .then(res => { if (live) setLists(l => ({ ...l, [k.key]: res.users })); })
        .catch(err => { if (live) { setErrors(e => ({ ...e, [k.key]: err.message || 'Could not load this list.' })); setLists(l => ({ ...l, [k.key]: [] })); } });
    });
    return () => { live = false; };
  }, []);

  const kind = KINDS.find(k => k.key === tab);
  const users = lists[tab];

  const undo = async (u) => {
    setBusy(u.username); setNote('');
    try {
      await kind.undo(u.username);
      setLists(l => ({ ...l, [tab]: l[tab].filter(x => x.id !== u.id) }));
      setNote(`${kind.done} @${u.username}.`);
    } catch (err) { setNote(err.message || 'Something went wrong.'); }
    setBusy(null);
  };

  return (
    <div className="glass-card" style={{ padding: 20, marginBottom: 20 }} data-testid="safety-lists">
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>Blocked, muted &amp; restricted</div>
      <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 12 }}>Manage the people you’ve limited. You can also do this from anyone’s profile (the ••• button).</p>

      <div className="fl-tabs" role="tablist" style={{ marginBottom: 8 }}>
        {KINDS.map(k => (
          <button key={k.key} role="tab" aria-selected={tab === k.key} className={`fl-tab${tab === k.key ? ' on' : ''}`} onClick={() => { setTab(k.key); setNote(''); }}>
            {k.label}{lists[k.key] ? ` (${lists[k.key].length})` : ''}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-mid)', margin: '6px 2px 10px' }}>{kind.blurb}</p>

      {note && <div className="request-banner" role="status" style={{ marginBottom: 8 }}>{note}</div>}
      {errors[tab] && <div className="error-banner">{errors[tab]}</div>}
      {users === null && <div className="fl-empty"><span className="loading-dot" /> Loading…</div>}
      {users?.length === 0 && !errors[tab] && <div className="fl-empty">{kind.empty}</div>}
      <div>
        {users?.map(u => (
          <div key={u.id} className="fl-row" style={{ cursor: 'default' }}>
            <Avatar user={u} size={42} showPresence={false} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <div className="fl-name">{u.displayName}</div>
              <div className="fl-handle">@{u.username}{u.since ? ` · since ${new Date(u.since).toLocaleDateString()}` : ''}</div>
            </span>
            {tab !== 'blocked' && onOpenProfile && (
              <button className="btn-ghost" style={{ width: 'auto', padding: '6px 12px', fontSize: 12.5 }} onClick={() => onOpenProfile(u.username)}>View</button>
            )}
            <button className="btn-ghost" style={{ width: 'auto', padding: '6px 12px', fontSize: 12.5 }} disabled={busy === u.username} onClick={() => undo(u)}
              aria-label={`${kind.undoLabel} @${u.username}`}>{kind.undoLabel}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
