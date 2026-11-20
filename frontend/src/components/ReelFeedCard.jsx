import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import EditedMedia from './EditedMedia.jsx';
import ShareSheet from './ShareSheet.jsx';
import { useShareGesture } from '../gestures/useShareGesture.js';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

// A reel shown inside the normal post feed. It looks like a post card with a video, but its like /
// comment / save buttons use the reel endpoints, because the item is a reel (kind === 'reel').
export default function ReelFeedCard({ reel, onOpenProfile, onDeleted, onOpenReels }) {
  const { user } = useAuth();
  const [r, setR] = useState(reel);
  useEffect(() => { setR(reel); }, [reel]);
  const [comments, setComments] = useState(null);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [sharing, setSharing] = useState(false);
  const shareHold = useShareGesture({ kind: 'reel', id: r.id, thumb: r.videoUrl, thumbType: 'video' });
  const [failed, setFailed] = useState(false);
  const videoRef = useRef(null);
  const wrapRef = useRef(null);
  const isMine = r.author.id === user.id;

  // Play only while on screen.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([e]) => {
      const v = videoRef.current;
      if (!v) return;
      if (e.intersectionRatio >= 0.6) v.play().catch(() => {}); else v.pause();
    }, { threshold: [0, 0.6] });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const toggleLike = async () => {
    const was = r.likedByMe;
    setR({ ...r, likedByMe: !was, likeCount: r.likeCount + (was ? -1 : 1) });
    try { const res = was ? await api.unlikeReel(r.id) : await api.likeReel(r.id); setR({ ...res.reel, kind: 'reel' }); }
    catch { setR(r); }
  };
  const toggleSave = async () => {
    const was = r.savedByMe;
    setR({ ...r, savedByMe: !was });
    try { was ? await api.unsaveReel(r.id) : await api.saveReel(r.id); } catch { setR(r); }
  };
  const openComments = async () => {
    setShowComments(s => !s);
    if (!comments) { try { setComments((await api.reelComments(r.id)).comments); } catch { setComments([]); } }
  };
  const submitComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    const res = await api.addReelComment(r.id, commentText.trim());
    setComments(c => [...(c || []), res.comment]);
    setCommentText('');
    setR({ ...r, commentCount: r.commentCount + 1 });
  };
  const remove = async () => {
    if (!window.confirm('Delete this reel?')) return;
    if (user.isAdmin && !isMine) await api.adminDeleteContent('reel', r.id); else await api.deleteReel(r.id);
    onDeleted?.(r.id);
  };

  return (
    <div className="glass-card post-card" ref={wrapRef}>
      <div className="post-header" onClick={() => onOpenProfile?.(r.author.username)} style={{ cursor: 'pointer' }}>
        <Avatar user={r.author} size={38} />
        <div>
          <div className="name">{r.author.displayName}</div>
          <div className="time">@{r.author.username} · {timeAgo(r.createdAt)}{r.editedAt && ' · edited'} · <span className="audience-chip public">🎬 Reel</span></div>
        </div>
        {(isMine || user.isAdmin) && (
          <button type="button" className="post-more" aria-label="Delete reel" onClick={e => { e.stopPropagation(); remove(); }}>🗑️</button>
        )}
      </div>
      {r.caption && <p className="post-caption">{r.caption}</p>}
      <div className="post-media-wrap" style={{ margin: '0 -4px 12px', borderRadius: 12, overflow: 'hidden', cursor: onOpenReels ? 'pointer' : 'default' }}
        onClick={() => onOpenReels?.(r.id)} role={onOpenReels ? 'button' : undefined} aria-label="Open in Reels">
        {!failed ? (
          <EditedMedia src={r.videoUrl} type="video" edits={r.edits} videoRef={videoRef} controls={false} muted autoPlay loop
            fit="contain" mediaMaxHeight={560} style={{ background: '#000', pointerEvents: 'none' }} onError={() => setFailed(true)} />
        ) : (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-mid)' }}>Couldn't load this video.</div>
        )}
      </div>
      <div className="post-actions">
        <button className={r.likedByMe ? 'liked' : ''} onClick={toggleLike}><span className="heart-icon">{r.likedByMe ? '♥' : '♡'}</span> {r.likeCount}</button>
        <button onClick={openComments}>💬 {r.commentCount}</button>
        <button {...shareHold} onClick={() => setSharing(true)} aria-label="Share this reel" aria-haspopup="dialog">↗ <span className="lbl">Share</span></button>
        <button type="button" className={`post-save${r.savedByMe ? ' on' : ''}`} onClick={toggleSave} aria-pressed={!!r.savedByMe} aria-label={r.savedByMe ? 'Remove from saved' : 'Save reel'}>🔖</button>
      </div>
      {sharing && <ShareSheet kind="reel" id={r.id} onClose={() => setSharing(false)} />}
      {showComments && (
        <div className="comments-block">
          {(comments || []).map(c => (
            <div className="comment-row" key={c.id}><span className="b">{c.author.displayName}</span> <span>{c.text}</span></div>
          ))}
          {comments && comments.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-low)' }}>No comments yet.</div>}
          <form className="comment-input-row" onSubmit={submitComment}>
            <input placeholder="Add a comment…" value={commentText} onChange={e => setCommentText(e.target.value)} />
          </form>
        </div>
      )}
    </div>
  );
}
