import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';
import { ConfirmSheet } from './ActionSheet.jsx';
import { useAuth } from '../AuthContext.jsx';

export const MAX_GROUP_MEMBERS = 50;

// Group name shown in lists and headers: the chosen name, or the first few member names.
export function groupTitle(convo, myId) {
  if (convo.name) return convo.name;
  const names = convo.participants.filter(p => p.id !== myId).map(p => p.displayName || p.username);
  return names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '') || 'Group chat';
}

// Two overlapping member avatars in one round slot — the group's picture in the chat list and header.
export function GroupAvatar({ convo, size = 40, myId }) {
  const others = convo.participants.filter(p => p.id !== myId);
  const a = others[0], b = others[1];
  const small = Math.round(size * 0.66);
  return (
    <div className="group-avatar" style={{ width: size, height: size }} aria-hidden="true">
      {a && <div className="ga-a"><Avatar user={a} size={small} showPresence={false} /></div>}
      {b && <div className="ga-b"><Avatar user={b} size={small} showPresence={false} /></div>}
    </div>
  );
}

// People you can pick: everyone you follow or who follows you, plus search for anyone else.
function usePeople(excludeIds = []) {
  const { user } = useAuth();
  const [people, setPeople] = useState(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState([]);
  const exclude = useMemo(() => new Set([user.id, ...excludeIds]), [user.id, excludeIds.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    Promise.allSettled([api.getFollowing(user.username), api.getFollowers(user.username)]).then(([fing, fers]) => {
      if (!live) return;
      const byId = new Map();
      (fing.status === 'fulfilled' ? fing.value.users : []).forEach(u => byId.set(u.id, u));
      (fers.status === 'fulfilled' ? fers.value.users : []).forEach(u => { if (!byId.has(u.id)) byId.set(u.id, u); });
      setPeople([...byId.values()].filter(u => !exclude.has(u.id)));
    });
    return () => { live = false; };
  }, [user.username, exclude]);

  const q = query.trim().toLowerCase();
  useEffect(() => {
    if (!q) { setFound([]); return undefined; }
    let live = true;
    const t = setTimeout(() => { api.searchUsers(query.trim()).then(r => { if (live) setFound(r.users || []); }).catch(() => {}); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const match = (u) => !q || u.username.toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q);
  const shown = (people || []).filter(match);
  const others = found.filter(u => !exclude.has(u.id) && !(people || []).some(p => p.id === u.id));
  return { people, query, setQuery, shown, others, loading: people === null };
}

function PersonRow({ u, on, onToggle }) {
  return (
    <button type="button" className={`fl-row share-row${on ? ' on' : ''}`} role="checkbox" aria-checked={on} onClick={() => onToggle(u.username)}>
      <Avatar user={u} size={40} showPresence={false} />
      <div className="gs-who">
        <div className="gs-name">{u.displayName || u.username}</div>
        <div className="gs-user">@{u.username}</div>
      </div>
      <span className="share-check" aria-hidden="true">{on ? '✓' : ''}</span>
    </button>
  );
}

// Searchable multi-select list used when creating a group and when adding people to one.
function PeoplePicker({ picked, onToggle, excludeIds }) {
  const { query, setQuery, shown, others, loading } = usePeople(excludeIds);
  return (
    <>
      <div className="gs-search"><input className="share-search" placeholder="Search people" aria-label="Search people" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <div className="gs-list">
        {loading && <div className="empty-state"><span className="loading-dot" /></div>}
        {!loading && shown.length === 0 && others.length === 0 && (
          <div className="gs-empty">{query ? 'Nobody found.' : 'Follow people to add them here, or search for anyone.'}</div>
        )}
        {shown.map(u => <PersonRow key={u.id} u={u} on={picked.includes(u.username)} onToggle={onToggle} />)}
        {others.length > 0 && <div className="share-section">More people</div>}
        {others.map(u => <PersonRow key={u.id} u={u} on={picked.includes(u.username)} onToggle={onToggle} />)}
      </div>
    </>
  );
}

// Full-height sheet on phones, centered card on desktop.
function Sheet({ title, onClose, left, right, children, label }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="gs-back" data-noswipe onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gs-box" role="dialog" aria-label={label || title}>
        <div className="gs-bar">
          <div className="gs-bar-side">{left || <button type="button" className="gs-link" onClick={onClose}>Cancel</button>}</div>
          <div className="gs-bar-title">{title}</div>
          <div className="gs-bar-side right">{right}</div>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function NewGroupSheet({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (u) => setPicked(l => (l.includes(u) ? l.filter(x => x !== u) : (l.length >= MAX_GROUP_MEMBERS - 1 ? l : [...l, u])));
  const ready = picked.length >= 2 && !busy;

  const create = async () => {
    if (!ready) return;
    setBusy(true); setError('');
    try {
      const res = await api.createGroup(name.trim(), picked);
      onCreated(res.conversation);
    } catch (err) {
      setError(err.message || 'Could not create the group.');
      setBusy(false);
    }
  };

  return (
    <Sheet title="New group" onClose={onClose} right={<button type="button" className="gs-link strong" disabled={!ready} onClick={create}>{busy ? 'Creating…' : 'Create'}</button>}>
      <div className="gs-name-row">
        <input className="share-search" placeholder="Group name (optional)" aria-label="Group name" maxLength={60} value={name} onChange={e => setName(e.target.value)} />
      </div>
      {picked.length > 0 && (
        <div className="gs-chips" aria-label="Selected people">
          {picked.map(u => <button key={u} type="button" className="gs-chip" onClick={() => toggle(u)} aria-label={`Remove @${u}`}>@{u} ✕</button>)}
        </div>
      )}
      <PeoplePicker picked={picked} onToggle={toggle} />
      <div className="gs-foot">
        {error ? <div className="error-banner">{error}</div>
          : <div className="gs-hint">{picked.length < 2 ? `Pick at least 2 people (${picked.length} selected)` : `${picked.length + 1} people in this group, including you`}</div>}
      </div>
    </Sheet>
  );
}

function AddMembersSheet({ convo, onClose, onAdded }) {
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (u) => setPicked(l => (l.includes(u) ? l.filter(x => x !== u) : [...l, u]));
  const add = async () => {
    if (!picked.length || busy) return;
    setBusy(true); setError('');
    try { const res = await api.addGroupMembers(convo.id, picked); onAdded(res.conversation); }
    catch (err) { setError(err.message || 'Could not add them.'); setBusy(false); }
  };
  return (
    <Sheet title="Add people" onClose={onClose} right={<button type="button" className="gs-link strong" disabled={!picked.length || busy} onClick={add}>{busy ? 'Adding…' : 'Add'}</button>}>
      <PeoplePicker picked={picked} onToggle={toggle} excludeIds={convo.participants.map(p => p.id)} />
      {error && <div className="gs-foot"><div className="error-banner">{error}</div></div>}
    </Sheet>
  );
}

// Group details: rename (admins), members (admins can remove), add people (admins), mute, leave.
export function GroupInfoSheet({ convo, onClose, onChanged, onLeft, onOpenProfile }) {
  const { user } = useAuth();
  const isAdmin = convo.myRole === 'admin';
  const [name, setName] = useState(convo.name || '');
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef(null);
  const caretRef = useRef(null);

  // Keep the caret where the user is typing. Without this some Android keyboards jump it to the
  // start after each re-render, so typed text ends up reversed ("group" -> "puorg").
  useLayoutEffect(() => {
    const el = nameRef.current;
    if (el && caretRef.current != null && document.activeElement === el) {
      try { el.setSelectionRange(caretRef.current, caretRef.current); } catch { /* ignore */ }
    }
  }, [name]);
  const onNameChange = (e) => { caretRef.current = e.target.selectionStart; setName(e.target.value); };

  const guard = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); } catch (err) { setError(err.message || 'Something went wrong.'); } finally { setBusy(false); }
  };
  const saveName = () => guard(async () => {
    const res = await api.renameGroup(convo.id, name.trim());
    onChanged(res.conversation); setRenaming(false);
  });
  const toggleMute = () => guard(async () => {
    await (convo.muted ? api.unmuteChat(convo.id) : api.muteChat(convo.id));
    onChanged({ ...convo, muted: !convo.muted });
  });
  const leave = () => guard(async () => { await api.deleteChat(convo.id); setConfirmLeave(false); onLeft(convo.id); });
  const removeMember = () => guard(async () => {
    const res = await api.removeGroupMember(convo.id, removeTarget.username);
    setRemoveTarget(null); onChanged(res.conversation);
  });

  if (adding) return <AddMembersSheet convo={convo} onClose={() => setAdding(false)} onAdded={(c) => { setAdding(false); onChanged(c); }} />;

  return (
    <Sheet title="Group info" onClose={onClose} left={<button type="button" className="gs-link" onClick={onClose}>Close</button>}>
      <div className="gs-scroll">
        <div className="gs-hero">
          <GroupAvatar convo={convo} size={84} myId={user.id} />
          {renaming ? (
            <div className="gs-rename">
              <input ref={nameRef} className="share-search gs-rename-input" aria-label="Group name" dir="ltr" maxLength={60} autoFocus autoComplete="off" autoCorrect="off" spellCheck={false} value={name} onChange={onNameChange} onKeyDown={e => { if (e.key === 'Enter' && name.trim() && !busy) saveName(); }} />
              <button type="button" className="btn-primary gs-rename-save" disabled={!name.trim() || busy} onClick={saveName}>Save</button>
            </div>
          ) : (
            <>
              <div className="gs-hero-name">{groupTitle(convo, user.id)}</div>
              <div className="gs-hero-sub">{convo.participants.length} people</div>
              {isAdmin && <button type="button" className="gs-link" onClick={() => { setName(convo.name || ''); setRenaming(true); }}>Rename group</button>}
            </>
          )}
        </div>

        <div className="gs-actions">
          <button type="button" className="gs-act" onClick={toggleMute} disabled={busy}><span aria-hidden="true">{convo.muted ? '🔔' : '🔕'}</span>{convo.muted ? 'Unmute' : 'Mute'}</button>
          {isAdmin && <button type="button" className="gs-act" onClick={() => setAdding(true)} disabled={convo.participants.length >= MAX_GROUP_MEMBERS}><span aria-hidden="true">➕</span>Add people</button>}
        </div>

        <div className="share-section">Members</div>
        <div className="gs-list">
          {convo.participants.map(m => (
            <div key={m.id} className="fl-row gs-member">
              <button type="button" className="gs-member-main" onClick={() => m.id !== user.id && onOpenProfile?.(m.username)} aria-label={`Open ${m.displayName || m.username}`}>
                <Avatar user={m} size={40} showPresence={false} />
                <div className="gs-who">
                  <div className="gs-name">{m.id === user.id ? 'You' : (m.displayName || m.username)}</div>
                  <div className="gs-user">@{m.username}{m.role === 'admin' ? ' · Admin' : ''}</div>
                </div>
              </button>
              {isAdmin && m.id !== user.id && <button type="button" className="gs-remove" onClick={() => setRemoveTarget(m)} aria-label={`Remove ${m.displayName || m.username}`}>Remove</button>}
            </div>
          ))}
        </div>
        {error && <div className="error-banner" style={{ margin: '8px 14px' }}>{error}</div>}
        <button type="button" className="gs-leave" onClick={() => setConfirmLeave(true)}>Leave group</button>
      </div>
      {confirmLeave && <ConfirmSheet title="Leave this group?" message="You'll stop receiving its messages. The others stay in the group." confirmLabel="Leave" danger busy={busy} onConfirm={leave} onClose={() => setConfirmLeave(false)} />}
      {removeTarget && <ConfirmSheet title={`Remove ${removeTarget.displayName || removeTarget.username}?`} message="They will no longer see new messages in this group." confirmLabel="Remove" danger busy={busy} onConfirm={removeMember} onClose={() => setRemoveTarget(null)} />}
    </Sheet>
  );
}
