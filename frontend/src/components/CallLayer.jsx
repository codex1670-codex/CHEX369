import { useCallback, useEffect, useRef, useState } from 'react';
import { connectSocket } from '../socket.js';
import { onStartCallRequest } from '../callBus.js';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';
import { captureMedia, rtcConfig, makeOffer, makeAnswer, tuneSenders, startQualityMonitor, keepAwake } from '../callQuality.js';

const FALLBACK_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

const mediaError = (err) => {
  if (!navigator.mediaDevices?.getUserMedia) return 'Calls need a secure connection (https) and a browser with camera/microphone support.';
  if (err?.name === 'NotAllowedError') return 'Camera/microphone permission was denied. Allow it in your browser settings and try again.';
  if (err?.name === 'NotFoundError') return 'No microphone/camera was found on this device.';
  if (err?.name === 'NotReadableError') return 'Your camera or microphone is being used by another app.';
  return 'Could not access camera/microphone: ' + (err?.message || 'unknown error');
};

const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

// A soft two-tone ring while a call is ringing (caller and callee). Silently does nothing if the browser blocks audio.
function startRing() {
  let ctx; let timer;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = () => {
      [440, 480].forEach(f => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.frequency.value = f; g.gain.value = 0.05; o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.9);
      });
    };
    ctx.resume?.(); beep(); timer = setInterval(beep, 2500);
  } catch { /* no audio */ }
  return () => { clearInterval(timer); try { ctx?.close(); } catch { /* ignore */ } };
}

