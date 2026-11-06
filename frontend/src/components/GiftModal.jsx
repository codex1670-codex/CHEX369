import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';

const fmt = (n) => Number(n).toLocaleString();

// "Send a gift": coins, premium themes, premium frames or a CHEX learn language to one person.
// The sender pays from their own wallet. Pass `username` to lock it to one person (profile page),
// or leave it out to let the sender type who it's for (coin store).
export default function GiftModal({ username: fixed, onClose, onSent }) {
  const [wallet, setWallet] = useState(null);
  const [opts, setOpts] = useState(null);
  const [to, setTo] = useState(fixed || '');
  const [type, setType] = useState('coins');
  const [amount, setAmount] = useState(10);
  const [lang, setLang] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    api.coins().then(setWallet).catch(() => {});
    api.giftOptions().then(o => { setOpts(o); setLang(o.languages[0]?.code || ''); }).catch(e => setError(e.message));
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const price = (id) => wallet?.items?.find(i => i.id === id)?.price;
  const langPrice = wallet?.learn?.unlockPrice ?? 100;
  const cost = type === 'coins' ? Number(amount) || 0 : type === 'language' ? langPrice : price(type) ?? 0;
  const unlimited = !!wallet?.unlimited;
  const enough = unlimited || (wallet ? wallet.balance >= cost : true);
  const kinds = [
    ['coins', '🪙 CHEX coins'],
    ['premium-themes', '✨ Premium themes'],
    ['premium-frames', '🖼️ Premium frames'],
    ['language', '🌍 A language'],
  ];

  const send = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.sendGift({ username: to.trim().replace(/^@/, ''), type, amount: type === 'coins' ? Number(amount) : undefined, lang: type === 'language' ? lang : undefined });
      setDone(`🎁 Sent ${r.gift} to @${r.to}!`);
      setWallet(r.wallet);
      onSent?.(r);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return createPortal(
    <div className="as-scrim" data-noswipe onClick={onClose}>
      <div className="as-sheet" role="dialog" aria-label="Send a gift" onClick={e => e.stopPropagation()} style={{ maxHeight: '88vh', overflowY: 'auto' }}>
        <div className="as-grab" aria-hidden="true" />
        <div className="as-head">
          <div className="as-title">🎁 Send a gift{fixed ? ` to @${fixed}` : ''}</div>
          <div className="as-sub">{unlimited ? 'You have unlimited CHEX coins.' : wallet ? `You have ${fmt(wallet.balance)} CHEX coins — the gift is paid from them.` : ' '}</div>
        </div>
        <div style={{ padding: '0 16px 12px', display: 'grid', gap: 10 }}>
          {!fixed && (
            <div className="field" style={{ margin: 0 }}>
              <label>Send to</label>
              <input value={to} onChange={e => setTo(e.target.value)} placeholder="@username" autoCapitalize="none" autoCorrect="off" />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {kinds.map(([k, label]) => (
              <button key={k} type="button" className={type === k ? 'btn-primary' : 'btn-ghost'} style={{ width: 'auto', padding: '7px 12px', fontSize: 13 }} aria-pressed={type === k} onClick={() => { setType(k); setError(''); setDone(''); }}>{label}</button>
            ))}
          </div>
          {type === 'coins' && (
            <div className="field" style={{ margin: 0 }}>
              <label>How many coins{opts ? ` (1–${opts.rules.maxCoinsPerGift}, up to ${opts.rules.dailyCoinCap} a day)` : ''}</label>
              <input type="number" min="1" max={opts?.rules.maxCoinsPerGift || 500} value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
          )}
          {type === 'language' && (
            <div className="field" style={{ margin: 0 }}>
              <label>Language (they need to have picked their first one already)</label>
              <select value={lang} onChange={e => setLang(e.target.value)}>{(opts?.languages || []).map(l => <option key={l.code} value={l.code}>{l.name}</option>)}</select>
            </div>
          )}
          {type !== 'coins' && <div style={{ fontSize: 12.5, color: 'var(--text-mid)' }}>{type === 'premium-themes' ? 'Unlocks all animated premium themes for them.' : type === 'premium-frames' ? 'Unlocks all animated profile frames for them.' : 'Unlocks this CHEX learn language for them.'}</div>}
          {error && <div className="error-banner">{error}</div>}
          {done && <div className="request-banner">{done}</div>}
          <button className="btn-primary" disabled={busy || !to.trim() || !cost && type === 'coins' || !enough} onClick={send}>
            {busy ? 'Sending…' : unlimited ? 'Send gift' : `Send gift · 🪙 ${fmt(cost)}`}
          </button>
          {!enough && <div style={{ fontSize: 12.5, color: 'var(--text-mid)' }}>You need {fmt(cost - (wallet?.balance || 0))} more coins for this gift.</div>}
        </div>
        <button type="button" className="as-cancel" onClick={onClose}>Close</button>
      </div>
    </div>,
    document.body
  );
}
