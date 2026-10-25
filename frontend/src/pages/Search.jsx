import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Avatar from '../components/Avatar.jsx';
import PostCard from '../components/PostCard.jsx';

const label = { fontSize: 12, color: 'var(--text-low)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' };

// A tappable reel thumbnail (first frame of the video) with its author and caption.
function ReelTile({ reel, onOpen }) {
  return (
    <button type="button" className="glass-card" onClick={() => onOpen(reel.id)} aria-label={`Open reel by @${reel.author.username}`}
      style={{ padding: 0, border: 'none', cursor: 'pointer', textAlign: 'left', overflow: 'hidden', position: 'relative', aspectRatio: '9 / 14', background: '#000', color: '#fff' }}>
      <video src={`${reel.videoUrl}#t=0.1`} preload="metadata" muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
      <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 18 }}>▶</span>
      <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '22px 8px 8px', background: 'linear-gradient(transparent, rgba(0,0,0,0.75))', fontSize: 12, lineHeight: 1.3 }}>
        <b>@{reel.author.username}</b>
        {reel.caption && <span style={{ display: 'block', opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reel.caption}</span>}
      </span>
    </button>
  );
}
const reelGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginBottom: 14 };

export default function Search({ onOpenProfile, onOpenReel, initialQuery, onConsumeQuery }) {
  const [q, setQ] = useState(initialQuery || '');
  const [results, setResults] = useState(null);
  const [activeTag, setActiveTag] = useState(null);
  const [tagPosts, setTagPosts] = useState(null);
  const [tagReels, setTagReels] = useState([]);

  useEffect(() => {
    if (initialQuery) { setQ(initialQuery); onConsumeQuery?.(); }
    // eslint-disable-next-line
  }, [initialQuery]);

  useEffect(() => {
    if (!q.trim()) { setResults(null); setActiveTag(null); return; }
    const t = setTimeout(() => {
      api.search(q.trim()).then(setResults).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const openTag = async (tag) => {
    setActiveTag(tag);
    const res = await api.hashtagPosts(tag);
    setTagPosts(res.posts);
    setTagReels(res.reels || []);
  };

  return (
    <div>
      <h2 className="page-title">Search</h2>
      <input
        placeholder="Search people, reels or #hashtags…" value={q} onChange={e => setQ(e.target.value)}
        style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 12, padding: '12px 16px', color: 'var(--text-hi)', outline: 'none', fontSize: 15, marginBottom: 18 }}
      />

      {activeTag ? (
        <div>
          <button className="btn-ghost" style={{ marginBottom: 14 }} onClick={() => { setActiveTag(null); setTagPosts(null); setTagReels([]); }}>← Back to search</button>
          <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 12 }}>#{activeTag}</h3>
          {tagPosts === null && <div className="empty-state"><span className="loading-dot" /></div>}
          {tagReels.length > 0 && (
            <>
              <div style={label}>Reels</div>
              <div style={reelGrid}>{tagReels.map(r => <ReelTile key={r.id} reel={r} onOpen={onOpenReel} />)}</div>
            </>
          )}
          {tagPosts?.length === 0 && tagReels.length === 0 && <div className="empty-state">Nothing with this hashtag yet.</div>}
          {tagPosts?.map(p => <PostCard key={p.id} post={p} onOpenProfile={onOpenProfile} />)}
        </div>
      ) : (
        <>
          {results?.users?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={label}>People</div>
              {results.users.map(u => (
                <div key={u.id} className="glass-card convo-item" style={{ padding: 12, marginBottom: 6 }} onClick={() => onOpenProfile(u.username)}>
                  <Avatar user={u} size={38} />
                  <div className="last">{u.displayName} · @{u.username}</div>
                </div>
              ))}
            </div>
          )}
          {results?.reels?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={label}>Reels</div>
              <div style={reelGrid}>{results.reels.map(r => <ReelTile key={r.id} reel={r} onOpen={onOpenReel} />)}</div>
            </div>
          )}
          {results?.hashtags?.length > 0 && (
            <div>
              <div style={label}>Hashtags</div>
              {results.hashtags.map(h => (
                <div key={h.tag} className="glass-card convo-item" style={{ padding: 12, marginBottom: 6 }} onClick={() => openTag(h.tag)}>
                  <div className="last">#{h.tag} · {h.postCount} post{h.postCount === 1 ? '' : 's'}</div>
                </div>
              ))}
            </div>
          )}
          {results && results.users.length === 0 && results.hashtags.length === 0 && !(results.reels?.length) && (
            <div className="empty-state">No matches for "{q}".</div>
          )}
          {!results && !q && <div className="empty-state" style={{ color: 'var(--text-low)' }}>Search for people, reels or tap a #hashtag to explore.</div>}
        </>
      )}
    </div>
  );
}
