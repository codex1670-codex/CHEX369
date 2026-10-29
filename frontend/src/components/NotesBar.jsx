import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';
import { useAuth } from '../AuthContext.jsx';

const MOOD_ICON = { none: '', happy: '😊', chilling: '😌', busy: '⏳', celebrating: '🎉', thinking: '💭' };
const MOOD_LABEL = { none: 'No mood', happy: 'Happy', chilling: 'Chilling', busy: 'Busy', celebrating: 'Celebrating', thinking: 'Thinking' };
const AUDIENCE_LABEL = { everyone: '🌐 Everyone', followers: '👥 Followers', close_friends: '💚 Close friends', no_one: '🔒 Only me' };

export default function NotesBar({ onOpenMessage }) {
  const { user } = useAuth();
  const [notes, setNotes] = useState(null);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState('💭');
  const [mood, setMood] = useState('none');
  const [audience, setAudience] = useState('followers');
  const [moods, setMoods] = useState(Object.keys(MOOD_ICON));
  const [songs, setSongs] = useState([]);
  const [songId, setSongId] = useState('');
  const [showSongPicker, setShowSongPicker] = useState(false);
  const [songTab, setSongTab] = useState('tamil');
  const [songQuery, setSongQuery] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [status, setStatus] = useState('');
  const [playing, setPlaying] = useState(null); // the song that is actually playing right now
  const [selectedSong, setSelectedSong] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [searchingSongs, setSearchingSongs] = useState(false);
  const [songSearchError, setSongSearchError] = useState('');
  const audioRef = useRef(null);
  const nowRef = useRef(null); // song the <audio> element was last pointed at

  const load = () => api.notesFeed().then(res => setNotes(res.notes));
  useEffect(() => { load(); }, []);
  // Section 131/136 — mood + audience come from the same allowlisted registry the backend
  // validates against, so the picker never offers a value the server would reject.
  useEffect(() => { api.noteMoods().then(res => res.moods && setMoods(res.moods)).catch(() => {}); }, []);
  // Search the live catalog by song name, lyrics line, artist or movie. With an empty box the
  // server returns the trending chart, so the picker opens on what's popular right now.
  // (1 character is too short to search, so nothing is requested for it.)
  useEffect(() => {
    if (!showSongPicker) return;
    const term = songQuery.trim();
    if (term.length === 1) { setSongs([]); setSearchingSongs(false); setSongSearchError(''); return; }
    let active = true;
    const timer = setTimeout(async () => {
      setSearchingSongs(true); setSongSearchError('');
      try {
        const res = await api.noteSongs(term, songTab);
        if (active) setSongs(res?.songs || []);
      } catch { if (active) { setSongs([]); setSongSearchError('Song search is temporarily unavailable. Try again.'); } }
      finally { if (active) setSearchingSongs(false); }
    }, term ? 300 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [songQuery, songTab, showSongPicker]);

  const stopAudio = () => { audioRef.current?.pause(); nowRef.current = null; };
  // Play / pause one preview. Uses the real <audio> events (below) for the button state, so the
  // icon never goes stale.
  const togglePreview = (song) => {
    const audio = audioRef.current;
    if (!audio || !song?.previewUrl) return;
    if (playing?.id === song.id && !audio.paused) { audio.pause(); return; }
    nowRef.current = song;
    audio.src = song.previewUrl;
    audio.currentTime = 0;
    audio.play().catch(() => { nowRef.current = null; setPlaying(null); });
  };

  // Tapping someone's note plays their song preview automatically (the tap counts as the user
  // gesture browsers require). Closing the note, or opening the picker, stops it. Keyed on the note
  // id so liking (which updates `expanded`) doesn't restart the song. Music never autoplays anywhere else.
  useEffect(() => {
    stopAudio();
    const song = expanded?.song;
    if (song?.previewUrl && !showSongPicker && !composing) togglePreview(song);
    return () => stopAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded?.id, showSongPicker, composing]);

  const myNote = notes?.find(n => n.author.id === user.id);
  const others = notes?.filter(n => n.author.id !== user.id) || [];
  const shownSongs = songs;

  const openComposer = () => {
    if (myNote) {
      setText(myNote.text || '');
      setEmoji(myNote.emoji || '💭');
      setMood(myNote.mood || 'none');
      setAudience(myNote.audience || 'followers');
      setSongId(myNote.song?.id || '');
      setSelectedSong(myNote.song || null);
      setSongs([]);
    } else {
      setMood('none');
      setAudience('followers');
      setSongId('');
      setSelectedSong(null);
      setSongs([]);
    }
    setFormError('');
    setSongQuery('');
    setShowSongPicker(false);
    setComposing(true);
  };

  const submitNote = async (e) => {
    e.preventDefault();
    if (saving || (!text.trim() && !emoji && !songId)) return;
    const payload = { text: text.trim(), emoji, mood: mood === 'none' ? null : mood, audience, songId: songId || null };
    setSaving(true); setFormError('');
    try {
      if (myNote) await api.editNote(payload);
      else await api.createNote(payload);
      stopAudio();
      setText('');
      setComposing(false);
      load();
    } catch (err) {
      setFormError(err?.message || 'Could not save your note. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Optimistic like: the heart fills and the count changes instantly, then we sync with the
  // server's real count (and roll back if the request fails).
  const applyLike = (id, liked, count) => {
    const patch = n => (n.id === id ? { ...n, likedByMe: liked, likeCount: count } : n);
    setNotes(old => old && old.map(patch));
    setExpanded(old => (old && old.id === id ? patch(old) : old));
  };
  const toggleLike = async (note) => {
    const wasLiked = !!note.likedByMe;
    const prevCount = note.likeCount || 0;
    applyLike(note.id, !wasLiked, Math.max(0, prevCount + (wasLiked ? -1 : 1)));
    try {
      const res = wasLiked ? await api.unlikeNote(note.id) : await api.likeNote(note.id);
      if (res?.note) applyLike(note.id, res.note.likedByMe, res.note.likeCount);
    } catch {
      applyLike(note.id, wasLiked, prevCount);
    }
  };

  const sendReply = async (note) => {
    if (!replyText.trim()) return;
    try {
      const res = await api.replyNote(note.id, replyText.trim());
      setStatus(res.status === 'sent' ? 'Reply sent!' : (res.message || 'Reply sent!'));
      setReplyText('');
    } catch (err) {
      setStatus(err?.message || 'Could not send your reply. Please try again.');
    }
  };

  if (notes === null) return null;

  return (
    <>
      <audio ref={audioRef} preload="none" onPlay={() => setPlaying(nowRef.current)} onPause={() => setPlaying(null)} onEnded={() => setPlaying(null)} />
      <div className="notes-row">
        <div className="note-card" onClick={openComposer}>
          <div className="note-avatar-ring" style={{ background: myNote ? 'linear-gradient(135deg, var(--violet), var(--pink))' : 'rgba(255,255,255,0.1)' }}>
            <Avatar user={user} size={52} />
            {myNote?.song && <span className="note-song-badge" title={`${myNote.song.title} — ${myNote.song.artist}`}>🎵</span>}
          </div>
          <div className="label">{myNote ? [MOOD_ICON[myNote.mood], myNote.emoji, myNote.text].filter(Boolean).join(' ') || myNote.song?.title : 'Your note'}</div>
          {myNote && myNote.likeCount > 0 && <div className="note-like-count">♥ {myNote.likeCount}</div>}
        </div>
        {others.map(n => (
          <div className="note-card" key={n.id} onClick={() => { setExpanded(n); setStatus(''); }}>
            <div className="note-avatar-ring">
              <Avatar user={n.author} size={52} />
              {n.song && <span className="note-song-badge" title={`${n.song.title} — ${n.song.artist}`}>🎵</span>}
            </div>
            <div className="label">{[MOOD_ICON[n.mood], n.emoji, n.text].filter(Boolean).join(' ') || n.song?.title}</div>
          </div>
        ))}
      </div>

      {composing && (
        <div className="glass-card note-composer" style={{ padding: 16, marginBottom: 16 }}>
          <form onSubmit={submitNote}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {['💭', '🎧', '☕', '😴', '🔥', '📚'].map(e => (
                <button key={e} type="button" onClick={() => setEmoji(e)}
                  style={{ fontSize: 20, background: emoji === e ? 'var(--surface-hover)' : 'transparent', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '4px 8px', cursor: 'pointer' }}>
                  {e}
                </button>
              ))}
            </div>
            <input
              placeholder="Share a thought (max 60 chars)…" value={text} maxLength={60}
              onChange={e => setText(e.target.value)}
              style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '9px 12px', color: 'var(--text-hi)', outline: 'none', fontSize: 13.5, marginBottom: 10 }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-low)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mood</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {moods.map(m => (
                <button key={m} type="button" onClick={() => setMood(m)}
                  style={{ fontSize: 12, background: mood === m ? 'var(--surface-hover)' : 'transparent', border: '1px solid var(--border-soft)', borderRadius: 999, padding: '5px 12px', cursor: 'pointer', color: 'var(--text-hi)' }}>
                  {MOOD_ICON[m] ? `${MOOD_ICON[m]} ` : ''}{MOOD_LABEL[m] || m}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--text-low)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Music</div>
              {songId && (
                <button type="button" className="btn-ghost" style={{ padding: '1px 8px', fontSize: 11 }} onClick={() => { setSongId(''); setSelectedSong(null); }}>Remove</button>
              )}
            </div>
            <button type="button" className="btn-ghost" style={{ marginBottom: 8, fontSize: 12.5, padding: '6px 12px' }}
              onClick={() => setShowSongPicker(s => !s)}>
              {songId ? `🎵 ${selectedSong?.title || songs.find(s => s.id === songId)?.title || 'Song selected'}` : '🎵 Search real songs (Tamil & English)'}
            </button>
            {showSongPicker && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  {[['tamil', 'Tamil'], ['english', 'English']].map(([tab, label]) => (
                    <button key={tab} type="button" className="btn-ghost"
                      style={{ fontSize: 11.5, padding: '4px 10px', background: songTab === tab ? 'var(--surface-hover)' : 'transparent' }}
                      onClick={() => setSongTab(tab)}>
                      {label}
                    </button>
                  ))}
                </div>
                <input placeholder="Search songs, lyrics line, artist or movie…" value={songQuery} onChange={e => setSongQuery(e.target.value)}
                  style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '7px 10px', color: 'var(--text-hi)', outline: 'none', fontSize: 12.5, marginBottom: 6 }} />
                <div className="note-song-picker">
                  {songQuery.trim().length === 1 && <div style={{ padding: 10, fontSize: 12, color: 'var(--text-low)' }}>Type at least 2 characters to search.</div>}
                  {!songQuery.trim() && shownSongs.length > 0 && <div style={{ padding: '8px 12px 2px', fontSize: 11, color: 'var(--text-low)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🔥 Trending now</div>}
                  {searchingSongs && <div style={{ padding: 10, fontSize: 12, color: 'var(--text-low)' }}>Searching songs…</div>}
                  {songSearchError && <div style={{ padding: 10, fontSize: 12, color: 'var(--text-low)' }}>{songSearchError}</div>}
                  {shownSongs.map(s => (
                    <div key={s.id} className={`song-row${songId === s.id ? ' selected' : ''}`}>
                      {s.artworkUrl && <img src={s.artworkUrl} alt="" loading="lazy" style={{ width: 38, height: 38, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />}
                      <span className="meta" style={{ flex: 1, minWidth: 0 }}>
                        {s.trending && <span title={s.trendRank ? `Trending #${s.trendRank}` : 'Trending'} style={{ marginRight: 4 }}>🔥</span>}{s.title}<span className="artist">{s.artist}</span>
                        {s.matchedBy === 'lyrics' && <span className="artist" title="Found by the lyrics you typed">🎤 lyrics match</span>}
                      </span>
                      <button type="button" className="btn-ghost" disabled={!s.previewUrl} title={s.previewUrl ? 'Play preview' : 'No preview available for this track'} onClick={() => togglePreview(s)}>{playing?.id === s.id ? 'Ⅱ' : (s.previewUrl ? '▶' : '—')}</button>
                      <button type="button" className="btn-ghost" onClick={() => { setSongId(s.id); setSelectedSong(s); setSongs(old => old.some(x => x.id === s.id) ? old : [s, ...old]); setShowSongPicker(false); stopAudio(); }}>{songId === s.id ? '✓' : 'Add'}</button>
                    </div>
                  ))}
                  {!searchingSongs && !songSearchError && songQuery.trim().length !== 1 && shownSongs.length === 0 && <div style={{ padding: 10, fontSize: 12, color: 'var(--text-low)' }}>{songQuery.trim() ? 'No matches found.' : 'No trending songs available right now.'}</div>}
                </div>
                {playing && <div style={{ fontSize: 11, color: 'var(--text-low)', marginTop: 5 }}>Preview: {playing.title} — {playing.artist}</div>}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-low)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Who can see this</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {Object.keys(AUDIENCE_LABEL).map(a => (
                <button key={a} type="button" onClick={() => setAudience(a)}
                  style={{ fontSize: 12, background: audience === a ? 'var(--surface-hover)' : 'transparent', border: '1px solid var(--border-soft)', borderRadius: 999, padding: '5px 12px', cursor: 'pointer', color: 'var(--text-hi)' }}>
                  {AUDIENCE_LABEL[a]}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" style={{ width: 'auto', padding: '8px 18px' }} type="submit" disabled={saving}>{saving ? 'Saving…' : (myNote ? 'Save changes' : 'Share note')}</button>
              {myNote && <button type="button" className="btn-ghost" onClick={async () => { try { await api.deleteMyNote(); stopAudio(); setComposing(false); load(); } catch (err) { setFormError(err?.message || 'Could not remove your note.'); } }}>Remove note</button>}
              <button type="button" className="btn-ghost" onClick={() => { stopAudio(); setComposing(false); }}>Cancel</button>
            </div>
            {formError && <div className="request-banner" role="alert" style={{ marginTop: 10 }}>{formError}</div>}
          </form>
        </div>
      )}

      {expanded && (
        <div className="glass-card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <Avatar user={expanded.author} size={36} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{expanded.author.displayName}</div>
              <div style={{ fontSize: 13.5, color: 'var(--text-mid)' }}>{expanded.emoji} {expanded.text}</div>
              {expanded.mood && expanded.mood !== 'none' && (
                <div style={{ fontSize: 11.5, color: 'var(--text-low)' }}>{MOOD_ICON[expanded.mood]} Feeling {MOOD_LABEL[expanded.mood]?.toLowerCase()}</div>
              )}
            </div>
            <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setExpanded(null)}>Close</button>
          </div>
          {expanded.song && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12.5, color: 'var(--text-mid)' }}>
              🎵 <strong style={{ color: 'var(--text-hi)' }}>{expanded.song.title}</strong> — {expanded.song.artist}
              {expanded.song.previewUrl ? <button className="btn-ghost" onClick={() => togglePreview(expanded.song)}>{playing?.id === expanded.song.id ? 'Ⅱ Pause' : '▶ Preview'}</button> : <span>Preview unavailable</span>}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button className="btn-ghost" style={expanded.likedByMe ? { color: 'var(--pink)' } : undefined} onClick={() => toggleLike(expanded)}>{expanded.likedByMe ? '♥ Liked' : '♡ Like'}</button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input placeholder={`Reply to ${expanded.author.displayName}…`} value={replyText} onChange={e => setReplyText(e.target.value)}
              style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 999, padding: '9px 14px', color: 'var(--text-hi)', outline: 'none', fontSize: 13.5 }} />
            <button className="send-btn" onClick={() => sendReply(expanded)}>➤</button>
          </div>
          {status && <div className="request-banner" style={{ marginTop: 10 }}>{status}</div>}
          <button className="btn-ghost" style={{ marginTop: 10 }} onClick={() => { const u = expanded.author.username; setExpanded(null); onOpenMessage?.(u); }}>Open conversation</button>
        </div>
      )}
    </>
  );
}
