import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Pick stories from my archive to make (or change) a highlight.
function Tile({ story, selected, isCover, onToggle, onCover }) {
  const bg = story.mediaType === 'text' ? (story.background || '#7C5CFF') : '#000';
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={onToggle} aria-pressed={selected} aria-label={`${selected ? 'Remove' : 'Add'} story from ${new Date(story.createdAt).toLocaleDateString()}`}
        style={{ width: '100%', aspectRatio: '9 / 16', borderRadius: 12, overflow: 'hidden', padding: 0, cursor: 'pointer', background: bg, position: 'relative',
          border: selected ? '3px solid var(--violet)' : '2px solid var(--border-soft)', display: 'grid', placeItems: 'center' }}>
        {story.mediaType === 'text' && <span style={{ color: '#fff', fontSize: 11.5, fontWeight: 700, padding: 6, lineHeight: 1.25, overflow: 'hidden' }}>{story.content}</span>}
        {story.mediaType === 'image' && <img src={story.content} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />}
        {story.mediaType === 'video' && <video src={story.content} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />}
        <span style={{ position: 'absolute', left: 4, bottom: 4, fontSize: 10, background: 'rgba(0,0,0,.6)', color: '#fff', borderRadius: 6, padding: '1px 5px' }}>
          {new Date(story.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
        </span>
        {selected && <span style={{ position: 'absolute', right: 4, top: 4, background: 'var(--violet)', color: '#fff', borderRadius: 999, width: 20, height: 20, fontSize: 12, display: 'grid', placeItems: 'center' }}>✓</span>}
      </button>
      {selected && (
        <button type="button" onClick={onCover} aria-label="Use as cover" title="Use as cover"
          style={{ position: 'absolute', right: 4, bottom: 4, border: 0, borderRadius: 999, width: 24, height: 24, cursor: 'pointer', background: isCover ? 'var(--violet)' : 'rgba(0,0,0,.65)', color: '#fff', fontSize: 12 }}>★</button>
      )}
    </div>
  );
}

// `highlight` (optional) = { id, title } to edit; omit to create a new one.
export default function HighlightEditor({ highlight = null, onClose, onSaved }) {
  const editing = !!highlight;
  const [title, setTitle] = useState(highlight?.title || '');
  const [stories, setStories] = useState(null);
  const [selected, setSelected] = useState([]);      // ids, in pick order
  const [original, setOriginal] = useState([]);      // ids already in the highlight
  const [cover, setCover] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [archive, current] = await Promise.all([api.storyArchive(), editing ? api.getHighlight(highlight.id) : Promise.resolve(null)]);
        if (!live) return;
        let list = archive.stories;
        if (current) {
          const have = new Set(list.map(s => s.id));
          list = [...list, ...current.stories.filter(s => !have.has(s.id))]; // very old ones past the archive cap
          const ids = current.stories.map(s => s.id);
          setSelected(ids); setOriginal(ids);
          setTitle(current.highlight.title);
          const sum = (await api.userHighlights(current.author.username)).highlights.find(h => h.id === highlight.id);
          setCover(sum?.cover?.storyId || ids[0] || null);
        }
        setStories(list);
      } catch (err) { if (live) { setError(err.message || 'Could not load your stories.'); setStories([]); } }
    })();
    return () => { live = false; };
  }, []); // eslint-disable-line

  const toggle = (id) => setSelected(sel => {
    const next = sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id];
    if (!next.includes(cover)) setCover(next[0] || null);
    else if (!cover) setCover(next[0] || null);
    return next;
  });

  const save = async () => {
    setError('');
    if (!selected.length) return setError('Pick at least one story.');
    if (!title.trim()) return setError('Give your highlight a name.');
    setBusy(true);
    try {
      if (editing) {
        const addStoryIds = selected.filter(id => !original.includes(id));
        const removeStoryIds = original.filter(id => !selected.includes(id));
        await api.editHighlight(highlight.id, { title: title.trim(), addStoryIds, removeStoryIds, coverStoryId: cover || undefined });
      } else {
        const res = await api.createHighlight({ title: title.trim(), storyIds: selected });
        if (cover && cover !== selected[0]) await api.editHighlight(res.highlight.id, { coverStoryId: cover });
      }
      onSaved?.();
      onClose();
    } catch (err) { setError(err.message || 'Could not save.'); setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete the highlight “${title}”? Your stories stay in your archive.`)) return;
    setBusy(true);
    try { await api.deleteHighlight(highlight.id); onSaved?.(); onClose(); }
    catch (err) { setError(err.message || 'Could not delete.'); setBusy(false); }
  };

  return (
    <div className="me-overlay" style={{ zIndex: 130 }} role="dialog" aria-label={editing ? 'Edit highlight' : 'New highlight'}>
      <div className="me-modal" style={{ maxWidth: 560 }}>
        <div className="me-head"><strong>{editing ? 'Edit highlight' : 'New highlight'}</strong><span style={{ flex: 1 }} /><button className="btn-ghost" style={{ width: 'auto' }} onClick={onClose}>Close</button></div>
        <div style={{ padding: 16 }}>
          <div className="field">
            <label htmlFor="hl-title">Name</label>
            <input id="hl-title" value={title} maxLength={30} onChange={e => setTitle(e.target.value)} placeholder="e.g. Trip, Friends, Food" />
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, margin: '4px 0 8px' }}>
            Pick stories {selected.length > 0 && <span style={{ color: 'var(--text-mid)', fontWeight: 600 }}>· {selected.length} selected · ★ marks the cover</span>}
          </div>
          {stories === null && <div className="fl-empty"><span className="loading-dot" /> Loading your stories…</div>}
          {stories?.length === 0 && !error && <div className="fl-empty">You have no stories yet. Post a story first, then add it here.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 8, marginBottom: 14 }}>
            {stories?.map(s => (
              <Tile key={s.id} story={s} selected={selected.includes(s.id)} isCover={cover === s.id} onToggle={() => toggle(s.id)} onCover={() => setCover(s.id)} />
            ))}
          </div>
          {error && <div className="error-banner" style={{ marginBottom: 10 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-primary" style={{ width: 'auto', padding: '9px 20px' }} disabled={busy || !selected.length} onClick={save}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create highlight'}</button>
            {editing && <button className="btn-ghost" style={{ width: 'auto', color: 'var(--pink-ink)' }} disabled={busy} onClick={remove}>Delete highlight</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
