import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { getStoredTheme, applyTheme } from '../theme.js';
import { get3D, set3D } from '../ui3d.js';
import Emoji3D from '../components/Emoji3D.jsx';
import { floatingAiEnabled, setFloatingAi } from '../floatingAi.js';
import { getEmojiFx, setEmojiFx, splitEmojis, burstEmoji, DEFAULT_EMOJIS, EMOJI_PALETTE, MAX_EMOJIS } from '../emojiFx.js';
import PermissionsPanel from '../components/PermissionsPanel.jsx';
import SafetyLists from '../components/SafetyLists.jsx';
import HistoryPanel from '../components/HistoryPanel.jsx';
import HighlightsRow from '../components/HighlightsRow.jsx';

import { PROFILE_FRAMES } from '../profileFrames.js';
import Avatar from '../components/Avatar.jsx';
import { PREMIUM_THEMES, getPremiumId, applyPremium, clearPremium, getMotion, setMotion } from '../premiumThemes.js';

function Appearance({ onOpenCoins }) {
  const { user, setUser } = useAuth();
  const [frameBusy, setFrameBusy] = useState(false);
  const [premium, setPremium] = useState(getPremiumId());
  const [motion, setMotionState] = useState(getMotion());
  const [theme, setThemeState] = useState(getStoredTheme());
  const [look3d, setLook3d] = useState(get3D());
  const [wallet, setWallet] = useState(null);
  useEffect(() => { api.coins().then(setWallet).catch(() => {}); }, []);
  const unlocked = !!wallet?.unlocked?.includes('premium-themes');
  const item = wallet?.items?.find(i => i.id === 'premium-themes');
  const framesOwned = !!wallet?.unlocked?.includes('premium-frames');
  const frameItem = wallet?.items?.find(i => i.id === 'premium-frames');
  const currentFrame = wallet?.frame ?? user?.frame ?? null;
  const pickFrame = async (id) => {
    if (!framesOwned) { onOpenCoins(); return; }
    setFrameBusy(true);
    try {
      const w = await api.setProfileFrame(id);
      setWallet(w);
      if (user) setUser({ ...user, frame: w.frame });
    } catch { /* keep the old frame */ }
    finally { setFrameBusy(false); }
  };

  const pickMode = (t) => { setPremium(''); setThemeState(applyTheme(t, true)); };
  const pickPremium = (id) => {
    if (!unlocked) { onOpenCoins(); return; }
    applyPremium(id); setPremium(id); setThemeState(getStoredTheme());
  };
  const leavePremium = () => { setThemeState(applyTheme(getStoredTheme(), true)); setPremium(''); };

  return (
    <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>Appearance</div>
      <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 14 }}>Choose Light or Dark, or unlock the premium animated themes with CHEX coins. Changes apply instantly and are saved on this device.</p>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <button className="btn-ghost" style={{ width: 'auto', padding: '9px 18px', background: theme === 'dark' ? 'var(--violet)' : undefined, borderColor: theme === 'dark' ? 'var(--violet)' : undefined, color: theme === 'dark' ? '#fff' : undefined }} onClick={() => pickMode('dark')}>🌙 Dark</button>
        <button className="btn-ghost" style={{ width: 'auto', padding: '9px 18px', background: theme === 'light' ? 'var(--violet)' : undefined, borderColor: theme === 'light' ? 'var(--violet)' : undefined, color: theme === 'light' ? '#fff' : undefined }} onClick={() => pickMode('light')}>☀️ Light</button>
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        ✨ Premium themes <span style={{ color: 'var(--text-mid)', fontWeight: 600 }}>· animated · {unlocked ? '🔓 unlocked' : '🔒 locked'}</span>
      </div>
      {wallet && !unlocked && (
        <div className="coin-lockbar">
          <span>🔒 Unlock all premium themes &amp; animations for <b>{(item?.price || 1000).toLocaleString()}</b> CHEX coins. You have <b>{wallet.unlimited ? '∞' : wallet.balance.toLocaleString()}</b>.</span>
          <button className="btn-primary" style={{ width: 'auto', padding: '8px 16px' }} onClick={onOpenCoins}>🪙 Open CHEX Coins store</button>
        </div>
      )}
      <div className="pt-grid">
        {PREMIUM_THEMES.map(t => (
          <button key={t.id} className={`pt-card${premium === t.id ? ' on' : ''}${unlocked ? '' : ' locked'}`} aria-pressed={premium === t.id}
            aria-label={unlocked ? t.name : `${t.name} (locked — unlock in the CHEX Coins store)`} onClick={() => pickPremium(t.id)}
            style={{ '--a': t.a, '--b': t.b, '--c': t.c, '--bgA': t.bgA, '--bgB': t.bgB }}>
            <div className="pt-prev"><i className="p1" /><i className="p2" /><i className="ring" /><i className="pill" />{!unlocked && <span className="pt-lock">🔒</span>}</div>
            <div className="pt-name"><b>{t.name}</b><span>{t.tag}</span></div>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <button className={`btn-ghost${motion ? ' sel' : ''}`} style={{ width: 'auto', padding: '9px 18px' }} role="switch" aria-checked={motion} onClick={() => setMotionState(setMotion(!motion))}>{motion ? '🎬 Animations on' : '⏸ Animations off'}</button>
        {premium && <button className="btn-ghost" style={{ width: 'auto', padding: '9px 18px' }} onClick={leavePremium}>Leave premium theme</button>}
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, margin: '4px 0 8px' }}>
        🖼️ Premium profile frames <span style={{ color: 'var(--text-mid)', fontWeight: 600 }}>· animated · {framesOwned ? '🔓 unlocked' : '🔒 locked'}</span>
      </div>
      {wallet && !framesOwned && (
        <div className="coin-lockbar">
          <span>🔒 Unlock all {PROFILE_FRAMES.length} animated profile frames for <b>{(frameItem?.price || 2000).toLocaleString()}</b> CHEX coins. You have <b>{wallet.unlimited ? '∞' : wallet.balance.toLocaleString()}</b>.</span>
          <button className="btn-primary" style={{ width: 'auto', padding: '8px 16px' }} onClick={onOpenCoins}>🪙 Open CHEX Coins store</button>
        </div>
      )}
      <div className="pf-grid">
        {PROFILE_FRAMES.map(f => (
          <button key={f.id} className={`pf-card${currentFrame === f.id ? ' on' : ''}${framesOwned ? '' : ' locked'}`} aria-pressed={currentFrame === f.id} disabled={frameBusy}
            aria-label={framesOwned ? f.name : `${f.name} (locked — unlock in the CHEX Coins store)`} onClick={() => pickFrame(f.id)}>
            {!framesOwned && <span className="pf-lock">🔒</span>}
            <span className="pf-sample-wrap"><Avatar user={user ? { ...user, frame: f.id } : null} name={user?.displayName} size={44} showPresence={false} /></span>
            <span className="pf-name"><b>{f.name}</b><span>{f.tag}</span></span>
          </button>
        ))}
      </div>
      {framesOwned && currentFrame && <div style={{ marginBottom: 18 }}><button className="btn-ghost" style={{ width: 'auto', padding: '9px 18px' }} disabled={frameBusy} onClick={() => pickFrame(null)}>Remove my frame</button></div>}

      <div style={{ fontSize: 13.5, fontWeight: 700, margin: '18px 0 8px' }}>Navigation &amp; buttons</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <button className={`btn-ghost${look3d ? ' sel' : ''}`} style={{ width: 'auto', padding: '9px 18px' }} aria-pressed={look3d} onClick={() => setLook3d(set3D(true))}>🧊 3D</button>
        <button className={`btn-ghost${!look3d ? ' sel' : ''}`} style={{ width: 'auto', padding: '9px 18px' }} aria-pressed={!look3d} onClick={() => setLook3d(set3D(false))}>▭ Flat</button>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-mid)', margin: 0 }}>3D gives the menu and buttons depth, tilt and a press-down effect. Flat is the simple classic look.</p>
    </div>
  );
}

