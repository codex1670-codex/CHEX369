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
import ActionSheet, { ConfirmSheet } from '../components/ActionSheet.jsx';
import { useLongPress } from '../components/useLongPress.js';
import { GroupAvatar, GroupInfoSheet, NewGroupSheet, groupTitle } from '../components/GroupSheets.jsx';

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

function MessageBubble({ message, mine, myId, quick, onQuickChange, onChanged, onOpenPost, onOpenReel, sender = null }) {
  const [viewer, setViewer] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [picking, setPicking] = useState(false);       // "customize my top 10 reactions" picker
  const [menu, setMenu] = useState(false);              // long-press action sheet
  const [confirmUnsend, setConfirmUnsend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reactError, setReactError] = useState('');
  const pressRef = useRef(null);                          // { timer, x, y } while a finger/button is down
  const longPressedRef = useRef(false);                   // swallow the click that follows a long press
  const reactions = message.reactions || [];
  const myReaction = reactions.find(r => r.user_id === myId)?.emoji || null;

  // emoji = react (replaces my previous one); null, or the one I already have = remove it.
  const react = async (emoji) => {
    setPicking(false); setReactError('');
    try {
      const res = !emoji || emoji === myReaction ? await api.unreactMessage(message.id) : await api.reactMessage(message.id, emoji);
      onChanged({ reactions: res.reactions });
    } catch (err) { setReactError(err.message || 'Could not react.'); }
  };

  // Long press (about half a second) on the bubble, photo or video opens the action sheet; right-click does too.
  const LONG_PRESS_MS = 450;
  const cancelPress = () => { if (pressRef.current) { clearTimeout(pressRef.current.timer); pressRef.current = null; } };
  const startPress = (e) => {
    if (editing || (e.button !== undefined && e.button > 0)) return;
    cancelPress();
    longPressedRef.current = false; // a fresh press: forget any earlier long press whose click never came
    const timer = setTimeout(() => { longPressedRef.current = true; pressRef.current = null; setMenu(true); navigator.vibrate?.(15); }, LONG_PRESS_MS);
    pressRef.current = { timer, x: e.clientX, y: e.clientY };
  };
  const movePress = (e) => {
    const p = pressRef.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancelPress(); // it's a scroll, not a press
  };
  const swallowClick = (e) => { if (longPressedRef.current) { longPressedRef.current = false; e.stopPropagation(); e.preventDefault(); } };
  const pressHandlers = {
    onPointerDown: startPress, onPointerMove: movePress, onPointerUp: cancelPress, onPointerLeave: cancelPress, onPointerCancel: cancelPress,
    onContextMenu: (e) => { e.preventDefault(); cancelPress(); longPressedRef.current = false; setMenu(true); },
    onClickCapture: swallowClick,
  };
  useEffect(() => cancelPress, []); // eslint-disable-line

  // Group identical emoji: 😂 2 — and highlight the one I chose.
  const grouped = Object.values(reactions.reduce((acc, r) => { (acc[r.emoji] ||= { emoji: r.emoji, count: 0, mine: false }); acc[r.emoji].count += 1; if (r.user_id === myId) acc[r.emoji].mine = true; return acc; }, {}));
  const saveEdit = async () => {
    if (!draft.trim()) return;
    const res = await api.editMessage(message.id, draft.trim());
    onChanged({ content: res.message.content, editedAt: res.message.editedAt });
    setEditing(false);
  };
  // Unsend: removes it for everyone (only my own messages).
  const unsend = async () => {
    setBusy(true);
    try { await api.deleteMessage(message.id); setConfirmUnsend(false); onChanged(null); }
    catch (err) { setReactError(err.message || 'Could not unsend.'); setConfirmUnsend(false); }
    finally { setBusy(false); }
  };
  // Delete for me: hides it from my view only; everyone else still sees it.
  const deleteForMe = async () => {
    try { await api.hideMessage(message.id); onChanged(null); }
    catch (err) { setReactError(err.message || 'Could not delete.'); }
  };
  const togglePin = async () => {
    await (message.pinned ? api.unpinMessage(message.id) : api.pinMessage(message.id));
    onChanged({ pinned: !message.pinned });
  };
  const copyText = () => { if (message.content) navigator.clipboard?.writeText(message.content).catch(() => {}); };

  const emojiRow = (
    <div className="as-emoji-row" role="group" aria-label="React">
      {quick.slice(0, 6).map(e => (
        <button key={e} type="button" className={`as-emoji${myReaction === e ? ' on' : ''}`} aria-label={`React ${e}`} onClick={() => { setMenu(false); react(e); }}>{e}</button>
      ))}
      <button type="button" className="as-emoji more" aria-label="More reactions" onClick={() => { setMenu(false); setPicking(true); }}>＋</button>
    </div>
  );

  return (
    <div className={`bubble-wrap ${mine ? 'mine' : 'theirs'}`} style={{ alignSelf: mine ? 'flex-end' : 'flex-start' }}>
      {sender && !mine && <div className="bubble-sender">{sender.displayName || sender.username}</div>}
      {editing ? (
        <div className="bubble-edit">
          <input value={draft} onChange={e => setDraft(e.target.value)} aria-label="Edit message" autoFocus />
          <button className="btn-ghost" onClick={saveEdit}>Save</button>
          <button className="btn-ghost" onClick={() => { setEditing(false); setDraft(message.content); }}>Cancel</button>
        </div>
      ) : (
        <div className="bubble-row">
          {mine && <button type="button" className="bubble-more" aria-label="Message options" onClick={() => setMenu(true)}>⋯</button>}
          <div className={`bubble ${mine ? 'mine' : 'theirs'} ${message.mediaUrl ? (message.mediaKind === 'audio' ? 'has-voice' : 'has-media') : ''}`} {...pressHandlers} style={{ position: 'relative' }}>
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
            {message.editedAt && <span className="bubble-flag">(edited)</span>}
            {message.pinned && <span className="bubble-flag" aria-label="Pinned">📌</span>}
          </div>
          {!mine && <button type="button" className="bubble-more" aria-label="Message options" onClick={() => setMenu(true)}>⋯</button>}
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
      {reactError && <div className="bubble-error">{reactError}</div>}
      {picking && <ReactionPicker quick={quick} current={myReaction} onPick={react} onClose={() => setPicking(false)} onQuickChange={onQuickChange} />}
      {menu && (
        <ActionSheet title="Message" header={emojiRow} onClose={() => setMenu(false)} actions={[
          message.content && { key: 'copy', label: 'Copy', icon: '📋', onClick: copyText },
          { key: 'pin', label: message.pinned ? 'Unpin' : 'Pin', icon: '📌', onClick: togglePin },
          mine && message.mediaKind !== 'audio' && !message.mediaUrl && !message.share && { key: 'edit', label: 'Edit', icon: '✏️', onClick: () => { setDraft(message.content); setEditing(true); } },
          { key: 'me', label: 'Delete for me', icon: '🗑️', danger: true, hint: 'Others still see it', onClick: deleteForMe },
          mine && { key: 'unsend', label: 'Unsend', icon: '↩️', danger: true, hint: 'Removes it for everyone', onClick: () => setConfirmUnsend(true) },
        ]} />
      )}
      {confirmUnsend && (
        <ConfirmSheet title="Unsend message?" message="Everyone in this chat will no longer see it." confirmLabel="Unsend" danger busy={busy} onConfirm={unsend} onClose={() => setConfirmUnsend(false)} />
      )}
    </div>
  );
}

// One chat in the list. Long-press (or right-click, or the ⋯ button on desktop) opens its menu.
function ConvoRow({ convo, active, myId, onOpen, onMenu }) {
  const group = convo.type === 'group';
  const other = group ? null : otherParticipant(convo, myId);
  const title = group ? groupTitle(convo, myId) : (other.displayName || other.username);
  const lp = useLongPress(() => onMenu(convo));
  const last = convo.lastMessage;
  let prefix = '';
  if (last) {
    if (last.senderId === myId) prefix = 'You: ';
    else if (group) prefix = `${(convo.participants.find(p => p.id === last.senderId)?.displayName || '').split(' ')[0] || 'Someone'}: `;
  }
  return (
    <div className={`convo-item ${active ? 'active' : ''}`} role="button" tabIndex={0} aria-label={`Open chat with ${title}`}
      onClick={() => onOpen(convo.id)} onKeyDown={e => { if (e.key === 'Enter') onOpen(convo.id); }} {...lp}>
      {group ? <GroupAvatar convo={convo} size={52} myId={myId} /> : <Avatar user={other} size={52} />}
      <div className="convo-main">
        <div className="convo-title">
          <span className="convo-name">{title}</span>
          {convo.muted && <span className="convo-flag" role="img" aria-label="Muted">🔕</span>}
          {convo.restricted && <span className="convo-tag">Restricted</span>}
          {convo.blocked && <span className="convo-tag">Blocked</span>}
        </div>
        <div className="last">{last ? `${prefix}${last.content}` : (group ? 'Group created — say hi 👋' : 'Say hello 👋')}</div>
      </div>
      <button type="button" className="convo-more" aria-label={`Options for ${title}`} onClick={e => { e.stopPropagation(); onMenu(convo); }}>⋯</button>
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
  const [menuFor, setMenuFor] = useState(null);             // chat whose long-press menu is open
  const [confirm, setConfirm] = useState(null);             // { kind: 'delete'|'block'|'leave', convo }
  const [working, setWorking] = useState(false);
  const [newGroup, setNewGroup] = useState(false);          // "New group" sheet
  const [groupInfo, setGroupInfo] = useState(false);        // group details sheet
  const [toast, setToast] = useState('');

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
      const existing = conversations?.find(c => c.type !== 'group' && c.participants.length === 2 && otherParticipant(c, user.id).username === startWithUsername);
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
    // The other person unsent or edited a message in the chat I have open.
    const onDeleted = ({ id }) => { setMessages(list => list.filter(x => x.id !== id)); loadConversations(); };
    const onEdited = ({ id, content, editedAt }) => setMessages(list => list.map(x => (x.id === id ? { ...x, content, editedAt } : x)));
    // A group I'm in was renamed / someone was added or removed / I was removed.
    const onChanged = () => loadConversations();
    socket.on('message:reaction', onReaction);
    socket.on('message:new', onNew);
    socket.on('message:deleted', onDeleted);
    socket.on('message:edited', onEdited);
    socket.on('conversation:changed', onChanged);
    socket.on('message_request:accepted', onAccepted);
    return () => {
      socket.off('message:reaction', onReaction);
      socket.off('message:new', onNew);
      socket.off('message:deleted', onDeleted);
      socket.off('message:edited', onEdited);
      socket.off('conversation:changed', onChanged);
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
  const selfConvo = conversations?.find(c => c.type !== 'group' && c.participants.length === 1 && c.participants[0].id === user.id);
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
    const existing = conversations?.find(c => c.type !== 'group' && c.participants.length === 2 && otherParticipant(c, user.id).username === username);
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

  // ---- Long-press chat menu: Delete chat · Mute · Block · Restrict (or Leave group) ----
  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2600); };
  const runChat = async (fn, okMsg) => {
    setWorking(true);
    try { await fn(); await loadConversations(); if (okMsg) flash(okMsg); }
    catch (err) { flash(err.message || 'Something went wrong.'); }
    finally { setWorking(false); setConfirm(null); }
  };
  const chatMenuActions = (c) => {
    const group = c.type === 'group';
    const self = !group && c.participants.length === 1;
    const other = group || self ? null : otherParticipant(c, user.id);
    const name = group ? groupTitle(c, user.id) : (other?.displayName || other?.username);
    return [
      group && { key: 'info', label: 'Group info', icon: 'ℹ️', onClick: () => { openConversation(c.id); setGroupInfo(true); } },
      !self && { key: 'mute', label: c.muted ? 'Unmute' : 'Mute', icon: c.muted ? '🔔' : '🔕', hint: c.muted ? undefined : 'No alerts for this chat',
        onClick: () => runChat(() => (c.muted ? api.unmuteChat(c.id) : api.muteChat(c.id)), c.muted ? 'Unmuted' : 'Muted — you won\'t get alerts for this chat') },
      other && { key: 'restrict', label: c.restricted ? 'Unrestrict' : 'Restrict', icon: '🚷', hint: c.restricted ? undefined : 'Quiet their messages & comments',
        onClick: () => runChat(() => (c.restricted ? api.unrestrict(other.username) : api.restrict(other.username)), c.restricted ? `${name} is no longer restricted` : `${name} is restricted`) },
      other && { key: 'block', label: c.blocked ? 'Unblock' : 'Block', icon: '⛔', danger: !c.blocked,
        onClick: () => (c.blocked ? runChat(() => api.unblock(other.username), `${name} is unblocked`) : setConfirm({ kind: 'block', convo: c })) },
      group
        ? { key: 'leave', label: 'Leave group', icon: '🚪', danger: true, onClick: () => setConfirm({ kind: 'leave', convo: c }) }
        : { key: 'delete', label: 'Delete chat', icon: '🗑️', danger: true, onClick: () => setConfirm({ kind: 'delete', convo: c }) },
    ];
  };
  const doConfirm = () => {
    const { kind, convo: c } = confirm;
    const other = c.type === 'group' ? null : otherParticipant(c, user.id);
    if (kind === 'block') return runChat(() => api.block(other.username), `${other.displayName || other.username} is blocked`);
    return runChat(async () => {
      await api.deleteChat(c.id);
      if (activeId === c.id) closeChat();
    }, kind === 'leave' ? 'You left the group' : 'Chat deleted');
  };

  const activeConvo = conversations?.find(c => c.id === activeId);
  const groupChat = !!(activeConvo && activeConvo.type === 'group');
  const chatPartner = groupChat
    ? { id: activeConvo.id, username: null, displayName: groupTitle(activeConvo, user.id) }
    : activeConvo ? otherParticipant(activeConvo, user.id) : (pendingToUsername ? { username: pendingToUsername, displayName: pendingToUsername } : null);
  const memberById = (id) => activeConvo?.participants.find(p => p.id === id) || null;

  const isSelfChat = !!(activeConvo && selfConvo && activeConvo.id === selfConvo.id);

  // On phones an open chat takes the whole screen (list + menu bar hidden); the ← button returns to the list.
  const chatOpen = !!(activeId || pendingToUsername);
  useEffect(() => {
    document.documentElement.classList.toggle('chat-open', chatOpen);
    return () => document.documentElement.classList.remove('chat-open');
  }, [chatOpen]);
  const closeChat = () => { setActiveId(null); setPendingToUsername(null); setMessages([]); setStatus(''); setText(''); setAttachOpen(false); clearPending(); };

  // If the open chat disappears from my list (I was removed from the group, or deleted it elsewhere), close it.
  useEffect(() => {
    if (activeId && conversations && !conversations.some(c => c.id === activeId)) closeChat();
    // eslint-disable-next-line
  }, [conversations]);

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
        <div className="msg-list-head">
          <h2 className="msg-title">Messages</h2>
          <button type="button" className="msg-new-group" onClick={() => setNewGroup(true)} aria-label="Create a group chat"><span aria-hidden="true">👥</span> New group</button>
        </div>
        <div className="msg-search-wrap">
          <input
            className="msg-search"
            placeholder="Search people"
            aria-label="Search people to message"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
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
          <div className={`convo-item ${selfConvo && activeId === selfConvo.id ? 'active' : ''}`} onClick={openSelfChat} role="button" tabIndex={0} aria-label="Open your own notes chat" onKeyDown={e => { if (e.key === 'Enter') openSelfChat(); }}>
            <Avatar user={user} size={52} />
            <div className="convo-main">
              <div className="convo-title"><span className="convo-name">{user.displayName || user.username} (You)</span></div>
              <div className="last">{selfConvo?.lastMessage?.content || 'Message yourself — notes, links, reels'}</div>
            </div>
          </div>
          {conversations === null && <div style={{ padding: 14, color: 'var(--text-low)', fontSize: 13 }}>Loading…</div>}
          {conversations?.filter(c => c !== selfConvo).length === 0 && <div style={{ padding: 14, color: 'var(--text-low)', fontSize: 13 }}>No chats yet. Search someone to start chatting, or create a group.</div>}
          {conversations?.filter(c => c !== selfConvo).map(c => (
            <ConvoRow key={c.id} convo={c} active={activeId === c.id} myId={user.id} onOpen={openConversation} onMenu={setMenuFor} />
          ))}
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
              {groupChat
                ? <button type="button" className="chat-id" onClick={() => setGroupInfo(true)} aria-label="Open group info">
                    <GroupAvatar convo={activeConvo} size={38} myId={user.id} />
                    <div className="chat-id-text">
                      <div className="chat-name">{chatPartner.displayName}{activeConvo.muted && <span className="convo-flag" aria-label="Muted"> 🔕</span>}</div>
                      <div className="chat-sub">{activeConvo.participants.length} people · tap for info</div>
                    </div>
                  </button>
                : <div className="chat-id">
                    <Avatar user={chatPartner} size={38} />
                    <div className="chat-id-text">
                      <div className="chat-name">{isSelfChat ? 'You (notes to self)' : (chatPartner.displayName || chatPartner.username)}{activeConvo?.muted && <span className="convo-flag" aria-label="Muted"> 🔕</span>}</div>
                      {!isSelfChat && <OnlineText userId={chatPartner.id} />}
                    </div>
                  </div>}
              {activeId && (
                <div className="chat-actions">
                  {!isSelfChat && !groupChat && !activeConvo?.blocked && <>
                    <button className="chat-icon-btn" aria-label="Voice call" onClick={() => requestStartCall(activeId, 'voice')}>📞</button>
                    <button className="chat-icon-btn" aria-label="Video call" onClick={() => requestStartCall(activeId, 'video')}>🎥</button>
                  </>}
                  {activeConvo && <button className="chat-icon-btn" aria-label="Chat options" onClick={() => setMenuFor(activeConvo)}>⋯</button>}
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
                <MessageBubble key={m.id} message={m} mine={m.senderId === user.id} sender={groupChat ? memberById(m.senderId) : null} myId={user.id} quick={quick} onQuickChange={setQuick} onOpenPost={setOpenPostId} onOpenReel={onOpenReel} onChanged={(updated) => {
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
            {activeConvo?.blocked ? (
              <div className="chat-blocked">
                <div>You blocked {chatPartner.displayName || chatPartner.username}. You can't message each other.</div>
                <button type="button" className="btn-ghost" disabled={working} onClick={() => runChat(() => api.unblock(chatPartner.username), `${chatPartner.displayName || chatPartner.username} is unblocked`)}>Unblock</button>
              </div>
            ) : (
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
            )}
          </>
        )}
      </div>
      </div>
      {openPostId && <PostModal postId={openPostId} onClose={() => setOpenPostId(null)} />}
      {menuFor && (
        <ActionSheet onClose={() => setMenuFor(null)} actions={chatMenuActions(menuFor)}
          title={menuFor.type === 'group' ? groupTitle(menuFor, user.id) : (menuFor.participants.length === 1 ? 'Notes to self' : otherParticipant(menuFor, user.id).displayName)}
          subtitle={menuFor.type === 'group' ? `${menuFor.participants.length} people` : (menuFor.participants.length === 1 ? undefined : `@${otherParticipant(menuFor, user.id).username}`)} />
      )}
      {confirm && (() => {
        const c = confirm.convo; const group = c.type === 'group';
        const other = group ? null : otherParticipant(c, user.id);
        const name = group ? groupTitle(c, user.id) : (other.displayName || other.username);
        const copy = {
          delete: { title: 'Delete chat?', message: c.participants.length === 1 ? 'This clears your notes chat for you.' : `This deletes the conversation for you only. ${name} will still have their copy, and the chat comes back if either of you sends a new message.`, label: 'Delete' },
          block: { title: `Block ${name}?`, message: "They won't be able to message you, and you won't see each other's profiles or posts. You can unblock them anytime in Settings.", label: 'Block' },
          leave: { title: 'Leave this group?', message: "You'll stop receiving its messages. The others stay in the group.", label: 'Leave' },
        }[confirm.kind];
        return <ConfirmSheet title={copy.title} message={copy.message} confirmLabel={copy.label} danger busy={working} onConfirm={doConfirm} onClose={() => setConfirm(null)} />;
      })()}
      {newGroup && <NewGroupSheet onClose={() => setNewGroup(false)} onCreated={async (convo) => { setNewGroup(false); await loadConversations(); openConversation(convo.id); flash('Group created'); }} />}
      {groupInfo && activeConvo?.type === 'group' && (
        <GroupInfoSheet convo={activeConvo} onClose={() => setGroupInfo(false)}
          onChanged={() => loadConversations()}
          onLeft={() => { setGroupInfo(false); closeChat(); loadConversations(); flash('You left the group'); }} />
      )}
      {toast && <div className="chat-toast" role="status">{toast}</div>}
    </div>
  );
}

function OnlineText({ userId }) {
  const online = useIsOnline(userId);
  return online ? <div className="online-text"><span className="online-pip" /> Online now</div> : null;
}
