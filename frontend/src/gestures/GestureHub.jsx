import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GESTURE_EVENT, CHANGED, SENSITIVITY, loadGestures, startShakeDetector } from './gestureStore.js';
import { setAlertsEnabled, alertsEnabled } from '../announce.js';
import { circleAskEnabled } from '../circleAsk/settings.js';
import QuickShare from './QuickShare.jsx';
import VoiceSearch from './VoiceSearch.jsx';
import ShareSheet from '../components/ShareSheet.jsx';
import Orbit from '../orbit/Orbit.jsx';
import { ORBIT_OPEN, loadOrbit, startOrbitDoubleTap } from '../orbit/orbitStore.js';

// One place that listens for gestures and runs whatever action each is set to (Settings → Smart gestures).
// Mounted once in App. Components only call fireGesture(); they never need to know what it does.
export default function GestureHub({ navigate, user, route }) {
  const [quick, setQuick] = useState(null);       // { kind, id, thumb, … } → quick-send circle
  const [sheet, setSheet] = useState(null);       // { kind, id } → full share sheet
  const [voice, setVoice] = useState(false);
  const [orbit, setOrbit] = useState(false);       // CHEX ORBIT 3D launcher (double-tap any screen)
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const nav = useRef(navigate); nav.current = navigate;

  const say = useCallback((text) => {
    setToast(text); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const run = useCallback((action, ctx = {}) => {
    if (action.startsWith('go:')) { nav.current(action.slice(3), action === 'go:profile' ? user.username : undefined); return; }
    switch (action) {
      case 'quickShare': if (ctx.kind && ctx.id) setQuick(ctx); break;
      case 'sharePicker': if (ctx.kind && ctx.id) setSheet({ kind: ctx.kind, id: ctx.id }); break;
      case 'voiceSearch': setVoice(true); break;
      case 'codexMini': window.dispatchEvent(new CustomEvent('chex:codex-open', { detail: { mode: 'mini' } })); break;
      case 'codexFull': window.dispatchEvent(new CustomEvent('chex:codex-open', { detail: { mode: 'full' } })); break;
      case 'codexTalk': window.dispatchEvent(new CustomEvent('chex:codex-open', { detail: { mode: 'mini', talk: true } })); break;
      case 'circleAsk':
        if (circleAskEnabled()) window.dispatchEvent(new Event('chex:circle-ask-start'));
        else say('Turn on Circle to Ask in Settings first.');
        break;
      case 'scrollTop': window.scrollTo({ top: 0, behavior: 'smooth' }); document.querySelector('.main-col')?.scrollTo?.({ top: 0, behavior: 'smooth' }); break;
      case 'toggleSound': { const on = !alertsEnabled(); setAlertsEnabled(on); say(on ? '🔊 AI alerts on' : '🔇 AI alerts muted'); break; }
      default: break;
    }
  }, [user.username, say]);

  useEffect(() => {
    const onGesture = (e) => { const { action, ctx } = e.detail || {}; if (action) run(action, ctx); };
    window.addEventListener(GESTURE_EVENT, onGesture);
    return () => window.removeEventListener(GESTURE_EVENT, onGesture);
  }, [run]);

  // Shake: only listens while a shake action is set, and re-reads the settings so changes apply at once.
  useEffect(() => {
    let stop = null;
    const sync = () => {
      stop?.(); stop = null;
      const cfg = loadGestures();
      if (cfg.map.shake === 'none') return;
      stop = startShakeDetector(() => {
        if (document.visibilityState !== 'visible') return;
        const a = loadGestures().map.shake;
        if (a === 'none') return;
        try { navigator.vibrate?.([20, 30, 20]); } catch { /* no haptics */ }
        run(a, {});
      }, () => SENSITIVITY[loadGestures().shakeSens] || SENSITIVITY.medium);
    };
    sync();
    window.addEventListener(CHANGED, sync);
    return () => { stop?.(); window.removeEventListener(CHANGED, sync); };
  }, [run]);

  // CHEX ORBIT: a double tap on any quiet part of any screen opens it (see orbitStore.isOrbitIgnored for what keeps its own double-tap).
  useEffect(() => {
    const open = () => { try { window.getSelection?.()?.removeAllRanges?.(); } catch { /* no selection */ } try { navigator.vibrate?.(12); } catch { /* no haptics */ } setOrbit(true); };
    const stop = startOrbitDoubleTap(open, () => loadOrbit().enabled);
    const manual = () => setOrbit(true);
    window.addEventListener(ORBIT_OPEN, manual);
    return () => { stop(); window.removeEventListener(ORBIT_OPEN, manual); };
  }, []);

  const closeAll = () => { setQuick(null); setSheet(null); setVoice(false); };

  return (
    <>
      {quick && (
        <QuickShare item={quick} me={user} onClose={() => setQuick(null)}
          onOpenSheet={() => { setSheet({ kind: quick.kind, id: quick.id }); setQuick(null); }}
          onOpenSettings={() => { closeAll(); nav.current('settings'); }} />
      )}
      {sheet && <ShareSheet kind={sheet.kind} id={sheet.id} onClose={() => setSheet(null)} />}
      {voice && <VoiceSearch onClose={() => setVoice(false)} onSearch={(q) => { setVoice(false); nav.current('search', q ? { query: q } : undefined); }} />}
      {orbit && <Orbit user={user} route={route} navigate={(k, p) => nav.current(k, p)} onClose={() => setOrbit(false)} />}
      {toast && createPortal(<div className="gx-toast" role="status">{toast}</div>, document.body)}
    </>
  );
}
