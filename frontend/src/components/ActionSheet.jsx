import { useEffect } from 'react';
import { createPortal } from 'react-dom';

// Instagram-style bottom sheet: a short list of actions that slides up from the bottom of the phone
// (centered card on desktop). Tapping outside, pressing Esc or tapping Cancel closes it.
//
//   <ActionSheet title="Post" actions={[{ key, label, icon, danger, onClick }]} onClose={…} />
//
// `header` can be any node shown above the list (e.g. a row of emoji to react with).
export default function ActionSheet({ title, subtitle, header, actions = [], onClose, cancelLabel = 'Cancel' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = (a) => { onClose?.(); a.onClick?.(); };

  return createPortal(
    <div className="as-scrim" data-noswipe onClick={onClose}>
      <div className="as-sheet" role="dialog" aria-label={title || 'Options'} onClick={e => e.stopPropagation()}>
        <div className="as-grab" aria-hidden="true" />
        {(title || subtitle) && (
          <div className="as-head">
            {title && <div className="as-title">{title}</div>}
            {subtitle && <div className="as-sub">{subtitle}</div>}
          </div>
        )}
        {header}
        <div className="as-list" role="menu">
          {actions.filter(Boolean).map(a => (
            <button key={a.key || a.label} type="button" role="menuitem" className={`as-item${a.danger ? ' danger' : ''}`} onClick={() => run(a)}>
              {a.icon && <span className="as-icon" aria-hidden="true">{a.icon}</span>}
              <span className="as-label">{a.label}</span>
              {a.hint && <span className="as-hint">{a.hint}</span>}
            </button>
          ))}
        </div>
        <button type="button" className="as-cancel" onClick={onClose}>{cancelLabel}</button>
      </div>
    </div>,
    document.body,
  );
}

// A yes/no question in the same sheet style (used before anything destructive: delete post, delete chat, block…).
export function ConfirmSheet({ title, message, confirmLabel = 'Confirm', danger = false, busy = false, onConfirm, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="as-scrim" data-noswipe onClick={busy ? undefined : onClose}>
      <div className="as-sheet as-confirm" role="alertdialog" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="as-grab" aria-hidden="true" />
        <div className="as-head">
          <div className="as-title">{title}</div>
          {message && <div className="as-sub as-msg">{message}</div>}
        </div>
        <div className="as-list">
          <button type="button" className={`as-item center${danger ? ' danger' : ''}`} disabled={busy} onClick={onConfirm}>
            <span className="as-label">{busy ? 'Please wait…' : confirmLabel}</span>
          </button>
        </div>
        <button type="button" className="as-cancel" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </div>,
    document.body,
  );
}
