import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const TYPE_LABEL = { post: 'Post', reel: 'Reel', comment: 'Comment', reel_comment: 'Reel comment', story: 'Story', note: 'Note', message: 'Message', user: 'User' };
const fmt = (n) => Number(n).toLocaleString();
const row = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
const small = { width: 'auto', padding: '6px 12px', fontSize: 12.5 };

// Master-account control room (only reachable by "sanjiv"; the server re-checks on every call).
export default function Admin({ onBack, onOpenProfile }) {
  const [tab, setTab] = useState('reports');
  const [ov, setOv] = useState(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const flash = (m) => { setMsg(m); setError(''); setTimeout(() => setMsg(''), 4000); };
  const fail = (e) => { setError(e.message || 'Something went wrong.'); setMsg(''); };
  const loadOverview = useCallback(() => api.adminOverview().then(setOv).catch(fail), []);
  useEffect(() => { loadOverview(); }, [loadOverview]);

  return (
    <div className="page-narrow">
      <button className="btn-ghost" style={{ width: 'auto', padding: '7px 14px', marginBottom: 12 }} onClick={onBack}>← Back</button>
      <div className="glass-card" style={{ padding: 20, marginBottom: 14 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20 }}>🛡️ Admin — master account</div>
        <div style={{ fontSize: 13, color: 'var(--text-mid)', marginTop: 4 }}>
          {ov ? `${fmt(ov.openReports)} open report${ov.openReports === 1 ? '' : 's'} · ${fmt(ov.users)} users · ${fmt(ov.posts)} posts · ${fmt(ov.reels)} reels` : 'Loading…'}
        </div>
        <div style={{ ...row, marginTop: 12 }}>
          {[['reports', `🚩 Reports${ov?.openReports ? ` (${ov.openReports})` : ''}`], ['users', '👥 Users & gifts'], ['delete', '🗑️ Delete by ID']].map(([k, label]) => (
            <button key={k} className={tab === k ? 'btn-primary' : 'btn-ghost'} style={small} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
      </div>
      {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}
      {msg && <div className="request-banner" style={{ marginBottom: 12 }}>{msg}</div>}
      {tab === 'reports' && <Reports flash={flash} fail={fail} refresh={loadOverview} onOpenProfile={onOpenProfile} />}
      {tab === 'users' && <Users ov={ov} flash={flash} fail={fail} refresh={loadOverview} onOpenProfile={onOpenProfile} />}
      {tab === 'delete' && <DeleteById flash={flash} fail={fail} refresh={loadOverview} />}
    </div>
  );
}

function Reports({ flash, fail, refresh, onOpenProfile }) {
  const [status, setStatus] = useState('open');
  const [list, setList] = useState(null);
  const load = useCallback(() => api.adminReports(status).then(r => setList(r.reports)).catch(fail), [status]);
  useEffect(() => { setList(null); load(); }, [load]);

  const act = async (r, body, okText) => {
    try { const res = await api.adminResolveReport(r.id, body); flash(okText + (res.done?.length ? ` (${res.done.join(', ')})` : '')); await load(); refresh(); }
    catch (e) { fail(e); }
  };

  return (
    <>
      <div style={{ ...row, marginBottom: 12 }}>
        {['open', 'reviewing', 'actioned', 'dismissed'].map(s => (
          <button key={s} className={status === s ? 'btn-primary' : 'btn-ghost'} style={small} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>
        ))}
      </div>
      {!list && <div className="glass-card" style={{ padding: 20 }}>Loading reports…</div>}
      {list && list.length === 0 && <div className="glass-card" style={{ padding: 20 }}>Nothing here. 🎉</div>}
      {list && list.map(r => (
        <div key={r.id} className="glass-card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ ...row, justifyContent: 'space-between' }}>
            <b>{TYPE_LABEL[r.target.type] || r.target.type} report</b>
            <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>{new Date(r.createdAt).toLocaleString()}</span>
          </div>
          <div style={{ fontSize: 13, margin: '6px 0' }}>Reported by <b>@{r.reporter || 'unknown'}</b>{r.target.owner && <> · content by <button className="btn-ghost" style={{ padding: '0 6px', fontSize: 13 }} onClick={() => onOpenProfile?.(r.target.owner.username)}>@{r.target.owner.username}</button></>}</div>
          <div style={{ fontSize: 13, color: 'var(--text-mid)' }}>Reason: {r.reason}</div>
          <div style={{ fontSize: 13, margin: '8px 0', padding: 10, borderRadius: 10, background: 'color-mix(in srgb, var(--text-hi) 6%, transparent)' }}>
            {r.target.exists ? (r.target.text || '(no text)') : '⚠️ Already removed'}
            {r.target.mediaUrl && r.target.exists && (r.target.mediaType === 'video'
              ? <video src={r.target.mediaUrl} controls style={{ display: 'block', maxWidth: '100%', maxHeight: 260, marginTop: 8, borderRadius: 8 }} />
              : <img src={r.target.mediaUrl} alt="" style={{ display: 'block', maxWidth: '100%', maxHeight: 260, marginTop: 8, borderRadius: 8 }} />)}
          </div>
          {(status === 'open' || status === 'reviewing') && (
            <div style={row}>
              {r.target.type !== 'user' && r.target.exists && <button className="btn-primary" style={small} onClick={() => act(r, { status: 'actioned', removeContent: true }, 'Content deleted')}>🗑 Delete content</button>}
              {r.target.owner && <button className="btn-ghost" style={{ ...small, color: '#ff8a8a' }} onClick={() => window.confirm(`Permanently delete @${r.target.owner.username} and everything they posted?`) && act(r, { status: 'actioned', removeContent: true, deleteUser: true }, 'User deleted')}>⛔ Delete user</button>}
              <button className="btn-ghost" style={small} onClick={() => act(r, { status: 'dismissed' }, 'Report dismissed')}>Dismiss</button>
              {status === 'open' && <button className="btn-ghost" style={small} onClick={() => act(r, { status: 'reviewing' }, 'Marked as reviewing')}>Mark reviewing</button>}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function Users({ ov, flash, fail, refresh, onOpenProfile }) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState(null);
  const [amounts, setAmounts] = useState({});
  const [frames, setFrames] = useState({});
  const load = useCallback((query) => api.adminUsers(query).then(r => setUsers(r.users)).catch(fail), []);
  useEffect(() => { const t = setTimeout(() => load(q), 250); return () => clearTimeout(t); }, [q, load]);

  const gift = async (u) => {
    const amount = Number(amounts[u.id] || 100);
    try { const r = await api.adminGiftCoins(u.username, amount); flash(`🪙 Gave ${fmt(amount)} coins to @${u.username} (now ${fmt(r.balance)})`); load(q); }
    catch (e) { fail(e); }
  };
  const giftItem = async (u, itemId) => {
    try { const r = await api.adminGiftItem(u.username, itemId, itemId === 'premium-frames' ? (frames[u.id] || undefined) : undefined); flash(r.alreadyOwned ? `@${u.username} already had it${frames[u.id] ? ' (frame selected)' : ''}.` : `🎁 Gifted to @${u.username}`); load(q); }
    catch (e) { fail(e); }
  };
  const del = async (u) => {
    if (!window.confirm(`Permanently delete @${u.username}, their posts, reels, messages and coins? This cannot be undone.`)) return;
    try { await api.adminDeleteUser(u.id); flash(`Deleted @${u.username}`); load(q); refresh(); } catch (e) { fail(e); }
  };

  return (
    <>
      <div className="field"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a user by name or @username…" aria-label="Search users" /></div>
      {!users && <div className="glass-card" style={{ padding: 20 }}>Loading users…</div>}
      {users && users.length === 0 && <div className="glass-card" style={{ padding: 20 }}>No users found.</div>}
      {users && users.map(u => {
        const isMaster = u.role === 'master';
        return (
          <div key={u.id} className="glass-card" style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ ...row, justifyContent: 'space-between' }}>
              <div><button className="btn-ghost" style={{ padding: 0, fontWeight: 800 }} onClick={() => onOpenProfile?.(u.username)}>{u.displayName}</button> <span style={{ color: 'var(--text-mid)', fontSize: 13 }}>@{u.username}{isMaster && ' · master 👑'}{u.status !== 'active' && ` · ${u.status}`}</span></div>
              <b>{isMaster ? '🪙 ∞' : `🪙 ${fmt(u.coins)}`}</b>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-mid)', margin: '4px 0 10px' }}>
              {u.posts} posts · {u.reels} reels · {u.unlocked.includes('premium-frames') ? '🖼️ frames' : 'no frames'} · {u.unlocked.includes('premium-themes') ? '✨ themes' : 'no themes'}{u.frame ? ` · wearing ${u.frame}` : ''}
            </div>
            {!isMaster && (
              <>
                <div style={{ ...row, marginBottom: 8 }}>
                  <input type="number" min="1" value={amounts[u.id] ?? 100} onChange={e => setAmounts(a => ({ ...a, [u.id]: e.target.value }))} style={{ width: 110 }} aria-label={`Coins to give @${u.username}`} />
                  <button className="btn-primary" style={small} onClick={() => gift(u)}>🪙 Gift coins</button>
                </div>
                <div style={{ ...row, marginBottom: 8 }}>
                  <button className="btn-ghost" style={small} onClick={() => giftItem(u, 'premium-themes')}>✨ Gift premium themes</button>
                  <select value={frames[u.id] || ''} onChange={e => setFrames(f => ({ ...f, [u.id]: e.target.value }))} aria-label="Frame to select" style={{ fontSize: 12.5 }}>
                    <option value="">Frames (don’t pick one)</option>
                    {(ov?.frames || []).map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <button className="btn-ghost" style={small} onClick={() => giftItem(u, 'premium-frames')}>🖼️ Gift premium frames</button>
                </div>
                <button className="btn-ghost" style={{ ...small, color: '#ff8a8a' }} onClick={() => del(u)}>⛔ Delete user</button>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

function DeleteById({ flash, fail, refresh }) {
  const [type, setType] = useState('post');
  const [id, setId] = useState('');
  const go = async () => {
    if (!id.trim() || !window.confirm(`Delete this ${type}? It disappears for everyone.`)) return;
    try { await api.adminDeleteContent(type, id.trim()); flash(`${TYPE_LABEL[type]} deleted`); setId(''); refresh(); } catch (e) { fail(e); }
  };
  return (
    <div className="glass-card" style={{ padding: 20 }}>
      <p style={{ fontSize: 13, color: 'var(--text-mid)', marginTop: 0 }}>Delete any post, reel, comment, story, note or message by its ID. (You can also delete posts and reels straight from the feed with the 🛡️ buttons.)</p>
      <div style={row}>
        <select value={type} onChange={e => setType(e.target.value)} aria-label="What to delete">
          {['post', 'reel', 'comment', 'reel_comment', 'story', 'note', 'message'].map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <input value={id} onChange={e => setId(e.target.value)} placeholder="ID" style={{ flex: 1, minWidth: 180 }} aria-label="ID" />
        <button className="btn-primary" style={small} onClick={go}>🗑 Delete</button>
      </div>
    </div>
  );
}
