// Scroll performance helper: keep the full CHEX glass UI, but temporarily reduce
// expensive card backdrop sampling while the user is actively scrolling.
// The original effects are restored automatically when scrolling settles.
export function startScrollPerformance() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const root = document.documentElement;
  let restoreTimer = 0;
  let frame = 0;

  const markScrolling = () => {
    if (!frame) {
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        root.setAttribute('data-chex-scrolling', '');
      });
    }
    window.clearTimeout(restoreTimer);
    restoreTimer = window.setTimeout(() => {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      root.removeAttribute('data-chex-scrolling');
    }, 150);
  };

  // Capture scroll events so nested scroll areas are covered; all listeners are passive.
  document.addEventListener('scroll', markScrolling, { capture: true, passive: true });
  window.addEventListener('wheel', markScrolling, { passive: true });
  window.addEventListener('touchmove', markScrolling, { passive: true });

  return () => {
    document.removeEventListener('scroll', markScrolling, true);
    window.removeEventListener('wheel', markScrolling);
    window.removeEventListener('touchmove', markScrolling);
    window.clearTimeout(restoreTimer);
    if (frame) window.cancelAnimationFrame(frame);
    root.removeAttribute('data-chex-scrolling');
  };
}
