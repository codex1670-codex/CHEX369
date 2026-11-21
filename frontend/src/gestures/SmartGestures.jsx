import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import Avatar from '../components/Avatar.jsx';
import {
  GESTURES, SECTIONS, ACTIONS, actionById, SENSITIVITY, actionsFor, loadGestures, saveGestures, setGestureAction, resetGestures, clearPeopleCache,
  fireGesture, motionSupported, motionNeedsPermission, requestMotionPermission,
} from './gestureStore.js';

// Settings → Smart gestures: the gestures, what each one does, the top-5 people for the quick-send circle, shake tuning.
const GROUPS = ['Off', 'Share', 'Smart', 'Codex', 'Go to'];

function PeoplePicker({ cfg, onChange }) {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  useEffect(() => {
    const term = q.trim();
    if (!term) { setHits([]); return undefined; }
    let live = true;
    const t = setTimeout(() => { api.searchUsers(term).then(r => { if (live) setHits((r.users || []).filter(u => u.id !== user.id)); }).catch(() => {}); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, user.id]);

  const list = cfg.people.list;
  const set = (nextList, mode = cfg.people.mode) => { clearPeopleCache(); onChange({ ...cfg, people: { mode, list: nextList } }); };
  const add = (u) => { if (list.length >= 5 || list.some(x => x.id === u.id)) return; set([...list, u], 'custom'); setQ(''); setHits([]); };
  const remove = (id) => set(list.filter(u => u.id !== id));

  return (
    <div data-testid="qs-people">
      <div className="sg-hint" style={{ marginBottom: 6 }}>Who appears in the quick-send circle. Leave it on <b>Automatic</b> to show your most recent chats, or choose up to five people yourself.</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className={`btn-ghost${cfg.people.mode === 'auto' ? ' sel' : ''}`} style={{ width: 'auto', padding: '7px 14px' }} aria-pressed={cfg.people.mode === 'auto'} onClick={() => set(list, 'auto')}>✨ Automatic</button>
        <button type="button" className={`btn-ghost${cfg.people.mode === 'custom' ? ' sel' : ''}`} style={{ width: 'auto', padding: '7px 14px' }} aria-pressed={cfg.people.mode === 'custom'} onClick={() => set(list, 'custom')}>🎯 My five</button>
      </div>
      {cfg.people.mode === 'custom' && (
        <>
          <div className="sg-people">
            {Array.from({ length: 5 }, (_, i) => {
              const u = list[i];
              return u ? (
                <div className="sg-person" key={u.id || u.username} style={{ borderStyle: 'solid' }}>
                  <Avatar user={u} size={40} showPresence={false} />
                  <span>{String(u.displayName || u.username).split(' ')[0]}</span>
                  <button type="button" onClick={() => remove(u.id)} aria-label={`Remove ${u.displayName || u.username}`}>✕</button>
                </div>
              ) : <div className="sg-person" key={`e${i}`}><div style={{ width: 40, height: 40, borderRadius: '50%', border: '1.5px dashed var(--border-soft)', display: 'grid', placeItems: 'center', fontSize: 20 }}>+</div><span>Empty</span></div>;
            })}
          </div>
          {list.length < 5 && (
            <>
              <input className="sg-find" placeholder="Search a person to add…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search a person to add" />
              {hits.length > 0 && (
                <div className="sg-hits">
                  {hits.slice(0, 8).map(u => (
                    <button type="button" className="sg-hit" key={u.id} onClick={() => add(u)}>
                      <Avatar user={u} size={30} showPresence={false} /><span><b>{u.displayName}</b> <span style={{ color: 'var(--text-low)' }}>@{u.username}</span></span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {list.length === 0 && <div className="sg-hint" style={{ marginTop: 6 }}>Empty slots are filled from your recent chats until you pick people.</div>}
        </>
      )}
    </div>
  );
}

export default function SmartGestures() {
  const [cfg, setCfg] = useState(loadGestures);
  const [motion, setMotion] = useState(motionNeedsPermission() ? 'ask' : motionSupported() ? 'granted' : 'unsupported');
  useEffect(() => {
    const sync = () => setCfg(loadGestures());
    window.addEventListener('chex:gestures-changed', sync);
    return () => window.removeEventListener('chex:gestures-changed', sync);
  }, []);

  const pick = (gestureId, actionId) => setCfg(setGestureAction(gestureId, actionId));
  const grant = async () => { setMotion(await requestMotionPermission()); };

  return (
    <div className="glass-card" style={{ padding: 20, marginBottom: 20 }} data-testid="smart-gestures-card">
      <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display)', fontSize: 16 }}>🤚 Smart gestures</h3>
      <p style={{ fontSize: 12.5, color: 'var(--text-mid)', margin: '0 0 8px' }}>
        Shortcuts you can change — on a button, anywhere on the screen, or by moving the phone. Hold <b>Share</b> on any post or reel for a glass circle of your top five people.
        Try a <b>three-finger tap</b>, a <b>two-finger swipe</b> or an <b>edge swipe</b> on any page. Pick “Do nothing” to switch a gesture off.
      </p>

      {SECTIONS.map(([secId, secTitle, secHint]) => (
        <div key={secId}>
          <div className="sg-sec"><div className="sg-sec-t">{secTitle}</div><div className="sg-hint">{secHint}</div></div>
      {GESTURES.filter(g => g.section === secId).map((g) => (
        <div className="sg-row" key={g.id} data-testid={`gesture-${g.id}`}>
          <span className="sg-ico" aria-hidden="true">{g.icon}</span>
          <div><div className="sg-name">{g.label}</div><div className="sg-hint">{g.hint}</div></div>
          <div className="sg-ctl">
            {g.fixed ? (
              <div className="sg-fixed">{actionById(g.fixed).icon} {actionById(g.fixed).label} <span className="sg-hint">· always on</span></div>
            ) : (
            <select value={cfg.map[g.id]} onChange={e => pick(g.id, e.target.value)} aria-label={`Action for: ${g.label}`}>
              {GROUPS.map(grp => {
                const items = actionsFor(g).filter(a => a.group === grp);
                return items.length ? <optgroup key={grp} label={grp === 'Off' ? 'Off' : grp}>{items.map(a => <option key={a.id} value={a.id}>{a.icon} {a.label}</option>)}</optgroup> : null;
              })}
            </select>
            )}
            {!g.share && !g.fixed && cfg.map[g.id] !== 'none' && (
              <button type="button" className="btn-ghost" style={{ width: 'auto', padding: '7px 12px' }} onClick={() => fireGesture(g.id, {})}>Try it</button>
            )}
          </div>

          {g.id === 'shareHold' && cfg.map.shareHold === 'quickShare' && <div style={{ gridColumn: '1 / -1', marginTop: 6 }}><PeoplePicker cfg={cfg} onChange={(n) => setCfg(saveGestures(n))} /></div>}

          {g.id === 'flipDown' && cfg.map.flipDown !== 'none' && (
            <div style={{ gridColumn: '1 / -1', marginTop: 6 }}>
              {motion === 'ask' && <button type="button" className="btn-ghost sel" style={{ width: 'auto', padding: '8px 16px' }} onClick={grant}>Allow motion access</button>}
              {motion === 'denied' && <div className="sg-hint" style={{ color: 'var(--pink)' }}>Motion access was refused. Allow it in Settings → Safari → Motion &amp; Orientation Access, then reload.</div>}
              {motion === 'unsupported' && <div className="sg-hint">This device or browser can’t sense how it is lying.</div>}
              {motion === 'granted' && <div className="sg-hint">Runs while CHEX is open on screen.</div>}
            </div>
          )}

          {g.id === 'shake' && cfg.map.shake !== 'none' && (
            <div style={{ gridColumn: '1 / -1', marginTop: 6 }}>
              <div className="sg-hint" style={{ marginBottom: 6 }}>How hard you need to shake</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Object.keys(SENSITIVITY).map(s => (
                  <button key={s} type="button" className={`btn-ghost${cfg.shakeSens === s ? ' sel' : ''}`} style={{ width: 'auto', padding: '7px 14px', textTransform: 'capitalize' }} aria-pressed={cfg.shakeSens === s}
                    onClick={() => setCfg(saveGestures({ ...cfg, shakeSens: s }))}>{s === 'low' ? 'Firm' : s === 'medium' ? 'Normal' : 'Light'}</button>
                ))}
              </div>
              {motion === 'ask' && (
                <div style={{ marginTop: 8 }}>
                  <div className="sg-hint" style={{ marginBottom: 6 }}>iPhone needs your OK before apps can feel a shake.</div>
                  <button type="button" className="btn-ghost sel" style={{ width: 'auto', padding: '8px 16px' }} onClick={grant}>Allow motion access</button>
                </div>
              )}
              {motion === 'denied' && <div className="sg-hint" style={{ marginTop: 8, color: 'var(--pink)' }}>Motion access was refused. Allow it in Settings → Safari → Motion &amp; Orientation Access, then reload.</div>}
              {motion === 'unsupported' && <div className="sg-hint" style={{ marginTop: 8 }}>This device or browser can’t sense shaking.</div>}
            </div>
          )}
        </div>
      ))}
        </div>
      ))}

      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn-ghost" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => setCfg(resetGestures())}>↺ Reset all gestures</button>
      </div>
    </div>
  );
}
