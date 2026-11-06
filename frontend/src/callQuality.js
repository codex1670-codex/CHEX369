// Call quality toolkit: HD capture, Opus voice tuning, bitrate/priority hints and an adaptive network
// monitor. Everything here is best-effort — if a browser lacks a feature the call simply keeps working
// with the browser's defaults.

// ---- capture --------------------------------------------------------------------------------
export const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: { ideal: 48000 },
  sampleSize: { ideal: 16 },
};

export const videoConstraints = (facingMode = 'user') => ({
  facingMode,
  width: { ideal: 1280, max: 1920 },
  height: { ideal: 720, max: 1080 },
  frameRate: { ideal: 30, max: 30 },
});

export async function captureMedia(type, facingMode = 'user') {
  const md = navigator.mediaDevices;
  let stream;
  try {
    stream = await md.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: type === 'video' ? videoConstraints(facingMode) : false });
  } catch (err) {
    // Some devices reject fancy constraints: retry with the plain basics before giving up.
    if (err?.name === 'OverconstrainedError' || err?.name === 'TypeError') {
      stream = await md.getUserMedia({ audio: true, video: type === 'video' ? { facingMode } : false });
    } else throw err;
  }
  stream.getAudioTracks().forEach(t => { try { t.contentHint = 'speech'; } catch { /* ignore */ } });
  stream.getVideoTracks().forEach(t => { try { t.contentHint = 'motion'; } catch { /* ignore */ } });
  return stream;
}

// ---- connection config ----------------------------------------------------------------------
export const rtcConfig = (iceServers) => ({
  iceServers,
  iceCandidatePoolSize: 4,        // gather candidates early → the call connects faster
  bundlePolicy: 'max-bundle',     // one transport for audio+video → fewer ports, steadier path
  rtcpMuxPolicy: 'require',
});

// ---- SDP tuning (Opus voice) ----------------------------------------------------------------
// Mono Opus at 48 kHz with in-band forward-error-correction: the receiver can rebuild a lost packet from
// the next one, which is what removes the "breaking" sound on a shaky connection. 20 ms frames keep the
// delay low; ~64 kbps is studio-clear for speech.
export function tuneSdp(sdp) {
  if (!sdp) return sdp;
  const m = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!m) return sdp;
  const pt = m[1];
  const params = 'minptime=10;useinbandfec=1;usedtx=0;stereo=0;sprop-stereo=0;maxaveragebitrate=64000;maxplaybackrate=48000;cbr=0';
  const re = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  if (re.test(sdp)) {
    return sdp.replace(re, (_all, existing) => {
      const keep = existing.split(';').filter(kv => kv && !/^(minptime|useinbandfec|usedtx|stereo|sprop-stereo|maxaveragebitrate|maxplaybackrate|cbr)=/.test(kv));
      return `a=fmtp:${pt} ${[...keep, ...params.split(';')].join(';')}`;
    });
  }
  return sdp.replace(new RegExp(`(a=rtpmap:${pt} opus/48000/2\\r?\\n)`), `$1a=fmtp:${pt} ${params}\r\n`);
}

export async function makeOffer(pc, opts) {
  const o = await pc.createOffer(opts);
  const tuned = { type: o.type, sdp: tuneSdp(o.sdp) };
  await pc.setLocalDescription(tuned);
  return pc.localDescription;
}
export async function makeAnswer(pc) {
  const a = await pc.createAnswer();
  const tuned = { type: a.type, sdp: tuneSdp(a.sdp) };
  await pc.setLocalDescription(tuned);
  return pc.localDescription;
}

// ---- encoder settings -----------------------------------------------------------------------
// Video tiers, best → worst. The monitor below steps between them as the network changes.
export const TIERS = [
  { name: 'HD',  bitrate: 2_500_000, scale: 1,   fps: 30 },
  { name: 'HD−', bitrate: 1_400_000, scale: 1,   fps: 30 },
  { name: 'SD',  bitrate:   700_000, scale: 1.5, fps: 30 },
  { name: 'SD−', bitrate:   350_000, scale: 2,   fps: 24 },
  { name: 'Low', bitrate:   180_000, scale: 3,   fps: 15 },
];

async function setParams(sender, mutate) {
  try {
    const p = sender.getParameters();
    if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    mutate(p);
    await sender.setParameters(p);
  } catch { /* unsupported — ignore */ }
}

