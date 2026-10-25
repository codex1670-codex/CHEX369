import EditedMedia from './EditedMedia.jsx';

// Profile posts as a 3-column grid of square thumbnails (photo, video, or the caption for text posts).
// Tapping one calls onOpen(post).
export default function PostGrid({ posts, onOpen }) {
  return (
    <div className="post-grid">
      {posts.map(p => (
        <button key={p.id} type="button" className="pg-tile" onClick={() => onOpen(p)} aria-label={p.caption ? `Open post: ${p.caption.slice(0, 60)}` : 'Open post'}>
          {p.mediaUrl ? (
            <EditedMedia src={p.mediaUrl} type={p.mediaType === 'video' ? 'video' : 'image'} edits={p.edits} muted loop={false} fit="cover" style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />
          ) : (
            <span className="pg-text">{p.caption}</span>
          )}
          {p.mediaType === 'video' && <span className="pg-badge" aria-hidden="true">▶</span>}
          <span className="pg-meta" aria-hidden="true">♥ {p.likeCount} · 💬 {p.commentCount}</span>
        </button>
      ))}
    </div>
  );
}
