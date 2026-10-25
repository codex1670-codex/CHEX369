import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Avatar from '../components/Avatar.jsx';
import ProfileMediaEditor from '../components/ProfileMediaEditor.jsx';
import ProfileStudio from '../components/ProfileStudio.jsx';
import FullscreenMediaViewer from '../components/FullscreenMediaViewer.jsx';
import FollowList from '../components/FollowList.jsx';
import HighlightsRow from '../components/HighlightsRow.jsx';
import PostGrid from '../components/PostGrid.jsx';
import PostModal from '../components/PostModal.jsx';
import { useAuth } from '../AuthContext.jsx';
import { updateCodexContext } from '../codexContext.js';

export default function Profile({ username, initialView, onConsumeInitialView, onOpenMessage, onOpenSettings, onOpenProfile }) {
  const { user: me, setUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [fsVideo, setFsVideo] = useState(null); // reel opened full screen from saved/history lists
  const [openPost, setOpenPost] = useState(null); // post opened from the grid
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [status, setStatus] = useState('');
  // Set right after I block this person: the profile is replaced by a notice with an Undo.
  const [justBlocked, setJustBlocked] = useState(false);
  // 'none' | 'posts' | 'reels' — which saved view (if any) is showing.
  const [savedView, setSavedView] = useState('none');
  const [savedPosts, setSavedPosts] = useState(null);
  const [savedReels, setSavedReels] = useState(null);
  // This person's own posts (null = loading). Private accounts return a lock instead.
  const [userPosts, setUserPosts] = useState(null);
  const [postsCursor, setPostsCursor] = useState(null);
  const [postsLocked, setPostsLocked] = useState(false);
  // Section 130 — Reels History (own profile only): watched / liked / saved / created.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState('watched');
  const [history, setHistory] = useState(null);
  // Section 127/128 — Profile Photo & Profile Video editor.
  const [mediaEditorOpen, setMediaEditorOpen] = useState(false);
  // Followers / Following popup: null | 'followers' | 'following'.
  const [connections, setConnections] = useState(null);
  // Profile Studio: which sheet to pop open on arrival ('video' when Codex says "open profile studio").
  const [studioSheet, setStudioSheet] = useState(null);
  // Section 190 — Nickname: private label the viewer sets for this profile (never shown
  // on your own profile). Also usable when talking to Codex, e.g. "message bro".
  const [nicknameEditing, setNicknameEditing] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [nicknameBusy, setNicknameBusy] = useState(false);
  const [nicknameError, setNicknameError] = useState('');

  useEffect(() => {
    setProfile(null);
    setError('');
    setMenuOpen(false);
    setStatus('');
    setJustBlocked(false);
    setSavedView('none');
    setConnections(null);
    setOpenPost(null);
    api.getUser(username).then(res => setProfile(res.user)).catch(err => setError(err.message));
    setUserPosts(null); setPostsCursor(null); setPostsLocked(false);
    let alive = true;
    api.userPosts(username).then(res => { if (alive) { setUserPosts(res.posts); setPostsCursor(res.nextCursor); } })
      .catch(err => { if (!alive) return; if (/private/i.test(err.message) || err.code === 'PRIVATE_ACCOUNT') setPostsLocked(true); setUserPosts([]); });
    // Real current-screen context for Codex: lets "message him" / "follow her" resolve
    // to whichever profile is actually open, without the user repeating the username.
    updateCodexContext({ screen: 'profile', profileUsername: username });
    return () => { alive = false; };
  }, [username]);

  // Deep-link support: Codex's `navigate` action (and the nav rail) can send us straight
  // into "saved posts" or "saved reels" via initialView, e.g. from "open my saved reels".
  useEffect(() => {
    if (!initialView || !profile?.isSelf) return;
    if (initialView === 'saved-posts') openSaved('posts');
    if (initialView === 'saved-reels') openSaved('reels');
    if (initialView === 'reels-history') openHistory();
    if (initialView === 'profile-studio') setStudioSheet('video');
    onConsumeInitialView?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialView, profile]);

  const toggleFollow = async () => {
    setBusy(true);
    try {
      const res = profile.isFollowing ? await api.unfollow(username) : await api.follow(username);
      setProfile(res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Mute / restrict / block / report. The menu always reflects what the server has saved
  // (profile.isMuted / isRestricted), so it is correct when the page is reopened later too.
  const doAction = async (action) => {
    setMenuOpen(false);
    try {
      if (action === 'mute') { await api.mute(username); setProfile(p => ({ ...p, isMuted: true })); setStatus(`Muted @${username}. Their posts, stories and notes are hidden from you.`); }
      if (action === 'unmute') { await api.unmute(username); setProfile(p => ({ ...p, isMuted: false })); setStatus(`Unmuted @${username}.`); }
      if (action === 'restrict') { await api.restrict(username); setProfile(p => ({ ...p, isRestricted: true })); setStatus(`Restricted @${username}. Their comments on your posts are now visible only to them and you.`); }
      if (action === 'unrestrict') { await api.unrestrict(username); setProfile(p => ({ ...p, isRestricted: false })); setStatus(`Unrestricted @${username}.`); }
      if (action === 'block') {
        if (!window.confirm(`Block @${username}? They won’t be able to find your profile or see your posts, and you’ll stop following each other.`)) return;
        await api.block(username);
        setStatus('');
        setJustBlocked(true);
      }
      if (action === 'report') { await api.report('user', profile.id, 'Reported from profile'); setStatus('Reported — thanks for letting us know.'); }
    } catch (err) {
      setStatus(err.message);
    }
  };

  const undoBlock = async () => {
    try {
      await api.unblock(username);
      setJustBlocked(false);
      setStatus(`Unblocked @${username}. You’ll need to follow them again.`);
      const res = await api.getUser(username);
      setProfile(res.user);
    } catch (err) { setStatus(err.message); }
  };

  const openSaved = async (kind) => {
    setHistoryOpen(false);
    setSavedView(v => (v === kind ? 'none' : kind));
    if (kind === 'posts' && !savedPosts) setSavedPosts((await api.savedPosts()).posts);
    if (kind === 'reels' && !savedReels) setSavedReels((await api.savedReels()).reels);
  };

  const openHistory = async () => {
    setSavedView('none');
    setHistoryOpen(o => !o);
    if (!history) setHistory(await api.reelsHistory());
  };

  // Keeps the profile view and the global auth user (used app-wide for "my own" avatar
  // elsewhere) in sync after any photo/video/display-mode change.
  const onMediaUpdated = (updatedUser) => {
    setProfile(updatedUser);
    if (updatedUser.isSelf) setUser(u => ({ ...u, ...updatedUser }));
  };

  const openNicknameEditor = () => {
    setNicknameError('');
    setNicknameDraft(profile.nickname || '');
    setNicknameEditing(true);
  };

  const saveNickname = async () => {
    const trimmed = nicknameDraft.trim();
    if (!trimmed) { setNicknameError('Enter a nickname first.'); return; }
    setNicknameBusy(true);
    setNicknameError('');
    try {
      const res = await api.setNickname(username, trimmed);
      setProfile(res.user);
      setNicknameEditing(false);
    } catch (err) {
      setNicknameError(err.message);
    } finally {
      setNicknameBusy(false);
    }
  };

  const clearNickname = async () => {
    setNicknameBusy(true);
    try {
      const res = await api.removeNickname(username);
      setProfile(res.user);
      setNicknameEditing(false);
    } catch (err) {
      setNicknameError(err.message);
    } finally {
      setNicknameBusy(false);
    }
  };

  if (justBlocked) {
    return (
      <div className="glass-card" style={{ padding: 24, textAlign: 'center' }} role="status">
        <div style={{ fontSize: 34, marginBottom: 6 }}>🚫</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginBottom: 6 }}>You blocked @{username}</div>
        <p style={{ fontSize: 13.5, color: 'var(--text-mid)', margin: '0 auto 14px', maxWidth: 360 }}>They can no longer find your profile, see your posts or stories, or message you. They weren’t told. You can undo this any time, or manage everyone you’ve blocked in Settings.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn-ghost" style={{ width: 'auto' }} onClick={undoBlock}>Undo block</button>
          {onOpenSettings && <button className="btn-ghost" style={{ width: 'auto' }} onClick={onOpenSettings}>Open Settings</button>}
        </div>
      </div>
    );
  }
  if (error) return <div className="empty-state">{error}</div>;
  if (!profile) return <div className="empty-state"><span className="loading-dot" /> Loading profile…</div>;

  return (
    <div>
      <ProfileStudio
        profile={profile}
        isSelf={profile.isSelf}
        onUpdated={onMediaUpdated}
        openSheet={studioSheet}
        onSheetConsumed={() => setStudioSheet(null)}
        onOpenSettings={onOpenSettings}
        onOpenConnections={setConnections}
      >
          {!profile.isSelf && (
            <div style={{ marginTop: 6 }}>
              {nicknameEditing ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    autoFocus
                    value={nicknameDraft}
                    onChange={e => setNicknameDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveNickname(); if (e.key === 'Escape') setNicknameEditing(false); }}
                    maxLength={40}
                    placeholder="e.g. Bro, Boss, Bestie…"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 8, padding: '5px 10px', color: 'var(--text-hi)', outline: 'none', fontSize: 13, width: 160 }}
                  />
                  <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} disabled={nicknameBusy} onClick={saveNickname}>Save</button>
                  <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setNicknameEditing(false)}>Cancel</button>
                  {nicknameError && <div style={{ color: 'var(--pink-ink)', fontSize: 12, width: '100%' }}>{nicknameError}</div>}
                </div>
              ) : profile.nickname ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--text-mid)' }}>Nickname: <b style={{ color: 'var(--text-hi)' }}>{profile.nickname}</b></span>
                  <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={openNicknameEditor}>Edit</button>
                  <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} disabled={nicknameBusy} onClick={clearNickname}>Remove</button>
                </div>
              ) : (
                <button className="btn-ghost" style={{ padding: '3px 10px', fontSize: 11.5 }} onClick={openNicknameEditor}>🏷️ Add nickname</button>
              )}
            </div>
          )}

        {!profile.isSelf && (
          <div style={{ display: 'flex', gap: 8, position: 'relative', justifyContent: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <button className="btn-ghost" style={{ background: profile.isFollowing ? 'transparent' : 'var(--violet)', borderColor: profile.isFollowing ? undefined : 'var(--violet)' }} disabled={busy} onClick={toggleFollow}>
              {profile.isFollowing ? 'Following' : 'Follow'}
            </button>
            <button className="btn-ghost" onClick={() => onOpenMessage(profile.username)}>Message</button>
            <button className="btn-ghost" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="More options" onClick={() => setMenuOpen(o => !o)}>•••</button>
            {menuOpen && (
              <div className="glass-card" role="menu" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, padding: 8, zIndex: 10, minWidth: 180 }}>
                <button role="menuitem" className="nav-link" onClick={() => doAction(profile.isMuted ? 'unmute' : 'mute')}>{profile.isMuted ? '🔔 Unmute' : '🔇 Mute'}</button>
                <button role="menuitem" className="nav-link" onClick={() => doAction(profile.isRestricted ? 'unrestrict' : 'restrict')}>{profile.isRestricted ? '✅ Unrestrict' : '🚷 Restrict'}</button>
                <button role="menuitem" className="nav-link" style={{ color: 'var(--pink-ink)' }} onClick={() => doAction('block')}>🚫 Block</button>
                <button role="menuitem" className="nav-link" onClick={() => doAction('report')}>⚑ Report</button>
              </div>
            )}
          </div>
        )}
      </ProfileStudio>

      {connections && (
        <FollowList
          username={profile.username}
          initialTab={connections}
          followerCount={profile.followerCount}
          followingCount={profile.followingCount}
          onClose={() => setConnections(null)}
          onOpenProfile={onOpenProfile}
        />
      )}

      {!profile.isSelf && (profile.isMuted || profile.isRestricted) && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }} aria-label="Your settings for this person">
          {profile.isMuted && <span className="request-banner" style={{ padding: '4px 12px', fontSize: 12.5 }}>🔇 Muted</span>}
          {profile.isRestricted && <span className="request-banner" style={{ padding: '4px 12px', fontSize: 12.5 }}>🚷 Restricted</span>}
        </div>
      )}

      {status && <div className="request-banner" style={{ marginBottom: 16 }} role="status">{status}</div>}

      <HighlightsRow username={profile.username} isSelf={profile.isSelf} />

      {profile.isSelf && (
        <div style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-ghost" onClick={() => setMediaEditorOpen(o => !o)}>{mediaEditorOpen ? 'Hide trim & cover tools' : '✂️ Trim & cover tools'}</button>
          <button className="btn-ghost" onClick={() => openSaved('posts')}>{savedView === 'posts' ? 'Hide saved posts' : '🔖 Saved posts'}</button>
          <button className="btn-ghost" onClick={() => openSaved('reels')}>{savedView === 'reels' ? 'Hide saved reels' : '🎬 Saved reels'}</button>
          <button className="btn-ghost" onClick={openHistory}>{historyOpen ? 'Hide reels history' : '📜 Reels history'}</button>
        </div>
      )}

      {mediaEditorOpen && <ProfileMediaEditor profile={profile} onUpdated={onMediaUpdated} />}

      {savedView === 'posts' && (
        <div>
          {savedPosts === null && <div className="empty-state"><span className="loading-dot" /></div>}
          {savedPosts?.length === 0 && <div className="empty-state">Nothing saved yet.</div>}
          {savedPosts?.length > 0 && <PostGrid posts={savedPosts} onOpen={setOpenPost} />}
        </div>
      )}

      {savedView === 'reels' && (
        <div>
          {savedReels === null && <div className="empty-state"><span className="loading-dot" /></div>}
          {savedReels?.length === 0 && <div className="empty-state">No saved reels yet.</div>}
          {savedReels?.map(r => (
            <div key={r.id} className="glass-card" style={{ padding: 14, marginBottom: 10, display: 'flex', gap: 12, alignItems: 'center' }}>
              <div className="tap-media" style={{ position: 'relative', flex: 'none' }} onClick={() => setFsVideo(r)} role="button" aria-label="Open video full screen">
                <video src={r.videoUrl} style={{ width: 90, height: 120, objectFit: 'cover', borderRadius: 10, background: '#000', pointerEvents: 'none', display: 'block' }} muted playsInline preload="metadata" />
                <div className="post-play-badge" style={{ width: 32, height: 32, fontSize: 13 }} aria-hidden="true">▶</div>
              </div>
              <div style={{ fontSize: 13.5 }}>{r.caption || <span style={{ color: 'var(--text-low)' }}>No caption</span>}</div>
            </div>
          ))}
        </div>
      )}

      {savedView === 'none' && !historyOpen && (
        <div>
          <h3 style={{ fontFamily: 'var(--font-display)', margin: '4px 0 12px' }}>Posts</h3>
          {postsLocked ? (
            <div className="empty-state" style={{ textAlign: 'center' }} role="note">
              <div style={{ fontSize: 30, marginBottom: 6 }}>🔒</div>
              <b>This account is private</b>
              <div style={{ color: 'var(--text-low)', fontSize: 13, marginTop: 4 }}>Only people @{profile.username} follows can see their posts.</div>
            </div>
          ) : userPosts === null ? (
            <div className="empty-state"><span className="loading-dot" /></div>
          ) : userPosts.length === 0 ? (
            <div className="empty-state">No posts yet.</div>
          ) : (
            <>
              <PostGrid posts={userPosts} onOpen={setOpenPost} />
              {postsCursor && (
                <button className="btn-ghost" style={{ width: '100%' }} onClick={async () => {
                  const res = await api.userPosts(profile.username, postsCursor);
                  setUserPosts(ps => [...ps, ...res.posts]); setPostsCursor(res.nextCursor);
                }}>Load more</button>
              )}
            </>
          )}
        </div>
      )}

      {historyOpen && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {[['watched', '👁 Watched'], ['liked', '♥ Liked'], ['saved', '🔖 Saved'], ['created', '🎬 Posted']].map(([key, label]) => (
              <button key={key} className="btn-ghost"
                style={{ padding: '5px 14px', fontSize: 12.5, background: historyTab === key ? 'var(--surface-hover)' : 'transparent' }}
                onClick={() => setHistoryTab(key)}>
                {label}
              </button>
            ))}
          </div>
          {history === null && <div className="empty-state"><span className="loading-dot" /></div>}
          {history && history[historyTab]?.length === 0 && <div className="empty-state">Nothing here yet.</div>}
          {history && history[historyTab]?.map(r => (
            <div key={r.id} className="glass-card" style={{ padding: 14, marginBottom: 10, display: 'flex', gap: 12, alignItems: 'center' }}>
              <div className="tap-media" style={{ position: 'relative', flex: 'none' }} onClick={() => setFsVideo(r)} role="button" aria-label="Open video full screen">
                <video src={r.videoUrl} style={{ width: 90, height: 120, objectFit: 'cover', borderRadius: 10, background: '#000', pointerEvents: 'none', display: 'block' }} muted playsInline preload="metadata" />
                <div className="post-play-badge" style={{ width: 32, height: 32, fontSize: 13 }} aria-hidden="true">▶</div>
              </div>
              <div>
                <div style={{ fontSize: 13.5 }}>{r.caption || <span style={{ color: 'var(--text-low)' }}>No caption</span>}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-low)', marginTop: 4 }}>
                  {historyTab === 'watched' ? 'Watched' : historyTab === 'liked' ? 'Liked' : historyTab === 'saved' ? 'Saved' : 'Posted'} {new Date(r.interactionAt).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {openPost && <PostModal post={openPost} onClose={() => setOpenPost(null)} onOpenProfile={onOpenProfile} />}
      {fsVideo && <FullscreenMediaViewer mediaType="video" url={fsVideo.videoUrl} name={fsVideo.caption} onClose={() => setFsVideo(null)} />}
    </div>
  );
}