export function tuneSenders(pc, tierIndex = 0) {
  pc.getSenders().forEach(sender => {
    const kind = sender.track?.kind;
    if (kind === 'audio') {
      setParams(sender, p => { Object.assign(p.encodings[0], { maxBitrate: 64_000, priority: 'high', networkPriority: 'high' }); });
    } else if (kind === 'video') {
      const t = TIERS[tierIndex];
      setParams(sender, p => {
        Object.assign(p.encodings[0], { maxBitrate: t.bitrate, maxFramerate: t.fps, scaleResolutionDownBy: t.scale, priority: 'medium', networkPriority: 'medium' });
        p.degradationPreference = 'maintain-framerate';   // smooth motion first, sharpness second
      });
    }
  });
  // A small playout buffer rides out jitter so voice doesn't stutter (still well under 150 ms delay).
  pc.getReceivers().forEach(r => {
    try { if (r.track?.kind === 'audio' && 'jitterBufferTarget' in r) r.jitterBufferTarget = 80; } catch { /* ignore */ }
  });
}

// ---- adaptive network monitor ---------------------------------------------------------------
// Every 2 s: read loss / delay / jitter. Bad network → drop video quality at once (audio is never touched,
// so the voice stays clear). Good network for 3 checks in a row → climb back up one step.
export function startQualityMonitor(pc, onUpdate) {
  let tier = 0, good = 0, prev = null, stopped = false;
  const tick = async () => {
    if (stopped || pc.connectionState === 'closed') return;
    try {
      const stats = await pc.getStats();
      let rtt = null, loss = 0, jitter = 0, outBitrate = null, lossPackets = 0, totalPackets = 0;
      stats.forEach(s => {
        if (s.type === 'candidate-pair' && (s.nominated || s.state === 'succeeded') && s.currentRoundTripTime != null) {
          rtt = Math.max(rtt ?? 0, s.currentRoundTripTime * 1000);
          if (s.availableOutgoingBitrate) outBitrate = s.availableOutgoingBitrate;
        }
        if (s.type === 'remote-inbound-rtp' && s.fractionLost != null) loss = Math.max(loss, s.fractionLost * 100);
        if (s.type === 'inbound-rtp' && !s.isRemote) {
          lossPackets += s.packetsLost || 0; totalPackets += (s.packetsReceived || 0) + (s.packetsLost || 0);
          if (s.jitter != null) jitter = Math.max(jitter, s.jitter * 1000);
        }
      });
      // loss on what we RECEIVE, measured over the last interval
      if (prev) {
        const dl = lossPackets - prev.lost, dt = totalPackets - prev.total;
        if (dt > 20) loss = Math.max(loss, (Math.max(0, dl) / dt) * 100);
      }
      prev = { lost: lossPackets, total: totalPackets };

      const bad = loss > 10 || (rtt ?? 0) > 700 || jitter > 120 || (outBitrate != null && outBitrate < 150_000);
      const fair = loss > 3 || (rtt ?? 0) > 350 || jitter > 50 || (outBitrate != null && outBitrate < 500_000);
      const level = bad ? 'poor' : fair ? 'fair' : 'good';

      let next = tier;
      if (bad) { next = Math.min(TIERS.length - 1, tier + 2); good = 0; }
      else if (fair) { next = Math.min(TIERS.length - 1, tier + 1); good = 0; }
      else if (++good >= 3 && tier > 0) {
        // Only climb if the estimated bandwidth can carry the next tier.
        if (outBitrate == null || outBitrate > TIERS[tier - 1].bitrate * 1.3) { next = tier - 1; good = 0; }
      }
      if (next !== tier) { tier = next; tuneSenders(pc, tier); }
      onUpdate?.({ level, tier: TIERS[tier].name, rtt: rtt == null ? null : Math.round(rtt), loss: Math.round(loss * 10) / 10 });
    } catch { /* stats unavailable */ }
  };
  const id = setInterval(tick, 2000);
  return () => { stopped = true; clearInterval(id); };
}

// ---- keep the screen awake during a call ----------------------------------------------------
export async function keepAwake() {
  let lock = null;
  const grab = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ } };
  const onVis = () => { if (document.visibilityState === 'visible') grab(); };
  await grab();
  document.addEventListener('visibilitychange', onVis);
  return () => { document.removeEventListener('visibilitychange', onVis); try { lock?.release(); } catch { /* ignore */ } };
}
