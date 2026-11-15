import EditedMedia from './EditedMedia.jsx';

// Profile posts as a 3-column grid of square thumbnails (photo, video, or the caption for text posts).
// Tapping one calls onOpen(post).
export default function PostGrid({ posts, onOpen }) {
  return (
    <div className="post-grid">
      {posts.map(p => (
        <button key={p.id} type="button" className="pg-tile" onClick={() => onOpen(p)} aria-label={p.caption ? `Open post: ${p.caption.slice(0, 60)}` : 'Open post'}>
          {p.mediaUrl && p.model3d ? (
            <span className="sim-thumb-wrap" style={{ display: 'block', width: '100%', height: '100%', background: p.model3d.bg }}><img className="sim-thumb" src={p.mediaUrl} alt="" draggable={false} /></span>
          ) : p.mediaUrl ? (
            <EditedMedia src={p.mediaUrl} type={p.mediaType === 'video' ? 'video' : 'image'} edits={p.edits} muted loop={false} fit="cover" style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />
          ) : (
            <span className="pg-text">{p.caption}</span>
          )}
          {p.mediaType === 'video' && <span className="pg-badge" aria-hidden="true">▶</span>}
          {p.model3d && <span className="pg-3d-badge" aria-hidden="true">3D</span>}
          <span className="pg-meta" aria-hidden="true">♥ {p.likeCount} · 💬 {p.commentCount}</span>
        </button>
      ))}
    </div>
  );
}
