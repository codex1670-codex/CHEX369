import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, MAX_CHAT_MEDIA_BYTES } from '../api.js';
import { useIsOnline } from '../presence.jsx';
import Avatar from '../components/Avatar.jsx';
import { useAuth } from '../AuthContext.jsx';
import { connectSocket } from '../socket.js';
import NotesBar from '../components/NotesBar.jsx';
import { requestStartCall } from '../callBus.js';
import { updateCodexContext } from '../codexContext.js';
import VoiceRecorder from '../components/VoiceRecorder.jsx';
import VoiceNotePlayer from '../components/VoiceNotePlayer.jsx';
import FullscreenMediaViewer from '../components/FullscreenMediaViewer.jsx';
import CameraCapture, { cameraSupported } from '../components/CameraCapture.jsx';
import ReactionPicker from '../components/ReactionPicker.jsx';
import { loadQuickReactions } from '../quickReactions.js';
import EditedMedia from '../components/EditedMedia.jsx';
import PostModal from '../components/PostModal.jsx';

function otherParticipant(convo, myId) {
  return convo.participants.find(p => p.id !== myId) || convo.participants[0];
}

const fmtBytes = (b) => (b >= 1024 * 1024 * 1024 ? `${(b / 1024 / 1024 / 1024).toFixed(1)} GB` : b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

// A post / reel someone shared into the chat: a small tappable card. The item is fetched with the
// viewer's own permissions, so a followers-only post you can't see shows as unavailable.
function SharedCard({ share, onOpenPost, onOpenReel }) {
  const [item, setItem] = useState(undefined); // undefined = loading, null = unavailable
  useEffect(() => {
    let live = true;
    const load = share.kind === 'reel' ? api.reel(share.id).then(r => r.reel) : api.post(share.id).then(r => r.post);
    load.then(x => { if (live) setItem(x); }).catch(() => { if (live) setItem(null); });
    return () => { live = false; };
  }, [share.kind, share.id]);
  const isReel = share.kind === 'reel';
  if (item === null) return <div className="share-card" style={{ cursor: 'default' }}><div className="sc-info">{isReel ? '🎬 Reel' : '🖼️ Post'} is no longer available.</div></div>;
  const mediaUrl = item ? (isReel ? item.videoUrl : item.mediaUrl) : null;
  const mediaType = isReel ? 'video' : item?.mediaType;
  return (
    <button type="button" className="share-card" onClick={(e) => { e.stopPropagation(); if (!item) return; isReel ? onOpenReel?.(item.id) : onOpenPost?.(item.id); }} aria-label={`Open shared ${share.kind}`}>
      <div className="sc-thumb">
        {mediaUrl && <EditedMedia src={mediaUrl} type={mediaType === 'video' ? 'video' : 'image'} edits={item.edits} muted loop={false} fit="cover" style={{ width: '100%', height: '100%' }} />}
        {!mediaUrl && item && <div style={{ padding: 6, fontSize: 11 }}>{item.caption}</div>}
      </div>
      <div className="sc-info">
        <div className="sc-kind">{isReel ? '🎬 Reel' : '🖼️ Post'}{item ? ` · @${item.author.username}` : ''}</div>
        <div className="sc-cap">{item ? (item.caption || 'Tap to open') : 'Loading…'}</div>
      </div>
    </button>
  );
}

function MessageBubble({ message, mine, myId, quick, onQuickChange, onChanged, onOpenPost, onOpenReel }) {
  const [open, setOpen] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [picking, setPicking] = useState(false);       // long-press reaction picker
  const [reactError, setReactError] = useState('');
  const pressRef = useRef(null);                          // { timer, x, y } while a finger/button is down
  const longPressedRef = useRef(false);                   // swallow the click that follows a long press
  const reactions = message.reactions || [];
  const myReaction = reactions.find(r => r.user_id === myId)?.emoji || null;

  // emoji = react (replaces my previous one); null, or the one I already have = remove it.
  const react = async (emoji) => {
    setPicking(false); setOpen(false); setReactError('');
    try {
      const res = !emoji || emoji === myReaction ? await api.unreactMessage(message.id) : await api.reactMessage(message.id, emoji);
      onChanged({ reactions: res.reactions });
    } catch (err) { setReactError(err.message || 'Could not react.'); }
  };

  // Long press (about half a second) on the bubble, photo or video opens the picker; right-click does too.
  const LONG_PRESS_MS = 450;
  const cancelPress = () => { if (pressRef.current) { clearTimeout(pressRef.current.timer); pressRef.current = null; } };
  const startPress = (e) => {
    if (editing || (e.button !== undefined && e.button > 0)) return;
    cancelPress();
    const timer = setTimeout(() => { longPressedRef.current = true; pressRef.current = null; setOpen(false); setPicking(true); navigator.vibrate?.(15); }, LONG_PRESS_MS);
    pressRef.current = { timer, x: e.clientX, y: e.clientY };
  };
  const movePress = (e) => {
    const p = pressRef.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancelPress(); // it's a scroll, not a press
  };
  const swallowClick = (e) => { if (longPressedRef.current) { longPressedRef.current = false; e.stopPropagation(); e.preventDefault(); } };
  const pressHandlers = {
    onPointerDown: startPress, onPointerMove: movePress, onPointerUp: cancelPress, onPointerLeave: cancelPress, onPointerCancel: cancelPress,
    onContextMenu: (e) => { e.preventDefault(); cancelPress(); longPressedRef.current = false; setOpen(false); setPicking(true); },
    onClickCapture: swallowClick,
  };
  useEffect(() => cancelPress, []); // eslint-disable-line

  // Group identical emoji: 😂 2 — and highlight the one I chose.
  const grouped = Object.values(reactions.reduce((acc, r) => { (acc[r.emoji] ||= { emoji: r.emoji, count: 0, mine: false }); acc[r.emoji].count += 1; if (r.user_id === myId) acc[r.emoji].mine = true; return acc; }, {}));
  const saveEdit = async () => {
    const res = await api.editMessage(message.id, draft.trim());
    onChanged({ content: res.message.content, editedAt: res.message.editedAt });
    setEditing(false);
  };
  const remove = async () => {
    await api.deleteMessage(message.id);
    onChanged(null);
  };
  const togglePin = async () => {
    await (message.pinned ? api.unpinMessage(message.id) : api.pinMessage(message.id));
    onChanged({ pinned: !message.pinned });
    setOpen(false);
  };

  return (
    <div className="bubble-wrap" style={{ alignSelf: mine ? 'flex-end' : 'flex-start' }}>
      {editing ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={draft} onChange={e => setDraft(e.target.value)} style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '6px 10px', color: 'var(--text-hi)', fontSize: 13.5 }} />
          <button className="btn-ghost" style={{ padding: '4px 8px' }} onClick={saveEdit}>Save</button>
        </div>
      ) : (
        <div className={`bubble ${mine ? 'mine' : 'theirs'} ${message.mediaUrl ? (message.mediaKind === 'audio' ? 'has-voice' : 'has-media') : ''}`} onClick={() => setOpen(o => !o)} {...pressHandlers} style={{ cursor: 'pointer', position: 'relative' }}>
          {message.mediaUrl && message.mediaKind === 'audio' && <VoiceNotePlayer src={message.mediaUrl} seconds={message.mediaSeconds} />}
          {message.mediaUrl && message.mediaKind !== 'audio' && (
            <div className="chat-media" onClick={e => e.stopPropagation()}>
              {message.mediaKind === 'video'
                ? <div className="tap-media chat-video-tap" onClick={() => setViewer(true)} role="button" aria-label="Open video full screen">
                    <video src={message.mediaUrl} playsInline preload="metadata" muted style={{ pointerEvents: 'none' }} />
                    <div className="post-play-badge" aria-hidden="true">▶</div>
                  </div>
                : <img className="tap-media" src={message.mediaUrl} alt={message.mediaName || 'Photo'} loading="lazy" onClick={() => setViewer(true)} />}
              {viewer && <FullscreenMediaViewer mediaType={message.mediaKind === 'video' ? 'video' : 'photo'} url={message.mediaUrl} name={message.mediaName} onClose={() => setViewer(false)} />}
              {message.mediaBytes ? <div className="chat-media-size">{fmtBytes(message.mediaBytes)}</div> : null}
            </div>
          )}
          {message.share && <SharedCard share={message.share} onOpenPost={onOpenPost} onOpenReel={onOpenReel} />}
          {message.content}
          {message.editedAt && <span style={{ fontSize: 10, opacity: 1, marginLeft: 6 }}>(edited)</span>}
          {message.pinned && <span style={{ fontSize: 10, opacity: 0.8, marginLeft: 6 }}>📌</span>}
        </div>
      )}
      {grouped.length > 0 && (
        <div className="react-chips" style={{ justifyContent: mine ? 'flex-end' : 'flex-start' }}>
          {grouped.map(g => (
            <button key={g.emoji} type="button" className={`react-chip${g.mine ? ' mine' : ''}`} aria-label={`${g.emoji} ${g.count}${g.mine ? ', yours — tap to remove' : ''}`}
              onClick={() => (g.mine ? react(null) : react(g.emoji))}>{g.emoji}{g.count > 1 ? ` ${g.count}` : ''}</button>
          ))}
        </div>
      )}
      {reactError && <div style={{ fontSize: 11.5, color: 'var(--pink-ink)', marginTop: 2 }}>{reactError}</div>}
      {picking && <ReactionPicker quick={quick} current={myReaction} onPick={react} onClose={() => setPicking(false)} onQuickChange={onQuickChange} />}
      {open && !editing && (
        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
          {quick.slice(0, 4).map(e => (
            <button key={e} className="btn-ghost" style={{ padding: '2px 6px', fontSize: 12 }} onClick={() => react(e)}>{e}</button>
          ))}
          <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={togglePin}>{message.pinned ? 'Unpin' : 'Pin'}</button>
          {mine && message.mediaKind !== 'audio' && <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => { setEditing(true); setOpen(false); }}>Edit</button>}
          {mine && <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 11, color: 'var(--pink-ink)' }} onClick={remove}>Delete</button>}
        </div>
      )}
    </div>
  );
}