// Real 1-to-1 voice / video calls (WebRTC). The server only passes the setup messages between the two phones;
// the audio and video travel directly between them (over wifi when both are on the same network).
// Phases: idle -> ringing-out (I called) | ringing-in (someone is calling me) -> connecting -> active -> idle
export default function CallLayer() {
  const [phase, setPhase] = useState('idle');
  const [peer, setPeer] = useState(null);          // the other person
  const [callType, setCallType] = useState('voice');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [, force] = useState(0);
  const [net, setNet] = useState({ level: 'good', tier: 'HD' });     // live connection quality
  const [reconnecting, setReconnecting] = useState(false);
  const [needTap, setNeedTap] = useState(false);                     // browser blocked autoplay of the other person's sound
  const [facing, setFacing] = useState('user');
  const [fullscreen, setFullscreen] = useState(false);

  const phaseRef = useRef('idle');
  const callIdRef = useRef(null);
  const typeRef = useRef('voice');
  const isCallerRef = useRef(false);
  const incomingRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pendingIceRef = useRef([]);
  const iceServersRef = useRef(FALLBACK_ICE);
  const localVideoRef = useRef(null);
  const remoteMediaRef = useRef(null);
  const socketRef = useRef(null);
  const stopMonitorRef = useRef(null);
  const stopAwakeRef = useRef(null);
  const restartsRef = useRef(0);
  const discoTimerRef = useRef(null);
  const rootRef = useRef(null);

  const go = (p) => { phaseRef.current = p; setPhase(p); };

  const cleanup = useCallback((message) => {
    stopMonitorRef.current?.(); stopMonitorRef.current = null; stopAwakeRef.current?.(); stopAwakeRef.current = null;
    clearTimeout(discoTimerRef.current); restartsRef.current = 0;
    setReconnecting(false); setNeedTap(false); setNet({ level: 'good', tier: 'HD' }); setFacing('user');
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    pcRef.current?.close(); pcRef.current = null;
    localStreamRef.current?.getTracks().forEach(t => t.stop()); localStreamRef.current = null;
    remoteStreamRef.current = null; pendingIceRef.current = []; incomingRef.current = null; callIdRef.current = null;
    setMuted(false); setCameraOff(false); setSeconds(0); setPeer(null);
    phaseRef.current = 'idle'; setPhase('idle');
    if (message) setError(message);
  }, []);

  // Show the streams on the <video>/<audio> elements as soon as both exist (they only mount once the call screen is up).
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current && localVideoRef.current.srcObject !== localStreamRef.current) localVideoRef.current.srcObject = localStreamRef.current;
    const r = remoteMediaRef.current;
    if (r && remoteStreamRef.current && r.srcObject !== remoteStreamRef.current) { r.srcObject = remoteStreamRef.current; r.play?.().then(() => setNeedTap(false)).catch(() => setNeedTap(true)); }
  });

  // Ring tone while ringing; call timer while active.
  useEffect(() => {
    if (phase !== 'ringing-in' && phase !== 'ringing-out') return undefined;
    const stop = startRing();
    const vib = phase === 'ringing-in' ? setInterval(() => navigator.vibrate?.([300, 200, 300]), 2500) : null;
    return () => { stop(); if (vib) clearInterval(vib); };
  }, [phase]);
  useEffect(() => {
    if (phase !== 'active') return undefined;
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const getMedia = async (type) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
    const stream = await captureMedia(type, 'user');   // HD video + clean voice (echo/noise/gain control)
    localStreamRef.current = stream;
    force(n => n + 1);
    return stream;
  };

  const loadIce = async () => {
    try { const r = await api.callIce(); if (r.iceServers?.length) iceServersRef.current = r.iceServers; } catch { /* keep fallback */ }
  };

  // Caller-side ICE restart: builds a brand-new network path without hanging up (used when wifi/mobile data
  // switches or drops for a moment). The callee asks for one with a 'restart' signal.
  const restartIce = async () => {
    const pc = pcRef.current, socket = socketRef.current;
    if (!pc || !callIdRef.current) return;
    if (!isCallerRef.current) { socket.emit('call:signal', { callId: callIdRef.current, data: { kind: 'restart' } }); return; }
    try {
      pc.restartIce?.();
      const sdp = await makeOffer(pc, { iceRestart: true });
      socket.emit('call:signal', { callId: callIdRef.current, data: { kind: 'offer', sdp } });
    } catch { /* next attempt will retry */ }
  };

  const createPc = () => {
    const socket = socketRef.current;
    const pc = new RTCPeerConnection(rtcConfig(iceServersRef.current));
    localStreamRef.current?.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));
    pc.ontrack = (e) => {
      remoteStreamRef.current = e.streams[0] || new MediaStream([e.track]);
      try { if (e.track.kind === 'audio' && 'jitterBufferTarget' in e.receiver) e.receiver.jitterBufferTarget = 80; } catch { /* ignore */ }
      force(n => n + 1);
    };
    pc.onicecandidate = (e) => { if (e.candidate) socket.emit('call:signal', { callId: callIdRef.current, data: { kind: 'ice', candidate: e.candidate } }); };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') {
        clearTimeout(discoTimerRef.current); restartsRef.current = 0; setReconnecting(false);
        go('active');
        tuneSenders(pc, 0);
        if (!stopMonitorRef.current) stopMonitorRef.current = startQualityMonitor(pc, setNet);
        if (!stopAwakeRef.current) keepAwake().then(stop => { if (phaseRef.current === 'idle') stop(); else stopAwakeRef.current = stop; });
      } else if (st === 'disconnected') {
        // A short blip often heals itself; if it doesn't within 2.5 s, rebuild the path (no hang-up).
        setReconnecting(true);
        clearTimeout(discoTimerRef.current);
        discoTimerRef.current = setTimeout(() => { if (pcRef.current === pc && pc.connectionState !== 'connected') restartIce(); }, 2500);
      } else if (st === 'failed') {
        if (restartsRef.current < 4 && phaseRef.current !== 'idle') {
          restartsRef.current += 1; setReconnecting(true); restartIce();
          clearTimeout(discoTimerRef.current);
          discoTimerRef.current = setTimeout(() => { if (pcRef.current === pc && pc.connectionState !== 'connected') pc.onconnectionstatechange?.(); }, 4000);
        } else {
          socket.emit('call:end', { callId: callIdRef.current });
          cleanup("The connection was lost. Check your internet and try calling again.");
        }
      }
    };
    pcRef.current = pc;
    return pc;
  };

  const flushIce = async (pc) => {
    const queued = pendingIceRef.current; pendingIceRef.current = [];
    for (const c of queued) { try { await pc.addIceCandidate(c); } catch { /* ignore */ } }
  };

  useEffect(() => {
    const socket = connectSocket();   // the same shared connection the rest of the app uses
    socketRef.current = socket;

    const onIncoming = (data) => {
      if (phaseRef.current !== 'idle') { socket.emit('call:decline', { callId: data.callId }); return; } // already busy
      incomingRef.current = data; callIdRef.current = data.callId; typeRef.current = data.type;
      setCallType(data.type); setPeer(data.caller); setError(''); go('ringing-in');
    };
    const onRinging = (data) => {
      callIdRef.current = data.callId; setPeer(data.peers?.[0] || null); go('ringing-out');
    };
    const onAccepted = async ({ callId }) => {
      if (callId !== callIdRef.current) return;
      go('connecting');
      if (!isCallerRef.current) return; // the person who picked up waits for the offer
      try {
        const pc = createPc();
        const sdp = await makeOffer(pc);
        socket.emit('call:signal', { callId, data: { kind: 'offer', sdp } });
      } catch (err) { socket.emit('call:end', { callId }); cleanup('Could not start the call: ' + err.message); }
    };
    const onSignal = async ({ callId, data }) => {
      if (callId !== callIdRef.current || !data) return;
      try {
        if (data.kind === 'offer') {
          const pc = pcRef.current || createPc();
          await pc.setRemoteDescription(data.sdp);
          await flushIce(pc);
          const sdp = await makeAnswer(pc);
          socket.emit('call:signal', { callId, data: { kind: 'answer', sdp } });
        } else if (data.kind === 'answer') {
          const pc = pcRef.current;
          if (pc) { await pc.setRemoteDescription(data.sdp); await flushIce(pc); }
        } else if (data.kind === 'restart') {
          if (isCallerRef.current) restartIce();
        } else if (data.kind === 'ice') {
          const pc = pcRef.current;
          if (pc?.remoteDescription) { try { await pc.addIceCandidate(data.candidate); } catch { /* ignore */ } }
          else pendingIceRef.current.push(data.candidate); // arrived before the offer/answer — keep it
        }
      } catch (err) { cleanup('Call setup failed: ' + err.message); }
    };
    const closing = (message) => ({ callId }) => { if (callId === callIdRef.current && phaseRef.current !== 'idle') cleanup(message); };
    const onDeclined = closing('Call declined.');
    const onEnded = closing('');
    const onMissed = closing('No answer.');
    const onCallError = (e) => { cleanup(e.message); };

    // If the socket dropped and came back mid-call, re-enter the call room (the server forgot us) and
    // rebuild the media path.
    const onReconnect = () => {
      if (!callIdRef.current || phaseRef.current === 'idle') return;
      socket.emit('call:rejoin', { callId: callIdRef.current });
      if (pcRef.current && pcRef.current.connectionState !== 'connected') setTimeout(restartIce, 600);
    };
    const onOnline = () => { if (pcRef.current && phaseRef.current !== 'idle') setTimeout(restartIce, 400); };
    socket.on('connect', onReconnect);
    window.addEventListener('online', onOnline);

    socket.on('call:incoming', onIncoming);
    socket.on('call:ringing', onRinging);
    socket.on('call:accepted', onAccepted);
    socket.on('call:signal', onSignal);
    socket.on('call:declined', onDeclined);
    socket.on('call:ended', onEnded);
    socket.on('call:missed', onMissed);
    socket.on('call:error', onCallError);

    const unsubscribeStart = onStartCallRequest(async ({ conversationId, type }) => {
      if (phaseRef.current !== 'idle') return;
      isCallerRef.current = true; typeRef.current = type; setCallType(type); setError('');
      go('starting');
      try { await getMedia(type); } catch (err) { cleanup(mediaError(err)); return; } // ask for camera/mic before ringing the other person
      await loadIce();
      socket.emit('call:invite', { conversationId, type });
    });

    return () => {
      socket.off('call:incoming', onIncoming); socket.off('call:ringing', onRinging); socket.off('call:accepted', onAccepted);
      socket.off('call:signal', onSignal); socket.off('call:declined', onDeclined); socket.off('call:ended', onEnded);
      socket.off('call:missed', onMissed); socket.off('call:error', onCallError);
      socket.off('connect', onReconnect); window.removeEventListener('online', onOnline);
      unsubscribeStart();
    };
    // eslint-disable-next-line
  }, []);

  // Leaving the app mid-call hangs up.
  useEffect(() => () => { stopMonitorRef.current?.(); stopAwakeRef.current?.(); if (callIdRef.current) socketRef.current?.emit('call:end', { callId: callIdRef.current }); pcRef.current?.close(); localStreamRef.current?.getTracks().forEach(t => t.stop()); }, []);

  const acceptIncoming = async () => {
    const inc = incomingRef.current; if (!inc) return;
    isCallerRef.current = false; go('connecting');
    try {
      await getMedia(inc.type);      // microphone/camera ready BEFORE telling the caller to start
      await loadIce();
      socketRef.current.emit('call:accept', { callId: inc.callId });
    } catch (err) {
      socketRef.current.emit('call:decline', { callId: inc.callId });
      cleanup(mediaError(err));
    }
  };
  const declineIncoming = () => { socketRef.current?.emit('call:decline', { callId: callIdRef.current }); cleanup(''); };
  const endCall = () => { socketRef.current?.emit('call:end', { callId: callIdRef.current }); cleanup(''); };
  const toggleMute = () => {
    const t = localStreamRef.current?.getAudioTracks()[0];
    if (t) { t.enabled = !t.enabled; setMuted(!t.enabled); }
  };
  const toggleCamera = () => {
    const t = localStreamRef.current?.getVideoTracks()[0];
    if (t) { t.enabled = !t.enabled; setCameraOff(!t.enabled); }
  };

  const flipCamera = async () => {
    const pc = pcRef.current; if (!pc) return;
    const next = facing === 'user' ? 'environment' : 'user';
    try {
      const fresh = await captureMedia('video', next);
      const track = fresh.getVideoTracks()[0];
      const sender = pc.getSenders().find(x => x.track?.kind === 'video');
      if (sender) await sender.replaceTrack(track);      // swaps cameras live — no renegotiation, no break
      localStreamRef.current.getVideoTracks().forEach(t => { t.stop(); localStreamRef.current.removeTrack(t); });
      localStreamRef.current.addTrack(track);
      fresh.getAudioTracks().forEach(t => t.stop());
      track.enabled = !cameraOff;
      setFacing(next); force(n => n + 1);
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      tuneSenders(pc, 0);
    } catch { /* camera busy or only one camera */ }
  };
  const toggleFullscreen = () => {
    const el = rootRef.current; if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.().then(() => setFullscreen(false)).catch(() => {});
    else el.requestFullscreen?.().then(() => setFullscreen(true)).catch(() => {});
  };
  const tapToPlay = () => { remoteMediaRef.current?.play?.().then(() => setNeedTap(false)).catch(() => {}); };

  if (phase === 'idle' && !error) return null;

  const isVideo = callType === 'video';
  const inCall = phase === 'connecting' || phase === 'active';
  const name = peer?.displayName || peer?.username || '';
  const status = phase === 'ringing-in' ? `Incoming ${callType} call…` : phase === 'ringing-out' ? 'Ringing…' : phase === 'starting' ? 'Starting…' : phase === 'connecting' ? 'Connecting…' : fmt(seconds);

  return (
    <div className="call-screen" role="dialog" aria-label="Call" data-noswipe ref={rootRef}>
      {error && phase === 'idle' ? (
        <div className="glass-card" style={{ width: 360, maxWidth: '92vw', padding: 24, textAlign: 'center' }}>
          <div className="error-banner" style={{ marginBottom: 14 }}>{error}</div>
          <button className="btn-ghost" onClick={() => setError('')}>OK</button>
        </div>
      ) : (
        <>
          {isVideo && inCall && (
            <video ref={remoteMediaRef} className="call-remote" autoPlay playsInline />
          )}
          {!isVideo && inCall && <audio ref={remoteMediaRef} autoPlay playsInline />}

          {(!isVideo || !inCall) && (
            <div className="call-center">
              {peer && <Avatar user={peer} size={104} showPresence={false} />}
              <div className="call-name">{name}</div>
              <div className="call-status">{status}</div>
            </div>
          )}
          {isVideo && inCall && (
            <div className="call-topbar"><span className="call-name" style={{ fontSize: 16 }}>{name}</span><span className="call-status">{status}</span></div>
          )}
          {phase === 'active' && (
            <div className={`call-net ${net.level}`} title={net.rtt != null ? `${net.rtt} ms · ${net.loss}% loss` : 'Connection'}>
              <span className="bars"><i /><i /><i /></span>
              {isVideo ? <b>{net.tier}</b> : <b>HD voice</b>}
            </div>
          )}
          {reconnecting && inCall && <div className="call-banner">Reconnecting… your call will continue</div>}
          {!reconnecting && phase === 'active' && net.level === 'poor' && <div className="call-banner warn">Weak connection — {isVideo ? 'lowering video quality to keep your voice clear' : 'optimising voice'}</div>}
          {needTap && inCall && <button className="call-tap" onClick={tapToPlay}>🔊 Tap to turn on sound</button>}

          {isVideo && inCall && localStreamRef.current && (
            <video ref={localVideoRef} className={`call-local${cameraOff ? ' off' : ''}`} autoPlay playsInline muted />
          )}

          <div className="call-controls">
            {phase === 'ringing-in' ? (
              <>
                <button className="call-btn decline" onClick={declineIncoming} aria-label="Decline">✕<small>Decline</small></button>
                <button className="call-btn accept" onClick={acceptIncoming} aria-label="Accept">{isVideo ? '🎥' : '📞'}<small>Accept</small></button>
              </>
            ) : (
              <>
                {inCall && <button className={`call-btn${muted ? ' on' : ''}`} onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? '🔇' : '🎙'}<small>{muted ? 'Unmute' : 'Mute'}</small></button>}
                {inCall && isVideo && <button className="call-btn" onClick={flipCamera} aria-label="Flip camera">🔄<small>Flip</small></button>}
                {inCall && isVideo && document.fullscreenEnabled && <button className="call-btn call-fs" onClick={toggleFullscreen} aria-label="Full screen">{fullscreen ? '🗗' : '⛶'}<small>{fullscreen ? 'Exit' : 'Full'}</small></button>}
                {inCall && isVideo && <button className={`call-btn${cameraOff ? ' on' : ''}`} onClick={toggleCamera} aria-label="Camera">{cameraOff ? '🚫' : '📷'}<small>{cameraOff ? 'Camera on' : 'Camera off'}</small></button>}
                <button className="call-btn decline" onClick={endCall} aria-label={phase === 'ringing-out' ? 'Cancel call' : 'End call'}>✕<small>{inCall ? 'End' : 'Cancel'}</small></button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