function FloatingAI() {
  const [on, setOn] = useState(floatingAiEnabled());
  const toggle = () => setOn(setFloatingAi(!on));
  return (
    <div className="glass-card" style={{ padding: 20, marginBottom: 20 }} data-testid="floating-ai-card">
      <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display)', fontSize: 16 }}>🤖 Floating AI bar</h3>
      <p style={{ fontSize: 12.5, color: 'var(--text-mid)', margin: '0 0 12px' }}>The Codex AI bar that floats on every page so you can talk or type to it anywhere. It is <b>off by default</b> — switch it on to show it, and off to hide it again.</p>
      <button type="button" role="switch" aria-checked={on} className={`btn-ghost${on ? ' sel' : ''}`} style={{ width: 'auto', padding: '9px 18px' }} onClick={toggle}>{on ? '✓ Floating AI bar is ON' : 'Floating AI bar is OFF'}</button>
    </div>
  );
}

function EmojiEffects() {
  const [fx, setFx] = useState(getEmojiFx());
  const [custom, setCustom] = useState('');
  const save = (patch) => setFx(setEmojiFx(patch));
  const full = fx.emojis.length >= MAX_EMOJIS;
  const toggleEmoji = (e) => {
    if (fx.emojis.includes(e)) { if (fx.emojis.length > 1) save({ emojis: fx.emojis.filter((x) => x !== e) }); }
    else if (!full) save({ emojis: [...fx.emojis, e] });
  };
  const addCustom = (ev) => {
    ev.preventDefault();
    const add = splitEmojis(custom).filter((e) => !fx.emojis.includes(e));
    if (add.length) save({ emojis: [...fx.emojis, ...add].slice(0, MAX_EMOJIS) });
    setCustom('');
  };
  const sw = (on, label, onClick) => (
    <button type="button" role="switch" aria-checked={on} className={`btn-ghost${on ? ' sel' : ''}`} style={{ width: 'auto', padding: '9px 18px' }} onClick={onClick}>{on ? '✓ ' : ''}{label}</button>
  );
  return (
    <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
      <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display)', fontSize: 16 }}>✨ Emoji effects</h3>
      <p style={{ fontSize: 12.5, color: 'var(--text-mid)', margin: '0 0 12px' }}>Glossy 3D emoji fall from the top and float up the screen when a new notification arrives. <b>The emoji are yours to customize</b> — pick from the list or type any emoji you like.</p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {sw(fx.onNotify, 'Show on new notifications', () => save({ onNotify: !fx.onNotify }))}
        {sw(fx.ambient, 'Floating in the background', () => save({ ambient: !fx.ambient }))}
      </div>

      <div style={{ fontSize: 13.5, fontWeight: 700, margin: '4px 0 8px' }}>Animation style</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {[['falling', '⬇️ Falling'], ['floating', '⬆️ Floating'], ['both', '🌀 Both']].map(([id, label]) => (
          <button key={id} type="button" className={`btn-ghost${fx.style === id ? ' sel' : ''}`} style={{ width: 'auto', padding: '9px 18px' }} aria-pressed={fx.style === id} onClick={() => save({ style: id })}>{label}</button>
        ))}
      </div>

      <div style={{ fontSize: 13.5, fontWeight: 700, margin: '4px 0 2px' }}>My emoji ({fx.emojis.length}/{MAX_EMOJIS})</div>
      <div className="ef-chips">
        {fx.emojis.map((e) => (
          <span key={e} className="ef-chip"><Emoji3D char={e} size={28} /><button type="button" aria-label={`Remove ${e}`} disabled={fx.emojis.length <= 1} onClick={() => toggleEmoji(e)}>✕</button></span>
        ))}
      </div>
      <div className="ef-palette" role="group" aria-label="Pick emoji">
        {EMOJI_PALETTE.map((e) => (
          <button key={e} type="button" className={`ef-pick${fx.emojis.includes(e) ? ' on' : ''}`} aria-pressed={fx.emojis.includes(e)} disabled={!fx.emojis.includes(e) && full} onClick={() => toggleEmoji(e)}><Emoji3D char={e} size={28} /></button>
        ))}
      </div>
      <form onSubmit={addCustom} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Type or paste your own emoji" aria-label="Add your own emoji" disabled={full}
          style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '9px 12px', color: 'var(--text-hi)', outline: 'none', fontSize: 15 }} />
        <button className="btn-ghost" type="submit" disabled={full || !custom.trim()}>Add</button>
      </form>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn-primary" style={{ width: 'auto', padding: '9px 18px' }} onClick={() => burstEmoji({ force: true })}>▶ Preview</button>
        <button type="button" className="btn-ghost" onClick={() => save({ emojis: DEFAULT_EMOJIS })}>Reset emoji</button>
      </div>
    </div>
  );
}

