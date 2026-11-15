import { useEffect, useRef, useState } from 'react';

export const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : 0);

/** Number box that only commits on Enter / blur, so half-typed values like "-" never reach the model. */
export function NumInput({ value, onCommit, step = 0.01, label, min, max, disabled }) {
  const [draft, setDraft] = useState(String(round(value))); const focus = useRef(false);
  useEffect(() => { if (!focus.current) setDraft(String(round(value))); }, [value]);
  const commit = () => { const n = Number(draft); if (Number.isFinite(n)) onCommit(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))); else setDraft(String(round(value))); };
  return (
    <input className="ss-num" type="number" inputMode="decimal" step={step} value={draft} disabled={disabled} aria-label={label}
      onFocus={() => { focus.current = true; }} onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { focus.current = false; commit(); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }} />
  );
}

export function Slider({ label, value, min, max, step = 0.01, onChange, unit = '', digits = 2, disabled }) {
  return (
    <label className="sim-slider">
      <span className="sim-slider-top"><span>{label}</span><b>{Number(value).toFixed(digits)}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export const Section = ({ title, children, hint }) => (
  <section className="ss-sec"><h4>{title}</h4>{hint && <p className="ss-help">{hint}</p>}{children}</section>
);

export const Btn = ({ children, ...p }) => <button type="button" className="btn-ghost ss-btn" {...p}>{children}</button>;
export const Primary = ({ children, ...p }) => <button type="button" className="btn-primary ss-btn" {...p}>{children}</button>;

export function Confirm({ text, onYes, onNo, yes = 'Apply', no = 'Cancel' }) {
  return (
    <div className="ss-confirm" role="alertdialog" aria-label="Confirm">
      <p>{text}</p><div><Primary onClick={onYes}>{yes}</Primary><Btn onClick={onNo}>{no}</Btn></div>
    </div>
  );
}

export const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const fmtNum = (n) => Number(n).toLocaleString();
