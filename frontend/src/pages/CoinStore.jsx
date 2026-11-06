import { useEffect, useState } from 'react';
import { api } from '../api.js';
import GiftModal from '../components/GiftModal.jsx';

const fmt = (n) => Number(n).toLocaleString();

// CHEX Coins: balance, how to earn them, the store, and recent activity.
export default function CoinStore({ onBack, onOpenSettings }) {
  const [w, setW] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [justUnlocked, setJustUnlocked] = useState(false);
  const [gifting, setGifting] = useState(false);

  useEffect(() => { api.coins().then(setW).catch(e => setError(e.message)); }, []);

  const unlock = async (item) => {
    setBusy(true); setError('');
    try { setW(await api.unlockCoinItem(item.id)); setJustUnlocked(true); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (!w) return <div className="glass-card" style={{ padding: 20 }}>{error ? <div className="error-banner">{error}</div> : 'Loading your coins…'}</div>;
  const m = w.monthly;
  const pct = Math.min(100, Math.round((m.count / m.goal) * 100));

  return (
    <div className="page-narrow">
      <button className="btn-ghost" style={{ width: 'auto', padding: '7px 14px', marginBottom: 12 }} onClick={onBack}>← Back</button>

      <div className="glass-card coin-hero">
        <div className="coin-hero-coin" aria-hidden="true"><img src="/logo.png" alt="" draggable="false" /></div>
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-mid)', fontWeight: 700 }}>Your balance</div>
          <div className="coin-balance">{w.unlimited ? '∞' : fmt(w.balance)} <span>CHEX coins</span></div>
        </div>
      </div>
      {error && <div className="error-banner" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="glass-card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>Earn coins</div>
        <p style={{ fontSize: 13, color: 'var(--text-mid)', margin: '0 0 12px' }}>
          Share {m.goal} public posts in a month and CHEX gives you <b>{m.reward} CHEX coins</b>. Posts shared with followers only don’t count, and neither do repeated posts, the same picture or video again, or content copied from someone else.
        </p>
        <div className="coin-bar" role="progressbar" aria-valuemin={0} aria-valuemax={m.goal} aria-valuenow={Math.min(m.count, m.goal)}><i style={{ width: `${pct}%` }} /></div>
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 8 }}>
          {m.claimed ? `✓ ${m.reward} coins earned this month` : `${Math.min(m.count, m.goal)} / ${m.goal} public posts this month`}
        </div>
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid color-mix(in srgb, var(--text-hi) 10%, transparent)', fontSize: 13 }}>
          🔥 <b>Post a post or reel every day for {w.streak.goal} days in a row → {w.streak.reward} coins.</b> {w.streak.status === 'active' ? `You’re on day ${Math.min(w.streak.dayNumber, w.streak.goal)} — ${w.streak.done} done.` : 'Press Start in Settings → 30-day posting streak.'}
        </div>
        <div style={{ marginTop: 10, fontSize: 13 }}>
          🎮 <b>Win a game, get {w.game.reward} CHEX coin.</b> Draws and games where the other player leaves don’t pay. Up to {w.game.dailyCap} a day — {Math.min(w.game.today, w.game.dailyCap)} earned today.
        </div>
        {w.learn && (
          <div style={{ marginTop: 10, fontSize: 13 }}>
            🌍 <b>Finish a CHEX learn section ({w.learn.levels} levels), get {w.learn.reward} CHEX coin.</b> Each section pays once per language.
          </div>
        )}
      </div>

      <div className="glass-card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 10 }}>Store</div>
        {w.items.map(item => {
          const short = w.unlimited ? 0 : item.price - w.balance;
          return (
            <div key={item.id} className="coin-item">
              <div className="coin-item-icon" aria-hidden="true">{item.owned ? '🔓' : '🔒'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>{item.name}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-mid)', margin: '2px 0 8px' }}>{item.description}</div>
                {item.owned ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 13 }}>✓ {justUnlocked ? 'Unlocked! ' : 'Unlocked'}</b>
                    <button className="btn-primary" style={{ width: 'auto', padding: '8px 16px' }} onClick={onOpenSettings}>{item.id === 'premium-frames' ? 'Choose a frame' : 'Choose a theme'}</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button className="btn-primary" style={{ width: 'auto', padding: '8px 18px' }} disabled={busy || short > 0} onClick={() => unlock(item)}>
                      🪙 Unlock for {fmt(item.price)}
                    </button>
                    {short > 0 && <span style={{ fontSize: 12.5, color: 'var(--text-mid)' }}>{fmt(short)} more coins needed</span>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="glass-card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>🎁 Send a gift</div>
        <p style={{ fontSize: 13, color: 'var(--text-mid)', margin: '0 0 12px' }}>Give a friend CHEX coins, Premium Themes, Premium Frames or a CHEX learn language. It’s paid from your coins. You can also tap 🎁 Gift on anyone’s profile.</p>
        <button className="btn-primary" style={{ width: 'auto', padding: '8px 18px' }} onClick={() => setGifting(true)}>🎁 Send a gift</button>
      </div>
      {gifting && <GiftModal onClose={() => setGifting(false)} onSent={() => api.coins().then(setW).catch(() => {})} />}

      {w.history.length > 0 && (
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 8 }}>Recent activity</div>
          {w.history.map(h => (
            <div key={h.id} className="coin-row">
              <span>{h.reason}<small>{new Date(h.createdAt).toLocaleDateString()}</small></span>
              <b className={h.amount > 0 ? 'plus' : 'minus'}>{h.amount > 0 ? '+' : ''}{fmt(h.amount)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