function PostingStreak() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.coins().then(w => setSt(w.streak)).catch(e => setError(e.message)); }, []);
  const start = async () => {
    setBusy(true); setError('');
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      setSt((await api.startStreak(tz)).streak);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const active = st?.status === 'active';
  return (
    <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>🔥 {st?.goal || 30}-day posting streak</div>
      <p style={{ fontSize: 13, color: 'var(--text-mid)', margin: '0 0 12px' }}>
        Share a post or a reel every day for {st?.goal || 30} days in a row and earn <b>{st?.reward || 100} CHEX coins</b>. Miss a single day and the streak ends — start again from Day 1. Repeated or copied posts and reels don’t count.
      </p>
      {error && <div className="error-banner" style={{ marginBottom: 10 }}>{error}</div>}
      {!st && !error && <div style={{ fontSize: 13 }}>Loading…</div>}

      {st && active && (
        <>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>Day {Math.min(st.dayNumber, st.goal)} of {st.goal} · {st.done} done</div>
          <div className="streak-dots" role="img" aria-label={`${st.done} of ${st.goal} days done`}>
            {st.marks.map((m, i) => <span key={i} className={`streak-dot ${m}`}>{i + 1}</span>)}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 10 }}>
            {st.todayDone ? '✓ Today is done — see you tomorrow!' : '⏳ Share a post or a reel before the day ends to keep your streak.'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 4 }}>Started {st.startDay} · days follow your device time zone ({st.tz})</div>
        </>
      )}

      {st && !active && (
        <>
          {st.status === 'broken' && <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>💔 Your streak ended — you missed {st.brokenOn} (best: {st.best} {st.best === 1 ? 'day' : 'days'}). Start again from Day 1.</div>}
          {st.status === 'completed' && <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🎉 You finished a {st.goal}-day streak and earned {st.reward} coins! Completed {st.completedRuns}×. Want another round?</div>}
          <button className="btn-primary" style={{ width: 'auto', padding: '10px 22px' }} disabled={busy} onClick={start}>
            {busy ? 'Starting…' : st.status === 'idle' ? '▶ Start streak' : '▶ Start again'}
          </button>
          <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 8 }}>Today becomes Day 1. A post or reel you already shared today counts.</div>
        </>
      )}
    </div>
  );
}

