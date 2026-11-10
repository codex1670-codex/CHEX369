import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useHeartBurst, useTapHandlers } from './HeartBurst.jsx';

// Fullscreen viewer for any photo or video — post media, chat media, profile photo/video.
// Fills the whole screen on phone and desktop (safe-area aware), also asks the browser for
// real fullscreen where supported, and closes on backdrop tap, the × button, Escape, or the
// phone's Back button.
//
// Everything that touches browser history / the Fullscreen API is set up in a deferred
// timeout that the effect cleanup cancels. React StrictMode (dev) mounts → unmounts →
// remounts every component once; without this, the first cycle's cleanup would fire a
// history.back() / exitFullscreen() that closes the viewer right after it opens.
export default function FullscreenMediaViewer({ mediaType, url, posterUrl, name, onClose, onLike, seedTap }) {
  const rootRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let closed = false;
    const close = () => { if (!closed) { closed = true; onCloseRef.current?.(); } };

    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    let pushed = false;
    let enteredFs = false;
    const onPop = () => { pushed = false; close(); };
    const onFs = () => {
      if (document.fullscreenElement === rootRef.current) enteredFs = true;
      else if (enteredFs) close();           // user left real fullscreen (Esc / browser UI)
    };

    const setup = setTimeout(() => {
      window.history.pushState({ mediaViewer: true }, '');
      pushed = true;
      window.addEventListener('popstate', onPop);
      document.addEventListener('fullscreenchange', onFs);
      // iOS Safari has no Fullscreen API for divs — the CSS overlay already fills the screen there.
      try { rootRef.current?.requestFullscreen?.().catch(() => {}); } catch { /* optional */ }
    }, 30);

    return () => {
      clearTimeout(setup);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('fullscreenchange', onFs);
      document.body.style.overflow = prevOverflow;
      if (document.fullscreenElement && document.fullscreenElement === rootRef.current) document.exitFullscreen?.().catch(() => {});
      if (pushed && window.history.state?.mediaViewer) window.history.back();
    };
  }, []);

  const close = () => onCloseRef.current?.();

  // Double tap on the picture likes it (when the viewer was given an onLike), with the 3D heart.
  const contentRef = useRef(null);
  const { trigger: burstHeart, layer: heartLayer } = useHeartBurst();
  const tap = useTapHandlers({
    onDouble: (e) => { if (!onLike) return; burstHeart(e.clientX, e.clientY, rootRef.current); onLike(); },
    onSingle: () => {},
    seed: seedTap || null,
  });

  // Portal to <body>: a parent with blur/3D/transform (post card, chat bubble) would otherwise
  // trap this "fixed" overlay inside itself instead of letting it fill the screen.
  return createPortal(
    <div ref={rootRef} className="media-viewer-overlay" onClick={close} role="dialog" aria-modal="true">
      <button className="media-viewer-close" onClick={(e) => { e.stopPropagation(); close(); }} aria-label="Close">✕</button>
      <div ref={contentRef} className="media-viewer-content" onClick={e => { e.stopPropagation(); if (onLike) tap.onClick(e); }}>
        {mediaType === 'video' ? (
          <video src={url} poster={posterUrl || undefined} controls autoPlay loop playsInline className="media-viewer-media" />
        ) : (
          <img src={url} alt={name || 'Photo'} className="media-viewer-media" />
        )}
      </div>
      {heartLayer}
    </div>,
    document.body
  );
}
