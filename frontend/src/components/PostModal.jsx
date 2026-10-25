import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import PostCard from './PostCard.jsx';

// Opens one post full-size in a popup. Give it the post you already have, or just its id
// (used when a post is opened from a chat).
export default function PostModal({ post, postId, onClose, onOpenProfile }) {
  const [p, setP] = useState(post || null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (post || !postId) return undefined;
    let live = true;
    api.post(postId).then(res => { if (live) setP(res.post); }).catch(err => { if (live) setError(err.message || 'This post is not available.'); });
    return () => { live = false; };
  }, [post, postId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fl-back pm-back" data-noswipe onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pm-box" role="dialog" aria-label="Post">
        <button className="btn-ghost pm-close" onClick={onClose} aria-label="Close">✕</button>
        {error && <div className="glass-card" style={{ padding: 20, textAlign: 'center' }}>{error}</div>}
        {!p && !error && <div className="glass-card" style={{ padding: 20, textAlign: 'center' }}><span className="loading-dot" /> Loading…</div>}
        {p && <PostCard post={p} onOpenProfile={onOpenProfile ? (u) => { onClose(); onOpenProfile(u); } : undefined} />}
      </div>
    </div>,
    document.body,
  );
}