function OnlineStatus() {
  const { user, setUser } = useAuth();
  const [on, setOn] = useState(user.showOnline !== false);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      const res = await api.setShowOnline(!on);
      setOn(res.showOnline);
      setUser(u => ({ ...u, showOnline: res.showOnline }));
    } catch { /* keep the old value */ }
    setBusy(false);
  };
  return (
    <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>Online status</div>
      <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 12 }}>Show a green dot on your picture while you are using CHEX. Turn it off to appear offline to everyone.</p>
      <button className={`btn-ghost${on ? ' sel' : ''}`} style={{ width: 'auto', padding: '9px 18px' }} role="switch" aria-checked={on} disabled={busy} onClick={toggle}>
        <span className="online-pip" style={{ opacity: on ? 1 : 0.3 }} /> {on ? 'Showing when I’m online' : 'Hidden — I appear offline'}
      </button>
    </div>
  );
}

function AccountPrivacy() {
  const { user, setUser } = useAuth();
  const [isPrivate, setIsPrivate] = useState(!!user.isPrivate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choose = async (next) => {
    if (next === isPrivate || busy) return;
    setBusy(true); setError('');
    try {
      const res = await api.setPrivacy(next);
      setIsPrivate(res.isPrivate);
      setUser(u => ({ ...u, isPrivate: res.isPrivate }));
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  return (
    <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>Account privacy</div>
      <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 12 }}>
        {isPrivate
          ? 'Private: only the people you follow can see your followers and following lists.'
          : 'Public: everyone can see your followers and following lists.'}
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }} role="radiogroup" aria-label="Account privacy">
        <button className={`btn-ghost${!isPrivate ? ' sel' : ''}`} style={{ width: 'auto', padding: '9px 18px' }} role="radio" aria-checked={!isPrivate} disabled={busy} onClick={() => choose(false)}>🌍 Public account</button>
        <button className={`btn-ghost${isPrivate ? ' sel' : ''}`} style={{ width: 'auto', padding: '9px 18px' }} role="radio" aria-checked={isPrivate} disabled={busy} onClick={() => choose(true)}>🔒 Private account</button>
      </div>
      {error && <div className="error-banner" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  );
}