export default function Messages({ startWithUsername, onConsumeStart, onOpenReel }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState(null);
  const [requests, setRequests] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [pendingToUsername, setPendingToUsername] = useState(null); // no conversation yet, composing first message
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const scrollRef = useRef(null);
  const photoInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState(null); // { file, kind, previewUrl }
  const [uploadPct, setUploadPct] = useState(null);     // null = idle, 0..1 while uploading
  const [recording, setRecording] = useState(false);    // voice note being recorded
  const [cameraOpen, setCameraOpen] = useState(false);   // live in-app camera
  const [quick, setQuick] = useState(loadQuickReactions); // my top-10 reaction emoji
  const [openPostId, setOpenPostId] = useState(null);     // shared post opened from a chat

  const loadConversations = async () => {
    const res = await api.conversations();
    setConversations(res.conversations);
  };
  const loadRequests = async () => {
    const res = await api.requests();
    setRequests(res.requests);
  };
  // Opening chats / seeing requests clears their badge on the menu.
  const markRead = (types) => api.markMessageNotificationsRead(types).then(() => window.dispatchEvent(new Event('chex:refresh-counts'))).catch(() => {});

  useEffect(() => { loadConversations(); loadRequests(); markRead(['message_request']); }, []);

  useEffect(() => {
    if (startWithUsername === user.username) {
      openSelfChat();
      onConsumeStart?.();
    } else if (startWithUsername) {
      const existing = conversations?.find(c => c.participants.length === 2 && otherParticipant(c, user.id).username === startWithUsername);
      if (existing) {
        setActiveId(existing.id);
        setPendingToUsername(null);
      } else {
        setPendingToUsername(startWithUsername);
        setActiveId(null);
      }
      onConsumeStart?.();
    }
    // eslint-disable-next-line
  }, [startWithUsername, conversations]);

  useEffect(() => {
    const socket = connectSocket();
    const onNew = (msg) => {
      if (msg.conversationId === activeId) {
        setMessages(m => [...m, msg]);
        setTimeout(() => markRead(['message']), 400); // you're looking at it, so it's read
      }
      loadConversations();
    };
    const onAccepted = () => { loadConversations(); };
    // Someone reacted (or removed their reaction) to a message in an open chat.
    const onReaction = ({ messageId, reactions }) => setMessages(list => list.map(x => (x.id === messageId ? { ...x, reactions } : x)));
    socket.on('message:reaction', onReaction);
    socket.on('message:new', onNew);
    socket.on('message_request:accepted', onAccepted);
    return () => {
      socket.off('message:reaction', onReaction);
      socket.off('message:new', onNew);
      socket.off('message_request:accepted', onAccepted);
    };
    // eslint-disable-next-line
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    api.conversationMessages(activeId).then(res => setMessages(res.messages));
    markRead(['message']);
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const t = setTimeout(() => {
      api.searchUsers(searchQuery.trim()).then(res => setSearchResults(res.users)).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const openConversation = (id) => {
    setActiveId(id);
    setPendingToUsername(null);
    setStatus('');
  };

  // My own notes chat: the conversation whose only participant is me.
  const selfConvo = conversations?.find(c => c.participants.length === 1 && c.participants[0].id === user.id);
  const openSelfChat = async () => {
    try {
      const existing = selfConvo || (await api.selfChat()).conversation;
      if (!selfConvo) await loadConversations();
      setSearchQuery(''); setSearchResults([]);
      openConversation(existing.id);
    } catch (err) { setStatus(err.message || 'Could not open your notes chat.'); }
  };

  // Open the chat with someone: my notes chat for myself, the existing conversation if there is one,
  // otherwise a fresh chat (their first message goes as a request).
  const openChatWith = (username) => {
    if (username === user.username) { openSelfChat(); return; }
    const existing = conversations?.find(c => c.participants.length === 2 && otherParticipant(c, user.id).username === username);
    if (existing) { setSearchQuery(''); setSearchResults([]); openConversation(existing.id); return; }
    startNewChat(username);
  };

  const startNewChat = (username) => {
    setPendingToUsername(username);
    setActiveId(null);
    setMessages([]);
    setSearchQuery('');
    setSearchResults([]);
    setStatus('');
  };

  const chooseFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setAttachOpen(false);
    acceptFile(file);
  };
  // Camera: opens the live in-app camera (photo or video); phones/browsers without it fall back to the camera app.
  const openCamera = () => {
    setAttachOpen(false);
    if (cameraSupported()) setCameraOpen(true); else cameraInputRef.current?.click();
  };
  const onCameraCapture = (file) => { setCameraOpen(false); acceptFile(file); };
  const acceptFile = (file) => {
    if (!file) return;
    const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null;
    if (!kind) { setStatus('Choose a photo or a video.'); return; }
    if (file.size > MAX_CHAT_MEDIA_BYTES) { setStatus(`That file is ${fmtBytes(file.size)} — the limit is 500 MB.`); return; }
    setStatus('');
    setPendingFile({ file, kind, previewUrl: URL.createObjectURL(file) });
  };
  const clearPending = () => {
    if (pendingFile) URL.revokeObjectURL(pendingFile.previewUrl);
    setPendingFile(null);
  };
  useEffect(() => () => { if (pendingFile) URL.revokeObjectURL(pendingFile.previewUrl); }, [pendingFile]);

  const sendMedia = async () => {
    if (!pendingFile || uploadPct !== null) return;
    const target = activeId ? { conversationId: activeId } : { toUsername: pendingToUsername };
    setUploadPct(0); setStatus('');
    try {
      const res = await api.sendMessageMedia(pendingFile.file, target, text.trim(), setUploadPct);
      if (res.status === 'sent') {
        setMessages(m => [...m, res.message]);
        loadConversations();
        setText('');
        clearPending();
      }
    } catch (err) {
      setStatus(err.message);
    } finally {
      setUploadPct(null);
    }
  };

  const sendVoice = async (file, seconds) => {
    if (uploadPct !== null) return;
    const target = activeId ? { conversationId: activeId, seconds } : { toUsername: pendingToUsername, seconds };
    setUploadPct(0); setStatus('Sending voice note…');
    try {
      const res = await api.sendMessageMedia(file, target, '', setUploadPct);
      if (res.status === 'sent') {
        setMessages(m => [...m, res.message]);
        loadConversations();
        setStatus('');
      }
    } catch (err) {
      setStatus(err.message);
    } finally {
      setUploadPct(null);
    }
  };

  const send = async (e) => {
    e.preventDefault();
    if (pendingFile) return sendMedia();
    if (!text.trim()) return;
    const body = activeId ? { conversationId: activeId, text: text.trim() } : { toUsername: pendingToUsername, text: text.trim() };
    setText('');
    try {
      const res = await api.sendMessage(body);
      if (res.status === 'sent') {
        setMessages(m => [...m, res.message]);
        loadConversations();
      } else if (res.status === 'message_request') {
        setStatus(res.message);
      }
    } catch (err) {
      setStatus(err.message);
    }
  };

  const respondRequest = async (id, action) => {
    if (action === 'accept') {
      const res = await api.acceptRequest(id);
      await loadRequests();
      await loadConversations();
      setActiveId(res.conversation.id);
    } else if (action === 'delete') {
      await api.deleteRequest(id);
      await loadRequests();
    } else if (action === 'block') {
      await api.blockRequest(id);
      await loadRequests();
    } else if (action === 'report') {
      await api.reportRequest(id);
      await loadRequests();
    }
  };

  const activeConvo = conversations?.find(c => c.id === activeId);
  const chatPartner = activeConvo ? otherParticipant(activeConvo, user.id) : (pendingToUsername ? { username: pendingToUsername, displayName: pendingToUsername } : null);

  const isSelfChat = !!(activeConvo && selfConvo && activeConvo.id === selfConvo.id);

  // On phones an open chat takes the whole screen (list + menu bar hidden); the ← button returns to the list.
  const chatOpen = !!(activeId || pendingToUsername);
  useEffect(() => {
    document.documentElement.classList.toggle('chat-open', chatOpen);
    return () => document.documentElement.classList.remove('chat-open');
  }, [chatOpen]);
  const closeChat = () => { setActiveId(null); setPendingToUsername(null); setMessages([]); setStatus(''); setText(''); setAttachOpen(false); clearPending(); };

  useEffect(() => {
    // Real current-screen context for Codex: "send him this" / "call them" while a
    // conversation is open resolves to whoever is actually on screen.
    updateCodexContext({ screen: 'messages', activeConversationId: activeId || null, activeConversationUsername: chatPartner?.username || null });
  }, [activeId, chatPartner?.username]);

  return (
    <div className={`messages-root ${chatOpen ? 'chat-open' : ''}`}>
      <div className="notes-wrap"><NotesBar onOpenMessage={(u) => openChatWith(u)} /></div>
      <div className="messages-layout">
      <div className="glass-card msg-list-col">
        <div style={{ padding: 14 }}>
          <input
            placeholder="Search people to message…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '9px 12px', color: 'var(--text-hi)', outline: 'none', fontSize: 13.5 }}
          />
          {searchResults.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {searchResults.map(u => (
                <div key={u.id} className="convo-item" onClick={() => openChatWith(u.username)}>
                  <Avatar user={u} size={32} />
                  <div className="last">{u.displayName} · @{u.username}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {requests?.length > 0 && (
          <div style={{ padding: '0 14px 10px' }}>
            <div style={{ fontSize: 12, color: 'var(--text-low)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Message requests</div>
            {requests.map(r => (
              <div key={r.id} style={{ marginBottom: 8 }}>
                <div className="request-list-item glass-card">
                  <Avatar user={r.sender} size={32} />
                  <div className="txt">
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.sender.displayName}</div>
                    <div className="snippet">{r.firstText}</div>
                  </div>
                </div>
                <div className="request-actions">
                  <button className="accept" onClick={() => respondRequest(r.id, 'accept')}>Accept</button>
                  <button onClick={() => respondRequest(r.id, 'delete')}>Delete</button>
                  <button className="danger" onClick={() => respondRequest(r.id, 'block')}>Block</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="convo-list" style={{ flex: 1 }}>
          <div className={`convo-item ${selfConvo && activeId === selfConvo.id ? 'active' : ''}`} onClick={openSelfChat} role="button" aria-label="Open your own notes chat">
            <Avatar user={user} size={40} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{user.displayName || user.username} (You)</div>
              <div className="last">{selfConvo?.lastMessage?.content || 'Message yourself — notes, links, reels'}</div>
            </div>
          </div>
          {conversations === null && <div style={{ padding: 14, color: 'var(--text-low)', fontSize: 13 }}>Loading…</div>}
          {conversations?.filter(c => c !== selfConvo).length === 0 && <div style={{ padding: 14, color: 'var(--text-low)', fontSize: 13 }}>No conversations yet. Search someone to start chatting.</div>}
          {conversations?.filter(c => c !== selfConvo).map(c => {
            const other = otherParticipant(c, user.id);
            return (
              <div key={c.id} className={`convo-item ${activeId === c.id ? 'active' : ''}`} onClick={() => openConversation(c.id)}>
                <Avatar user={other} size={40} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{other.displayName}</div>
                  <div className="last">{c.lastMessage?.content || 'Say hello 👋'}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="glass-card chat-panel chat-col">
        {!chatPartner && (
          <div className="empty-state" style={{ margin: 'auto' }}>
            <div className="glyph">💬</div>
            Select a conversation or search someone to start chatting.
          </div>
        )}
        {chatPartner && (
          <>
            <div className="chat-header">
              <button type="button" className="btn-ghost chat-back" onClick={closeChat} aria-label="Back to chats">←</button>
              <Avatar user={chatPartner} size={36} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14.5 }}>{isSelfChat ? 'You (notes to self)' : (chatPartner.displayName || chatPartner.username)}</div>
                {!isSelfChat && <OnlineText userId={chatPartner.id} />}
              </div>
              {activeId && !isSelfChat && (
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button className="btn-ghost" style={{ padding: '6px 10px' }} onClick={() => requestStartCall(activeId, 'voice')}>📞</button>
                  <button className="btn-ghost" style={{ padding: '6px 10px' }} onClick={() => requestStartCall(activeId, 'video')}>🎥</button>
                </div>
              )}
            </div>
            {pendingToUsername && (
              <div className="request-banner">
                You haven't chatted with @{pendingToUsername} yet. Your first message will be sent as a message request until they accept it.
              </div>
            )}
            <div className="chat-messages" ref={scrollRef}>
              {messages.map(m => (
                <MessageBubble key={m.id} message={m} mine={m.senderId === user.id} myId={user.id} quick={quick} onQuickChange={setQuick} onOpenPost={setOpenPostId} onOpenReel={onOpenReel} onChanged={(updated) => {
                  setMessages(list => updated === null ? list.filter(x => x.id !== m.id) : list.map(x => x.id === m.id ? { ...x, ...updated } : x));
                }} />
              ))}
              {messages.length === 0 && !pendingToUsername && (
                <div style={{ margin: 'auto', color: 'var(--text-low)', fontSize: 13 }}>{isSelfChat ? 'Only you can see this chat — save notes, links and reels here.' : 'No messages yet — say hello.'}</div>
              )}
            </div>
            {status && <div className="request-banner" style={{ margin: '0 14px 10px' }}>{status}</div>}
            {pendingFile && (
              <div className="attach-preview">
                {pendingFile.kind === 'video'
                  ? <video src={pendingFile.previewUrl} muted playsInline />
                  : <img src={pendingFile.previewUrl} alt="" />}
                <div className="meta">
                  <div className="name">{pendingFile.file.name}</div>
                  <div className="size">{pendingFile.kind === 'video' ? '🎥' : '📷'} {fmtBytes(pendingFile.file.size)}</div>
                  {uploadPct !== null && (
                    <div className="progress"><div style={{ width: `${Math.round(uploadPct * 100)}%` }} /></div>
                  )}
                </div>
                {uploadPct === null
                  ? <button type="button" className="btn-ghost" style={{ padding: '4px 10px' }} onClick={clearPending} aria-label="Remove attachment">✕</button>
                  : <span className="pct">{Math.round(uploadPct * 100)}%</span>}
              </div>
            )}
            {cameraOpen && createPortal(
              <CameraCapture onCapture={onCameraCapture} onClose={() => setCameraOpen(false)} onFallback={() => { setCameraOpen(false); cameraInputRef.current?.click(); }} />,
              document.body)}
            <input ref={photoInputRef} type="file" accept="image/*" hidden onChange={chooseFile} />
            <input ref={videoInputRef} type="file" accept="video/*" hidden onChange={chooseFile} />
            <input ref={cameraInputRef} type="file" accept="image/*,video/*" capture="environment" hidden onChange={chooseFile} />
            <form className="chat-input-row" onSubmit={send}>
              {!recording && <div className="attach-fab-wrap">
                {attachOpen && (
                  <div className="attach-menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => photoInputRef.current?.click()}><span>🖼️</span> Photo</button>
                    <button type="button" role="menuitem" onClick={() => videoInputRef.current?.click()}><span>🎞️</span> Video</button>
                    <button type="button" role="menuitem" onClick={openCamera}><span>📸</span> Camera</button>
                  </div>
                )}
                <button type="button" className={`attach-fab ${attachOpen ? 'open' : ''}`} aria-label="Attach photo or video" aria-expanded={attachOpen} onClick={() => setAttachOpen(o => !o)} disabled={uploadPct !== null}>＋</button>
              </div>}
              {!recording && <input placeholder={pendingFile ? 'Add a caption…' : 'Message…'} value={text} onChange={e => setText(e.target.value)} />}
              {(text.trim() || pendingFile)
                ? <button className="send-btn" type="submit" disabled={uploadPct !== null}>➤</button>
                : <VoiceRecorder key={activeId || pendingToUsername || 'new'} disabled={uploadPct !== null} onSend={sendVoice} onError={setStatus} onRecordingChange={setRecording} />}
            </form>
          </>
        )}
      </div>
      </div>
      {openPostId && <PostModal postId={openPostId} onClose={() => setOpenPostId(null)} />}
    </div>
  );
}

function OnlineText({ userId }) {
  const online = useIsOnline(userId);
  return online ? <div className="online-text"><span className="online-pip" /> Online now</div> : null;
}
