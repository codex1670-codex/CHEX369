import { useEffect, useState } from 'react';
import { api } from '../api.js';
import StoryViewer from './StoryViewer.jsx';
import HighlightEditor from './HighlightEditor.jsx';

// The round "highlights" shelf on a profile. Everyone sees the highlights they're allowed to see;
// the owner also gets a "New" bubble and an edit pencil on each one.
function Cover({ cover, size = 62 }) {
  const base = { width: size, height: size, borderRadius: '50%', overflow: 'hidden', display: 'grid', placeItems: 'center' };
  if (!cover) return <div style={{ ...base, background: 'var(--surface-hover)' }} />;
  if (cover.mediaType === 'image') return <div style={base}><img src={cover.content} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" /></div>;
  if (cover.mediaType === 'video') return <div style={base}><video src={cover.content} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} /></div>;
  return <div style={{ ...base, background: cover.background || '#7C5CFF', color: '#fff', fontSize: 9, fontWeight: 700, padding: 6, textAlign: 'center', lineHeight: 1.2 }}>{String(cover.content).slice(0, 24)}</div>;
}

export default function HighlightsRow({ username, isSelf, reloadKey = 0 }) {
  const [items, setItems] = useState(null);
  const [viewing, setViewing] = useState(null);   // { author, stories, highlight }
  const [editor, setEditor] = useState(null);     // null | 'new' | { id, title }
  const [error, setError] = useState('');

  const load = () => api.userHighlights(username).then(r => setItems(r.highlights)).catch(() => setItems([]));
  useEffect(() => { setItems(null); load(); }, [username, reloadKey]); // eslint-disable-line

  const open = async (h) => {
    setError('');
    try {
      const res = await api.getHighlight(h.id);
      if (!res.stories.length) { setError('This highlight has no stories left.'); return; }
      setViewing(res);
    } catch (err) { setError(err.message || 'Could not open this highlight.'); }
  };

  if (items === null || (!isSelf && items.length === 0)) return null;

  return (
    <div style={{ marginBottom: 16 }} data-testid="highlights-row">
      <div className="notes-row" style={{ paddingTop: 4, paddingBottom: 8 }} aria-label="Story highlights">
        {isSelf && (
          <button type="button" className="note-card" style={{ background: 'none', border: 0, color: 'inherit', font: 'inherit' }} onClick={() => setEditor('new')} aria-label="New highlight">
            <div style={{ width: 66, height: 66, borderRadius: '50%', border: '2px dashed var(--border-soft)', display: 'grid', placeItems: 'center', fontSize: 26, color: 'var(--text-mid)' }}>＋</div>
            <div className="label">New</div>
          </button>
        )}
        {items.map(h => (
          <div key={h.id} className="note-card" style={{ position: 'relative' }}>
            <button type="button" onClick={() => open(h)} aria-label={`Open highlight ${h.title}`}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: 'inherit', font: 'inherit' }}>
              <div style={{ padding: 2, borderRadius: '50%', border: '2px solid var(--border-soft)' }}><Cover cover={h.cover} /></div>
              <div className="label">{h.title}</div>
            </button>
            {isSelf && (
              <button type="button" onClick={() => setEditor({ id: h.id, title: h.title })} aria-label={`Edit highlight ${h.title}`} title="Edit"
                style={{ position: 'absolute', top: -2, right: 0, width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--border-soft)', background: 'var(--bg-deep)', color: 'var(--text-hi)', fontSize: 11, cursor: 'pointer' }}>✎</button>
            )}
          </div>
        ))}
      </div>
      {error && <div className="error-banner">{error}</div>}
      {viewing && (
        <StoryViewer group={{ author: viewing.author, stories: viewing.stories }} isMine={viewing.highlight.isMine}
          onClose={() => { setViewing(null); load(); }} />
      )}
      {editor && (
        <HighlightEditor highlight={editor === 'new' ? null : editor} onClose={() => setEditor(null)} onSaved={load} />
      )}
    </div>
  );
}