function BioAI() {
  const { user, setUser } = useAuth();
  const [bio, setBio] = useState(user.bio || '');
  const [suggestion, setSuggestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('Spanish');

  const run = async (action) => {
    setBusy(true);
    setError('');
    setSuggestion('');
    try {
      const res = await api.bioAI(action, bio, targetLanguage);
      setSuggestion(res.suggestion);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const acceptSuggestion = async () => {
    const res = await api.updateMe({ bio: suggestion });
    setUser(u => ({ ...u, bio: res.user.bio }));
    setBio(suggestion);
    setSuggestion('');
  };

  const saveBio = async () => {
    const res = await api.updateMe({ bio });
    setUser(u => ({ ...u, bio: res.user.bio }));
  };

  return (
    <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>Bio</div>
      <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 10 }}>
        Codex can help write it — needs an ANTHROPIC_API_KEY configured on the server.
      </p>
      <textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={300}
        style={{ width: '100%', minHeight: 70, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 10, padding: 10, color: 'var(--text-hi)', outline: 'none', fontSize: 14, marginBottom: 10, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button className="btn-ghost" disabled={busy} onClick={() => run('write')}>✦ Write</button>
        <button className="btn-ghost" disabled={busy} onClick={() => run('improve')}>✦ Improve</button>
        <button className="btn-ghost" disabled={busy} onClick={() => run('professional')}>✦ Professional</button>
        <button className="btn-ghost" disabled={busy} onClick={() => run('shorter')}>✦ Shorter</button>
        <select value={targetLanguage} onChange={e => setTargetLanguage(e.target.value)} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 8, color: 'var(--text-hi)', fontSize: 12.5 }}>
          {['Spanish', 'French', 'Hindi', 'Tamil', 'Japanese', 'Arabic'].map(l => <option key={l}>{l}</option>)}
        </select>
        <button className="btn-ghost" disabled={busy} onClick={() => run('translate')}>✦ Translate</button>
      </div>
      {busy && <div style={{ fontSize: 13, color: 'var(--text-mid)' }}><span className="loading-dot" /> Thinking…</div>}
      {error && <div className="error-banner">{error}</div>}
      {suggestion && (
        <div className="request-banner" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>{suggestion}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-ghost" onClick={acceptSuggestion}>Use this</button>
            <button className="btn-ghost" onClick={() => setSuggestion('')}>Dismiss</button>
          </div>
        </div>
      )}
      <button className="btn-primary" style={{ width: 'auto', padding: '8px 18px', marginTop: 10 }} onClick={saveBio}>Save bio</button>
    </div>
  );
}

export default function Settings({ onBack, onOpenProfile, onOpenCoins, onOpenStickies, onOpenMyLife }) {
  const { user, clearSession, logout } = useAuth();
  const [setup, setSetup] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');          // 2FA-disable only
  const [deactPassword, setDeactPassword] = useState('');
  const [deactOpen, setDeactOpen] = useState(false);
  const [delPassword, setDelPassword] = useState('');
  const [delConfirm, setDelConfirm] = useState('');
  const [delOpen, setDelOpen] = useState(false);

  const start2FASetup = async () => {
    setError('');
    try { setSetup(await api.setup2FA()); } catch (err) { setError(err.message); }
  };

  const enable2FA = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.enable2FA(totpCode.trim());
      setStatus('Two-factor authentication is now enabled.');
      setSetup(null);
      setTotpCode('');
    } catch (err) { setError(err.message); }
  };

  const disable2FA = async () => {
    setError('');
    try {
      await api.disable2FA(password);
      setStatus('Two-factor authentication disabled.');
      setPassword('');
    } catch (err) { setError(err.message); }
  };

  // TEMPORARY: logging in again with the same username + password brings the account back.
  const deactivate = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.deactivateAccount(deactPassword);
      clearSession();
    } catch (err) { setError(err.message); }
  };

  // PERMANENT: runs only after the password AND the word DELETE are typed and the button is pressed.
  const deleteAccount = async (e) => {
    e.preventDefault();
    setError('');
    if (delConfirm.trim().toUpperCase() !== 'DELETE') { setError('Type DELETE to confirm.'); return; }
    if (!window.confirm('Permanently delete your account and all its data? This cannot be undone.')) return;
    try {
      await api.deleteAccount(delPassword, delConfirm.trim());
      clearSession();
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="page-narrow">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button className="btn-ghost" onClick={onBack}>← Back to profile</button>
        <button className="btn-ghost settings-logout" onClick={logout}>⏻ Log out</button>
      </div>
      <h2 className="page-title">Account Settings</h2>
      {status && <div className="request-banner" style={{ marginBottom: 16 }}>{status}</div>}
      {error && <div className="error-banner">{error}</div>}

      <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>Phone permissions</div>
        <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 14 }}>Notifications, microphone, camera, location and more. Tap Allow to get the phone's own permission box.</p>
        <PermissionsPanel />
      </div>
      <PostingStreak />
      {onOpenMyLife && (
        <div className="glass-card" style={{ padding: 20, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>🔒 Private space</div>
            <div style={{ fontSize: 13, color: 'var(--text-mid)' }}>A password-protected second profile with its own chats, calls, search, followers and a private gallery.</div>
          </div>
          <button className="btn-primary" style={{ width: 'auto', padding: '8px 18px' }} onClick={onOpenMyLife}>Open private space</button>
        </div>
      )}
      <div className="glass-card" style={{ padding: 20, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>📌 Sticky notes &amp; voice reminders</div>
          <div style={{ fontSize: 13, color: 'var(--text-mid)' }}>Jot a note with a time — CHEX reads it out loud when it’s due. Try “remind me to call mom at 5pm” in Codex.</div>
        </div>
        <button className="btn-primary" style={{ width: 'auto', padding: '8px 18px' }} onClick={onOpenStickies}>Open sticky notes</button>
      </div>

      <Appearance onOpenCoins={onOpenCoins} />
      <FloatingAI />
      <EmojiEffects />
      <AccountPrivacy />
      <SafetyLists onOpenProfile={onOpenProfile} />
      <div className="glass-card" style={{ padding: 20, marginBottom: 20 }} data-testid="highlights-card">
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>Story highlights</div>
        <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 4 }}>Keep your best stories on your profile after the 24 hours are up. Tap ＋ to make one, or ✎ to rename, add or remove stories, change the cover, or delete it.</p>
        <HighlightsRow username={user.username} isSelf />
      </div>
      <HistoryPanel />
      <OnlineStatus />

      <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>Two-Factor Authentication</div>
        <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 14 }}>
          Adds a 6-digit authenticator code (TOTP) to login, on top of your password.
        </p>
        {!setup && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-primary" style={{ width: 'auto', padding: '9px 18px' }} onClick={start2FASetup}>Set up 2FA</button>
            <button className="btn-ghost" onClick={disable2FA}>Disable 2FA</button>
          </div>
        )}
        {setup && (
          <form onSubmit={enable2FA}>
            <p style={{ fontSize: 12.5, color: 'var(--text-mid)', wordBreak: 'break-all', marginBottom: 10 }}>
              Add this secret to any authenticator app (Google Authenticator, Authy, etc.): <b>{setup.secret}</b>
            </p>
            <div className="field">
              <label>Enter the 6-digit code it shows</label>
              <input value={totpCode} onChange={e => setTotpCode(e.target.value)} maxLength={6} inputMode="numeric" required />
            </div>
            <button className="btn-primary" style={{ width: 'auto', padding: '9px 18px' }} type="submit">Confirm & enable</button>
          </form>
        )}
        {!setup && (
          <div className="field" style={{ marginTop: 14 }}>
            <label>Password (to disable 2FA)</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Only needed to disable" />
          </div>
        )}
      </div>

      <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>Deactivate account (temporary)</div>
        <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 14 }}>
          Hides your profile and content. Nothing is deleted. Log in again with the same username and password to open the same account.
        </p>
        {!deactOpen ? (
          <button className="btn-ghost" type="button" onClick={() => setDeactOpen(true)}>Deactivate my account…</button>
        ) : (
          <form onSubmit={deactivate} autoComplete="off">
            <div className="field">
              <label>Confirm your password</label>
              <input type="password" name="deactivate-password" autoComplete="new-password" value={deactPassword} onChange={e => setDeactPassword(e.target.value)} required />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost" type="submit">Deactivate</button>
              <button className="btn-ghost" type="button" onClick={() => { setDeactOpen(false); setDeactPassword(''); }}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      <div className="glass-card" style={{ padding: 20 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4, color: 'var(--pink-ink)' }}>Delete account (permanent)</div>
        <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 14 }}>
          Permanently deletes your account, posts, reels, stories and messages right away. This cannot be undone.
          Your account is never deleted unless you complete this form.
        </p>
        {!delOpen ? (
          <button className="btn-ghost" type="button" style={{ color: 'var(--pink-ink)', borderColor: 'rgba(255,92,147,0.35)' }} onClick={() => setDelOpen(true)}>Delete my account…</button>
        ) : (
          <form onSubmit={deleteAccount} autoComplete="off">
            <div className="field">
              <label>Confirm your password</label>
              <input type="password" name="delete-password" autoComplete="new-password" value={delPassword} onChange={e => setDelPassword(e.target.value)} required />
            </div>
            <div className="field">
              <label>Type DELETE to confirm</label>
              <input name="delete-confirm" autoComplete="off" value={delConfirm} onChange={e => setDelConfirm(e.target.value)} required />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost" style={{ color: 'var(--pink-ink)', borderColor: 'rgba(255,92,147,0.35)' }} type="submit">Delete permanently</button>
              <button className="btn-ghost" type="button" onClick={() => { setDelOpen(false); setDelPassword(''); setDelConfirm(''); }}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
