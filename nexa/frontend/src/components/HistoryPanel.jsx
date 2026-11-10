import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';
import StoryViewer from './StoryViewer.jsx';
import HighlightEditor from './HighlightEditor.jsx';
import FullscreenMediaViewer from './FullscreenMediaViewer.jsx';
import { useAuth } from '../AuthContext.jsx';

// Settings card: everything I've done, in one place — story archive, reels activity, calls.
// All of it is private: each endpoint is scoped to the signed-in user.
const TABS = [['stories', '📖 Stories'], ['reels', '🎬 Reels'], ['calls', '📞 Calls']];
const REEL_TABS = [['watched', 'Watched'], ['liked', 'Liked'], ['saved', 'Saved'], ['created', 'Posted']];

function StoryTile({ story, onOpen }) {
  const bg = story.mediaType === 'text' ? (story.background || '#7C5CFF') : '#000';
  return (
    <button type="button" onClick={onOpen} aria-label={`Open story from ${new Date(story.createdAt).toLocaleString()}`}
      style={{ position: 'relative', aspectRatio: '9 / 16', borderRadius: 12, overflow: 'hidden', padding: 0, border: '1px solid var(--border-soft)', background: bg, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
      {story.mediaType === 'text' && <span style={{ color: '#fff', fontSize: 11.5, fontWeight: 700, padding: 6, lineHeight: 1.25, overflow: 'hidden' }}>{story.content}</span>}
      {story.mediaType === 'image' && <img src={story.content} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      {story.mediaType === 'video' && <video src={story.content} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />}
      <span style={{ position: 'absolute', left: 4, bottom: 4, fontSize: 10, background: 'rgba(0,0,0,.6)', color: '#fff', borderRadius: 6, padding: '1px 5px' }}>
        {new Date(story.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
      </span>
      <span style={{ position: 'absolute', right: 4, top: 4, fontSize: 10, background: story.expired ? 'rgba(0,0,0,.6)' : 'var(--violet)', color: '#fff', borderRadius: 6, padding: '1px 5px' }}>
        {story.expired ? 'Expired' : 'Live'}
      </span>
      {story.highlightCount > 0 && <span style={{ position: 'absolute', left: 4, top: 4, fontSize: 10, background: 'rgba(0,0,0,.6)', color: '#fff', borderRadius: 6, padding: '1px 5px' }}>★ {story.highlightCount}</span>}
    </button>
  );
}

function StoriesTab() {
  const { user } = useAuth();
  const [stories, setStories] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [editor, setEditor] = useState(false);
  const load = () => api.storyArchive().then(r => setStories(r.stories)).catch(err => { setError(err.message || 'Could not load your stories.'); setStories([]); });
  useEffect(() => { load(); }, []);
  return (
    <div>
      <p style={{ fontSize: 12.5, color: 'var(--text-mid)', margin: '0 2px 10px' }}>Your stories disappear for others after 24 hours but stay here, only visible to you. Add favourites to a highlight to keep them on your profile.</p>
      <button className="btn-ghost" style={{ width: 'auto', padding: '7px 14px', marginBottom: 12 }} onClick={() => setEditor(true)}>★ New highlight</button>
      {error && <div className="error-banner">{error}</div>}
      {stories === null && <div className="fl-empty"><span className="loading-dot" /> Loading…</div>}
      {stories?.length === 0 && !error && <div className="fl-empty">No stories yet.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 8 }}>
        {stories?.map(s => <StoryTile key={s.id} story={s} onOpen={() => setOpen(s)} />)}
      </div>
      {open && <StoryViewer group={{ author: user, stories: [open] }} isMine onClose={() => { setOpen(null); load(); }} />}
      {editor && <HighlightEditor onClose={() => setEditor(false)} onSaved={load} />}
    </div>
  );
}

function ReelsTab() {
  const [tab, setTab] = useState('watched');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [fs, setFs] = useState(null);
  useEffect(() => { api.reelsHistory().then(setData).catch(err => { setError(err.message || 'Could not load your reels history.'); setData({}); }); }, []);
  const verb = { watched: 'Watched', liked: 'Liked', saved: 'Saved', created: 'Posted' }[tab];
  const list = data?.[tab];
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {REEL_TABS.map(([k, label]) => (
          <button key={k} className="btn-ghost" style={{ width: 'auto', padding: '5px 14px', fontSize: 12.5, background: tab === k ? 'var(--surface-hover)' : 'transparent' }} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {error && <div className="error-banner">{error}</div>}
      {data === null && <div className="fl-empty"><span className="loading-dot" /> Loading…</div>}
      {list?.length === 0 && <div className="fl-empty">Nothing here yet.</div>}
      {list?.map(r => (
        <div key={`${tab}-${r.id}`} className="glass-card" style={{ padding: 12, marginBottom: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="tap-media" style={{ position: 'relative', flex: 'none' }} onClick={() => setFs(r)} role="button" aria-label="Open video full screen">
            <video src={r.videoUrl} style={{ width: 70, height: 94, objectFit: 'cover', borderRadius: 10, background: '#000', pointerEvents: 'none', display: 'block' }} muted playsInline preload="metadata" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5 }}>{r.caption || <span style={{ color: 'var(--text-low)' }}>No caption</span>}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-low)', marginTop: 4 }}>{verb} {new Date(r.interactionAt).toLocaleString()}</div>
          </div>
        </div>
      ))}
      {fs && <FullscreenMediaViewer mediaType="video" url={fs.videoUrl} name={fs.caption} onClose={() => setFs(null)} />}
    </div>
  );
}

function CallsTab({ me }) {
  const [calls, setCalls] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.callHistory().then(r => setCalls(r.calls)).catch(err => { setError(err.message || 'Could not load your calls.'); setCalls([]); }); }, []);
  const describe = (c) => {
    if (c.wasMissed) return 'Missed';
    if (c.status === 'missed' || c.status === 'declined') return c.callerId === me.id ? 'No answer' : 'Declined';
    const secs = c.answeredAt && c.endedAt ? Math.max(0, Math.round((new Date(c.endedAt) - new Date(c.answeredAt)) / 1000)) : null;
    const dur = secs === null ? '' : ` · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    return `${c.callerId === me.id ? 'Outgoing' : 'Incoming'}${dur}`;
  };
  return (
    <div>
      {error && <div className="error-banner">{error}</div>}
      {calls === null && <div className="fl-empty"><span className="loading-dot" /> Loading…</div>}
      {calls?.length === 0 && !error && <div className="fl-empty">No calls yet.</div>}
      {calls?.map(c => {
        const others = c.participants.filter(p => p.id !== me.id);
        const who = others.length ? others : c.participants;
        return (
          <div key={c.id} className="fl-row" style={{ cursor: 'default' }}>
            <Avatar user={who[0]} size={40} showPresence={false} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <div className="fl-name" style={c.wasMissed ? { color: 'var(--pink-ink)' } : undefined}>{who.map(p => p.displayName).join(', ') || 'Unknown'}</div>
              <div className="fl-handle">{c.type === 'video' ? '📹 Video' : '📞 Voice'} · {describe(c)}</div>
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--text-low)' }}>{new Date(c.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function HistoryPanel() {
  const { user } = useAuth();
  const [tab, setTab] = useState('stories');
  return (
    <div className="glass-card" style={{ padding: 20, marginBottom: 20 }} data-testid="history-panel">
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>History</div>
      <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 12 }}>Your story archive, reels activity and call log. Only you can see this.</p>
      <div className="fl-tabs" role="tablist" style={{ marginBottom: 12 }}>
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`fl-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'stories' && <StoriesTab />}
      {tab === 'reels' && <ReelsTab />}
      {tab === 'calls' && <CallsTab me={user} />}
    </div>
  );
}
