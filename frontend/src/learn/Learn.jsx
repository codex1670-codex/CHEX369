import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import Avatar from '../components/Avatar.jsx';
import { CATS, LANGS, LG, LV, PER, SPEECH, STG, genLevel, hasCourse, makeCourse, norm } from './course.js';
import { SECTION_LEVELS, achievements, finishLevel, fmtCountdown, heartsReturnIn, loseHeart, newProgress, normalize, quests, regen, switchLanguage } from './learnState.js';
import CoinLogo from './CoinLogo.jsx';
import Celebration, { Trophy } from './Celebration.jsx';
import { BookLogo, Crown, Gem, Heart, Owl, Scene, Speaker } from './LearnArt.jsx';
import { tiltLeave, tiltMove } from '../ui3d.js';
// The master account has unlimited coins (the server reports the largest safe integer) — show it as ∞.
const showCoins = (n) => (n == null ? '–' : n >= 1e15 ? '∞' : n);

/* ───────── Mascot: the purple CHEX owl ───────── */
const Mascot = ({ size = 90, mood = 'happy' }) => <Owl size={size} mood={mood} />;
const T3 = { onPointerMove: tiltMove, onPointerLeave: tiltLeave };   // 3D tilt toward the pointer (same helper the app's nav uses)

/* ───────── Saved progress: one record per CHEX account, kept on the server ───────── */
function useProgress() {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const idRef = useRef(null), latest = useRef(null), timer = useRef(null), dirty = useRef(false);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (!dirty.current || !idRef.current) return;
    dirty.current = false;
    try { await api.updateLifeItem(idRef.current, latest.current); setError(''); } catch (e) { dirty.current = true; setError(e.message || 'Could not save your progress.'); }
  }, []);

  const take = (item) => { const { id, kind, createdAt, updatedAt, ...data } = item; idRef.current = id; latest.current = regen(normalize(data)); setS(latest.current); };

  const load = useCallback(async () => {
    setError('');
    try {
      const pick = (r) => [...r.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      let mine = pick(await api.lifeItems('learn'));
      if (!mine) {
        try { mine = (await api.addLifeItem('learn', newProgress())).item; }
        catch { mine = pick(await api.lifeItems('learn')); if (!mine) throw new Error('Could not start your course.'); }   // another tab created it first
      }
      take(mine);
    } catch (e) { setError(e.message || 'Could not load CHEX learn.'); }
  }, []);

  // Start the first load once (React StrictMode runs effects twice in development, which would otherwise try to create the record twice).
  const boot = useRef(null);
  useEffect(() => { boot.current = boot.current || load(); }, [load]);

  const update = useCallback((fn) => {
    const next = typeof fn === 'function' ? fn(latest.current) : fn;
    if (!latest.current || next === latest.current) return;
    latest.current = next; setS(next); dirty.current = true;
    clearTimeout(timer.current); timer.current = setTimeout(flush, 600);
  }, [flush]);

  // Hearts come back over time; save when the person leaves the tab or the app.
  useEffect(() => {
    const tick = setInterval(() => { if (latest.current) update(regen(latest.current)); }, 15000);
    const hide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', hide);
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', hide); flush(); };
  }, [update, flush]);

  return { s, error, update, reload: load, flush };
}

/* ───────── Lesson (full screen) ───────── */
const FEEDBACK = ['Great job!', 'Nice work!', 'Correct!', 'Perfect!'];
const freshMatch = () => ({ l: null, r: null, d: [], bad: null });
const BARS = Array.from({ length: 34 }, (_, i) => 10 + Math.round(Math.abs(Math.sin(i * 0.9) * Math.cos(i * 0.33)) * 34));
const tagOf = (q, n) => (q.k === 'mt' ? 'Match' : q.k === 'bk' ? 'Build' : /hear/i.test(q.t) ? 'Listen' : /missing/i.test(q.t) ? 'Fill in' : n < PER ? 'New word' : 'Translate');

function Lesson({ C, n, s, update, onClose, onCoins }) {
  const [Q] = useState(() => genLevel(C, n));
  const [t0] = useState(() => Date.now());
  const [i, setI] = useState(0);
  const [miss, setMiss] = useState(0);
  const [st, setSt] = useState(null);          // null | 'ok' | 'bad'
  const [sel, setSel] = useState(null);
  const [bk, setBk] = useState([]);
  const [m, setM] = useState(freshMatch);
  const [dead, setDead] = useState(false);
  const [result, setResult] = useState(null);
  const [coin, setCoin] = useState(null);      // the server's answer about this level: { recorded, coins, balance }
  const [speaking, setSpeaking] = useState(false);
  const q = Q[i];
  const reset = () => { setSt(null); setSel(null); setBk([]); setM(freshMatch()); };
  const hurt = () => { update(loseHeart); setMiss(x => x + 1); return s.hearts - 1 < 1; };   // true when that was the last heart

  // Read a word aloud; the waveform moves while the voice is speaking.
  const say = useCallback((text) => {
    try {
      const u = new SpeechSynthesisUtterance(text); u.lang = SPEECH[C.code];
      u.onstart = () => setSpeaking(true); u.onend = u.onerror = () => setSpeaking(false);
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch { setSpeaking(true); setTimeout(() => setSpeaking(false), 1200); }
  }, [C.code]);
  useEffect(() => () => { try { speechSynthesis.cancel(); } catch { /* speech not available */ } }, []);

  const check = () => {
    const ok = q.k === 'ch' ? q.o[sel] === q.a : norm(bk.map(x => q.tiles[x]).join(' ')) === norm(q.a);
    setSt(ok ? 'ok' : 'bad');
    if (!ok) hurt();
  };
  const next = () => {
    if (st === 'bad' && s.hearts < 1) { setDead(true); return; }
    if (i + 1 >= Q.length) {                       // last question answered: award XP, streak and unlock the next level once
      const r = finishLevel(s, { n, miss, elapsedMs: Date.now() - t0 });
      update(r.next); setResult(r);
      // The server records the level and pays the section coin; if it can't be reached the level still counts for XP.
      api.learnLevel(C.code, n).then((res) => { setCoin(res); onCoins?.(res.balance); }).catch(() => setCoin({ recorded: false, coins: 0 }));
      return;
    }
    setI(i + 1); reset();
  };

  const canCheck = !st && q && ((q.k === 'ch' && sel !== null) || (q.k === 'bk' && bk.length));
  const press = () => { if (st) next(); else if (canCheck) check(); };

  const tapM = (side, idx) => {
    if (st) return;
    let nm = { ...m, bad: null, [side]: idx };
    if (nm.l !== null && nm.r !== null) {
      if (nm.l === nm.r) nm = { ...nm, d: [...nm.d, nm.l], l: null, r: null };
      else { nm = { ...nm, bad: [nm.l, nm.r], l: null, r: null }; if (hurt()) setDead(true); }
    }
    setM(nm);
    if (nm.d.length === q.p.length) setSt('ok');
  };
  const tile = (idx) => { if (!st) setBk(b => (b.includes(idx) ? b.filter(x => x !== idx) : [...b, idx])); };

  let body;
  if (dead) {
    body = (
      <div className="learn-ls learn-center">
        <div className="lx-owl-big"><Mascot size={130} mood="sad" /></div><h1>You’re out of hearts</h1>
        <p className="life-sub">Your power to play refills in <b>{fmtCountdown(heartsReturnIn(s))}</b> — every 24 hours you get all 5 hearts back. Come back then!</p>
        <p><button type="button" className="lx-btn learn-wide" onClick={onClose}>Back to the course</button></p>
      </div>
    );
  } else if (result) {
    body = (
      <div className="learn-ls learn-center learn-done">
        <Celebration coins={result.section > 0} />
        <div className="lx-owl-big"><Mascot size={120} mood="happy" /></div>
        <Trophy /><h1 className="learn-pop">Level {n + 1} complete!</h1>
        <p className="life-sub">{miss === 0 ? 'Flawless — no mistakes!' : 'Every level makes you stronger.'}</p>
        {result.newStage && <p><b>🎉 New stage unlocked: {STG[result.stage][0]}</b></p>}
        {result.section > 0 && (
          <div className="learn-coinwin" role="status">
            <b>🎉 Section {result.section} complete!</b>
            <div>{!coin ? 'Checking your reward…' : coin.coins > 0 ? <><CoinLogo size={22} spin /> <b>+{coin.coins} CHEX coin</b> added to your wallet</> : coin.reason === 'already' ? 'You already earned the coin for this section.' : coin.reason === 'locked' ? 'This is a Premium language — unlock it in Courses to earn coins.' : 'Finish the earlier levels in order to earn this coin.'}</div>
          </div>
        )}
        <div className="learn-grid learn-stats-pop">
          <div className="learn-stat lx-tilt" {...T3}>⚡ {result.xp}<small>XP earned</small></div>
          <div className="learn-stat lx-tilt" {...T3}>🔥 {result.next.streak}<small>Day streak</small></div>
          <div className="learn-stat lx-tilt" {...T3}>🎯 {miss}<small>Mistakes</small></div>
          <div className="learn-stat lx-tilt" {...T3}>📗 {(n % SECTION_LEVELS) + 1}/{SECTION_LEVELS}<small>Section progress</small></div>
        </div>
        <button type="button" className="lx-btn learn-wide" onClick={onClose}>Continue</button>
      </div>
    );
  } else {
    let b;
    const wordCard = (
      <div className="lx-wordcard lx-tilt" {...T3}>
        <Owl size={84} mood={st === 'bad' ? 'sad' : 'happy'} cap />
        <div className="lx-wordtxt">
          {q.sp ? <button type="button" className="lx-speak" aria-label="Listen" onClick={() => say(q.sp)}><Speaker /></button> : null}
          <span className="lx-word">{q.p}</span>
        </div>
      </div>
    );
    if (q.k === 'ch') {
      b = (
        <>
          {wordCard}
          {q.h && <div className="life-sub learn-hint">{q.h}</div>}
          <div className="lx-opts">
            {q.o.map((o, j) => {
              let c = 'learn-opt';
              if (st && o === q.a) c += ' ok'; else if (sel === j) c += st === 'bad' ? ' bad' : ' sel';
              return <button type="button" key={j} style={{ '--d': `${j * 70}ms` }} className={c} disabled={!!st} onClick={() => setSel(j)}>{o}</button>;
            })}
          </div>
        </>
      );
    } else if (q.k === 'bk') {
      b = (
        <>
          {wordCard}
          <div className="learn-ansln learn-tiles">{bk.map(x => <button type="button" key={x} className="learn-opt" onClick={() => tile(x)}>{q.tiles[x]}</button>)}</div>
          <div className="learn-tiles">{q.tiles.map((t, x) => <button type="button" key={x} style={{ '--d': `${x * 45}ms` }} className={`learn-opt${bk.includes(x) ? ' gone' : ''}`} onClick={() => tile(x)}>{t}</button>)}</div>
        </>
      );
    } else {
      b = (
        <div className="learn-mt">
          <div>{q.p.map((x, idx) => <button type="button" key={idx} style={{ '--d': `${idx * 60}ms` }} className={`learn-opt${m.d.includes(idx) ? ' gone' : ''}${m.l === idx ? ' sel' : ''}${m.bad && m.bad[0] === idx ? ' bad' : ''}`} onClick={() => { tapM('l', idx); say(x[0]); }}>{x[0]}</button>)}</div>
          <div>{q.r.map((idx, j) => <button type="button" key={idx} style={{ '--d': `${j * 60 + 30}ms` }} className={`learn-opt${m.d.includes(idx) ? ' gone' : ''}${m.r === idx ? ' sel' : ''}${m.bad && m.bad[1] === idx ? ' bad' : ''}`} onClick={() => tapM('r', idx)}>{q.p[idx][1]}</button>)}</div>
        </div>
      );
    }
    const pct = Math.round((i / Q.length) * 100);
    const listen = q.sp ? (
      <button type="button" className={`lx-wave${speaking ? ' on' : ''}`} onClick={() => say(q.sp)} aria-label="Listen again">
        <span className="lx-bars" aria-hidden="true">{BARS.map((h, x) => <i key={x} style={{ height: h, '--bd': `${(x % 9) * 70}ms` }} />)}</span>
        <small className="lx-wave-lbl"><span>{speaking ? 'Speaking…' : 'Tap to listen'}</span><span>(optional)</span></small>
      </button>
    ) : null;
    let foot;
    if (st === 'ok') foot = <div className="learn-foot ok"><div><Owl size={58} mood="cheer" /><b className="learn-grow ok-t">{FEEDBACK[i % 4]}</b><button type="button" className="lx-check" onClick={next}>Continue</button></div></div>;
    else if (st === 'bad') foot = <div className="learn-foot bad"><div><Owl size={58} mood="sad" /><div className="learn-grow"><b className="bad-t">Correct answer:</b><br />{q.a}</div><button type="button" className="lx-check bad" onClick={next}>Continue</button></div></div>;
    else foot = <div className="learn-foot"><div><button type="button" className={`lx-check${canCheck ? ' ready' : ''}`} disabled={q.k === 'mt' || !canCheck} onClick={press}>Check</button></div></div>;
    body = (
      <>
        <div className="learn-ls">
          <div className="learn-lh">
            <button type="button" className="learn-x" aria-label="Quit lesson" onClick={onClose}>✕</button>
            <div className="lx-progress">
              <div className="learn-bar learn-grow" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Lesson progress"><i style={{ width: `${Math.max(pct, 4)}%` }} /></div>
              <small>{Math.min(i + 1, Q.length)}/{Q.length}</small>
            </div>
            <span className="learn-pill lx-hearts"><Heart size={22} /> {s.hearts}</span>
          </div>
          <div key={i} className="lx-qwrap">
            <span className="lx-tag"><i aria-hidden="true" />{tagOf(q, n)}</span>
            <h3 className="learn-q">{q.k === 'mt' ? 'Tap the matching pairs' : q.t}</h3>
            {b}
            {listen}
          </div>
        </div>
        {foot}
      </>
    );
  }
  return createPortal(<div className="learn learn-lesson" role="dialog" aria-modal="true" aria-label="Lesson">{body}</div>, document.body);
}

/* ───────── Screens ───────── */
const STAGE_TONE = ['sn-mint', 'sn-blue', 'sn-lilac', 'sn-orange'];
const STAGE_ICON = ['🍎', '💬', '✍️', '🧩'];
const jump = (id) => document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });

function Onboard({ update }) {
  return (
    <div className="lx-card learn-card">
      <div className="learn-center"><Mascot size={80} /><h3>Pick your daily goal</h3><p className="life-sub">You can change it later in My progress.</p></div>
      {[[10, 'Casual', '10 XP a day'], [20, 'Regular', '20 XP a day'], [50, 'Serious', '50 XP a day']].map(g => (
        <button type="button" key={g[0]} className="learn-opt" onClick={() => update(p => ({ ...p, goal: g[0], onb: 0 }))}><b>{g[1]}</b> <span className="life-sub">· {g[2]}</span></button>
      ))}
    </div>
  );
}

/* Home: the owl welcome, the four stages, your progress, daily quest, achievements, then the full level path below. */
function Home({ s, start, update, go }) {
  const lang = LG(s.lang), cur = Math.min(s.lvl, LV - 1);
  const pct = Math.round((s.lvl / LV) * 100);
  const qs = quests(s), quest = qs.find(x => x.have < x.need) || qs[0];
  const qp = Math.min(100, (quest.have / quest.need) * 100);
  const badges = achievements(s).filter(x => x[2]).length;
  return (
    <>
      {s.onb ? <Onboard update={update} /> : null}
      <div className="lx-hero">
        <Scene />
        <div className="lx-bubble lx-tilt" {...T3}>
          <h2>¡Hola! <span className="lx-wave-hand" aria-hidden="true">👋</span></h2>
          <p>{s.lvl > 0 ? `Level ${cur + 1} of your ${lang[1]} course is ready.` : 'Ready to learn something new today?'}</p>
          <button type="button" className="lx-btn lx-start" onClick={() => start(cur)}><span aria-hidden="true">▶</span> Start Lesson</button>
        </div>
        <div className="lx-hero-owl"><Owl size={250} cap /></div>
      </div>

      <div className="lx-card learn-card lx-pathcard">
        <div className="learn-rowx"><h3 className="learn-h learn-grow">Your Learning Path</h3><button type="button" className="lx-link" onClick={() => jump('learn-path')}>See all <span aria-hidden="true">→</span></button></div>
        <div className="lx-stages">
          {STG.map((g, idx) => {
            const open = s.lvl >= idx * PER, now = idx === Math.floor(cur / PER);
            return (
              <button type="button" key={g[0]} disabled={!open} className={`lx-stage lx-tilt ${open ? 'open' : 'locked'}${now ? ' now' : ''}`} {...T3} onClick={() => jump(`learn-sec-${idx * 3}`)} aria-label={`Stage ${idx + 1}, ${g[0]}${open ? '' : ', locked'}`}>
                {now && <span className="lx-stage-star" aria-hidden="true">⭐</span>}
                {!open && <span className="lx-stage-lock" aria-hidden="true">🔒</span>}
                <span className="lx-stage-ico" aria-hidden="true">{STAGE_ICON[idx]}</span>
                <small>Stage {idx + 1}</small><b>{g[0]}</b>
              </button>
            );
          })}
        </div>
      </div>

      <div className="lx-trio">
        <div className="lx-card learn-card lx-tilt" {...T3}>
          <h3 className="learn-h">Your Progress</h3>
          <div className="learn-rowx">
            <div className="lx-ring" style={{ '--p': pct }} role="img" aria-label={`${pct}% of the course`}><b>{pct}%</b></div>
            <div className="learn-grow"><b className="lx-big">{s.lvl} / {LV}</b><div className="life-sub">Lessons</div></div>
          </div>
          <button type="button" className="lx-btn sm" onClick={() => go('me')}>View Details <span aria-hidden="true">→</span></button>
        </div>
        <div className="lx-card learn-card lx-tilt" {...T3}>
          <h3 className="learn-h">🎯 Daily Quest</h3>
          <div className="lx-quest">
            <b>{quest.title}</b>
            <div className="learn-rowx"><div className="learn-bar learn-grow"><i style={{ width: `${qp}%` }} /></div><span className="lx-gift" aria-hidden="true">🎁</span></div>
            <small className="life-sub">{Math.min(quest.have, quest.need)} / {quest.need}</small>
          </div>
          <button type="button" className="lx-btn sm" onClick={() => go('quests')}>All quests <span aria-hidden="true">→</span></button>
        </div>
        <div className="lx-card learn-card lx-tilt" {...T3}>
          <h3 className="learn-h">🏅 Achievements</h3>
          <div className="learn-rowx"><span className="lx-medals" aria-hidden="true"><i>🥇</i><i>🏅</i><i>🎖️</i></span><div className="learn-grow"><div className="life-sub">You’ve earned</div><b className="lx-big">{badges} {badges === 1 ? 'badge' : 'badges'}!</b></div></div>
          <button type="button" className="lx-btn sm" onClick={() => go('me')}>View All <span aria-hidden="true">→</span></button>
        </div>
      </div>

      <div className="lx-premium lx-tilt" {...T3}>
        <Crown size={64} />
        <div className="learn-grow"><b>CHEX Learn Premium</b><small>Finish 100 levels, then unlock another language for 100 CHEX coins.</small></div>
        <button type="button" className="lx-btn gold" onClick={() => go('langs')}>Go Premium <span aria-hidden="true">→</span></button>
      </div>

      <h3 className="learn-h lx-sect">Your level path</h3>
      <Path s={s} start={start} />
    </>
  );
}

function Path({ s, start }) {
  const lang = LG(s.lang);
  const cat = CATS[lang[3]], hrs = s.min / 60;
  const out = [];
  for (let n = 0; n < LV; n++) {
    const sg = STG[Math.floor(n / PER)];
    if (n % SECTION_LEVELS === 0) {
      const done = s.lvl >= n + SECTION_LEVELS;
      out.push(<div key={`b${n}`} id={`learn-sec-${n / SECTION_LEVELS}`} className={`learn-ban ${STAGE_TONE[Math.floor(n / PER)]}`}><div><small>Section {n / SECTION_LEVELS + 1} · {sg[0]}</small><b>{sg[1]}</b></div><span className="learn-ban-coin" title="Finish this section to earn 1 CHEX coin">{done ? '✅' : <><CoinLogo size={16} /> +1</>}</span></div>);
    }
    const state = n < s.lvl ? 'done' : n === s.lvl ? 'act' : 'lock';
    const off = [0, -40, -60, -40, 0, 40, 60, 40][n % 8];
    out.push(
      <div key={n} className="learn-pathrow" style={{ transform: `translateX(${off}px)` }}>
        <button type="button" id={state === 'act' ? 'learn-act' : undefined} className={`learn-node ${state}`} disabled={state === 'lock'} aria-label={`Level ${n + 1}${state === 'lock' ? ', locked' : state === 'done' ? ', completed' : ', start'}`} onClick={() => start(n)}>
          <span className="learn-node-face">{state === 'lock' ? '🔒' : n + 1}</span>
          {state === 'done' && <span className="learn-node-star" aria-hidden="true">★</span>}
          {state === 'act' && <><span className="learn-bub">START</span><span className="learn-node-owl" aria-hidden="true"><Owl size={46} cap /></span></>}
        </button>
      </div>,
    );
  }
  useEffect(() => { if (s.lvl > 0) document.getElementById('learn-act')?.scrollIntoView?.({ block: 'center' }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="lx-card learn-card">
        <div className="learn-rowx"><b className="learn-grow">{lang[1]} course</b><span className="life-sub">Level {Math.min(s.lvl + 1, LV)} of {LV}</span></div>
        <div className="learn-bar" style={{ marginTop: 8 }}><i style={{ width: `${(s.lvl / LV) * 100}%` }} /></div>
      </div>
      <div className="lx-card learn-card">
        <b>{cat[0]}</b>
        <div className="life-sub" style={{ margin: '4px 0 8px' }}>Typical time to professional working proficiency: {cat[1]}. These {LV} levels build your foundation.</div>
        <div className="learn-bar"><i style={{ width: `${Math.min(100, (hrs / cat[2]) * 100)}%` }} /></div>
        <div className="life-sub" style={{ marginTop: 6 }}>You’ve studied {hrs.toFixed(1)} h of about {cat[2].toLocaleString()} h</div>
      </div>
      <div id="learn-path" className="learn-path">{out}</div>
      <div className="lx-card learn-card learn-center">{s.lvl >= LV ? '🏆 You completed the whole course!' : `🏆 Finish all ${LV} levels to complete ${lang[1]}.`}</div>
    </>
  );
}

/* First visit: choose the one free language. Every other language is Premium. */
function FirstLanguage({ onPick, busy, error }) {
  const [pick, setPick] = useState(null);
  const chosen = pick && LG(pick);
  return (
    <div className="lx-card learn-card lx-firstlang">
      <div className="learn-center">
        <Mascot size={90} />
        <h2>Choose your first language</h2>
        <p className="life-sub">Pick one language to learn for free. All the other languages become <b>Premium</b> — finish 100 levels, then unlock another one for 100 CHEX coins.</p>
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="lx-firstgrid" role="radiogroup" aria-label="First language">
        {LANGS.filter(l => hasCourse(l[0])).map(l => (
          <button type="button" key={l[0]} role="radio" aria-checked={pick === l[0]} disabled={busy} className={`learn-opt${pick === l[0] ? ' sel' : ''}`} onClick={() => setPick(l[0])}>
            <span className="learn-flag" aria-hidden="true">{l[2]}</span><b>{l[1]}</b>
          </button>
        ))}
      </div>
      <button type="button" className="lx-btn learn-wide" disabled={!pick || busy} onClick={() => onPick(pick)}>{chosen ? `Start learning ${chosen[1]}` : 'Pick a language'}</button>
      <p className="life-sub learn-center" style={{ marginTop: 10 }}>Your free language can’t be swapped later, so choose the one you want most.</p>
    </div>
  );
}

function Languages({ s, update, info, coins, onUnlock, busy, error }) {
  const owned = info.owned, price = info.price, need = info.unlockLevels;
  const doing = owned.filter(l => (info.completed[l] || 0) < need);
  return (
    <>
      <h3 className="learn-h">Choose a language</h3>
      <p className="life-sub">Study-time estimates are for reaching professional working proficiency.</p>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="lx-card learn-card lx-premnote">
        {info.canUnlock
          ? <><b>🎉 You finished {need} levels!</b><div className="life-sub">Unlock one more language for <CoinLogo size={16} /> <b>{price} CHEX coins</b>. You have <b>{showCoins(coins)}</b>.</div></>
          : <>
              <b>👑 Premium languages</b>
              <div className="life-sub">Finish {need} levels, then unlock another language with {price} CHEX coins.</div>
              {doing.map(l => { const n = Math.min(need, info.completed[l] || 0); return (
                <div key={l} style={{ marginTop: 8 }}>
                  <div className="learn-rowx"><span className="learn-flag" aria-hidden="true">{LG(l)[2]}</span><b className="learn-grow">{LG(l)[1]}</b><span className="life-sub">{n}/{need} levels</span></div>
                  <div className="learn-bar" style={{ marginTop: 6 }}><i style={{ width: `${(n / need) * 100}%` }} /></div>
                </div>); })}
            </>}
      </div>
      {CATS.map((c, ci) => (
        <div key={c[0]} className="lx-card learn-card">
          <b>{c[0]}</b><div className="life-sub" style={{ margin: '2px 0 10px' }}>{c[1]} of study</div>
          {LANGS.filter(l => l[3] === ci).map(l => {
            const mine = owned.includes(l[0]);
            return (
              <div key={l[0]} className={`learn-rowx lx-langrow${mine ? '' : ' locked'}`} style={{ marginBottom: 8 }}>
                <span className="learn-flag" aria-hidden="true">{l[2]}</span>
                <span className="learn-grow"><b>{l[1]}</b>{!mine && <span className="lx-premtag">👑 Premium</span>}{mine && <small className="life-sub lx-lvcount"> {info.completed[l[0]] || 0}/{LV} levels</small>}</span>
                {mine
                  ? <button type="button" className={`lx-btn sm${s.lang === l[0] ? ' ghost' : ''}`} disabled={s.lang === l[0]} onClick={() => update(p => switchLanguage(p, l[0]))}>{s.lang === l[0] ? 'Current' : 'Learn'}</button>
                  : info.canUnlock
                    ? <button type="button" className="lx-btn sm gold" disabled={busy || (coins ?? 0) < price} onClick={() => onUnlock(l[0])}>{(coins ?? 0) < price ? `Need ${price} coins` : <>Unlock · <CoinLogo size={14} /> {price}</>}</button>
                    : <button type="button" className="lx-btn sm ghost" disabled aria-label={`${l[1]} is locked until you finish ${need} levels`}>🔒 Locked</button>}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

function Practice({ s, start }) {
  return (
    <>
      <h3 className="learn-h">Practice</h3>
      <div className="lx-card learn-card learn-rowx"><Mascot size={64} /><div className="learn-grow"><b>Replay any unlocked level</b><div className="life-sub">Pick a level to review it and earn XP.</div></div></div>
      <div className="learn-grid">{Array.from({ length: Math.max(1, s.lvl) }, (_, i) => <button type="button" key={i} className="lx-btn ghost" onClick={() => start(i)}>Level {i + 1}</button>)}</div>
    </>
  );
}

function Ranks({ s }) {
  const [board, setBoard] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.learnBoard().then(r => setBoard(r.board)).catch(e => setErr(e.message)); }, []);
  // Your own row always shows your live XP, even if the last save is still on its way.
  const rows = (board || []).map(r => (r.me ? { ...r, xp: s.xp, streak: s.streak } : r)).sort((a, b) => b.xp - a.xp);
  return (
    <>
      <h3 className="learn-h">Leaderboard</h3>
      <p className="life-sub">You and the people you follow on CHEX, ranked by total XP.</p>
      {err && <div className="error-banner" role="alert">{err}</div>}
      {!board && !err && <div className="lx-card life-empty">Loading…</div>}
      {board && rows.length < 2 && <div className="lx-card learn-card life-sub">You’re the only learner here so far. Follow friends on CHEX to compete with them.</div>}
      {rows.map((r, i) => (
        <div key={r.user.id} className={`lx-card learn-card learn-rowx learn-rank lx-tilt${r.me ? ' you' : ''}`} {...T3}>
          <b className="learn-rk">{['🥇', '🥈', '🥉'][i] || i + 1}</b>
          <Avatar user={r.user} size={40} showPresence={false} />
          <div className="learn-grow"><b>{r.user.displayName}</b><div className="life-sub">@{r.user.username} · 🔥 {r.streak}</div></div>
          <b>{r.xp} XP</b>
        </div>
      ))}
    </>
  );
}

function Quests({ s }) {
  return (
    <>
      <h3 className="learn-h">Daily quests</h3>
      <p className="life-sub">Fresh goals every day to keep your streak going.</p>
      {quests(s).map(x => {
        const p = Math.min(100, (x.have / x.need) * 100);
        return (
          <div key={x.id} className="lx-card learn-card lx-tilt" {...T3}>
            <div className="learn-rowx"><b className="learn-grow">{x.title}</b>{p >= 100 ? <span aria-label="Done">✅</span> : <span className="lx-gift" aria-hidden="true">🎁</span>}</div>
            <div className="learn-bar" style={{ marginTop: 10 }}><i style={{ width: `${p}%` }} /></div>
            <div className="life-sub" style={{ marginTop: 6 }}>{Math.min(x.have, x.need)} / {x.need}</div>
          </div>
        );
      })}
    </>
  );
}

function Progress({ s, update, user, onOpenProfile, coins }) {
  return (
    <>
      <div className="learn-center learn-me">
        {user ? <Avatar user={user} size={90} showPresence={false} /> : <Mascot size={90} />}
        <h3>{user?.displayName || 'Learner'}</h3>
        {user?.username && <p className="life-sub">@{user.username}</p>}
        {onOpenProfile && user?.username && <button type="button" className="lx-btn sm ghost" onClick={() => onOpenProfile(user.username)}>View my CHEX profile</button>}
      </div>
      <div className="learn-grid">
        <div className="learn-stat lx-tilt" {...T3}>🔥 {s.streak}<small>Day streak</small></div>
        <div className="learn-stat lx-tilt" {...T3}>⚡ {s.xp}<small>Total XP</small></div>
        <div className="learn-stat lx-tilt" {...T3}><CoinLogo size={24} /> {showCoins(coins)}<small>CHEX coins</small></div>
        <div className="learn-stat lx-tilt" {...T3}>📘 {s.lvl}/{LV}<small>Levels done</small></div>
        <div className="learn-stat lx-tilt" {...T3}>⏱️ {(s.min / 60).toFixed(1)} h<small>Time studied</small></div>
        <div className="learn-stat lx-tilt" {...T3}>🎯 {s.goal} XP<small>Daily goal</small></div>
      </div>
      <h3 className="learn-h" style={{ marginTop: 20 }}>Daily goal</h3>
      <div className="life-form" style={{ padding: 0 }}>
        <select aria-label="Daily goal" value={s.goal} onChange={e => update(p => ({ ...p, goal: Number(e.target.value) }))}>
          {[[10, 'Casual · 10 XP'], [20, 'Regular · 20 XP'], [50, 'Serious · 50 XP']].map(g => <option key={g[0]} value={g[0]}>{g[1]}</option>)}
        </select>
      </div>
      <h3 className="learn-h">Achievements</h3>
      {achievements(s).map(x => (
        <div key={x[1]} className={`lx-card learn-card learn-rowx lx-tilt${x[2] ? '' : ' dim'}`} {...T3}><span className="learn-big" aria-hidden="true">{x[0]}</span><b className="learn-grow">{x[1]}</b><span>{x[2] ? 'Unlocked' : 'Locked'}</span></div>
      ))}
    </>
  );
}

/* ───────── CHEX learn hub ───────── */
const VIEWS = [['learn', '🏠', 'Home'], ['langs', '🌐', 'Courses'], ['practice', '🏋️', 'Practice'], ['quests', '🏆', 'Quests'], ['ranks', '📊', 'Leaderboard'], ['me', '🏅', 'My progress']];

export default function Learn({ onOpenProfile }) {
  const auth = useAuth();
  const user = auth?.user || null;
  const { s, error, update, reload } = useProgress();
  const [view, setView] = useState('learn');
  const [lesson, setLesson] = useState(null);
  const [coins, setCoins] = useState(null);       // the person's CHEX coin balance (their real wallet)
  const [notice, setNotice] = useState('');
  useEffect(() => { api.coins().then(r => setCoins(r.balance)).catch(() => {}); }, []);
  const [info, setInfo] = useState(null);          // which languages the person owns (first one free, the rest Premium) + levels done in each
  const [langErr, setLangErr] = useState('');
  const [busy, setBusy] = useState(false);
  const loadInfo = useCallback(() => api.learnLanguages().then(r => { setInfo(r); setLangErr(''); }).catch(e => setLangErr(e.message || 'Could not load your languages.')), []);
  useEffect(() => { loadInfo(); }, [loadInfo]);
  // If the saved course language isn't one this person owns (older saves default to Spanish), move them to one they own.
  useEffect(() => { if (s && info?.chosen && !info.owned.includes(s.lang)) update(p => switchLanguage(p, info.owned[0])); }, [info, s?.lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const C = useMemo(() => (s ? makeCourse(s.lang) : null), [s?.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) {
    return error
      ? <div className="lx-card life-empty learn" role="alert">{error} <button type="button" className="lx-btn sm ghost" onClick={reload}>Try again</button></div>
      : <div className="lx-card life-empty learn"><Owl size={70} /> Loading…</div>;
  }
  const chooseFirst = async (code) => {
    setBusy(true); setLangErr('');
    try { const r = await api.learnChooseLanguage(code); setInfo(r); update(p => switchLanguage(p, code)); setView('learn'); }
    catch (e) { setLangErr(e.message || 'Could not save your language.'); }
    setBusy(false);
  };
  const unlockLang = async (code) => {
    setBusy(true); setLangErr('');
    try { const r = await api.learnUnlockLanguage(code); setInfo(r); setCoins(r.balance); update(p => switchLanguage(p, code)); setView('learn'); }
    catch (e) { setLangErr(e.message || 'Could not unlock this language.'); loadInfo(); }
    setBusy(false);
  };
  const start = (n) => {
    if (!info?.owned.includes(s.lang)) { setView('langs'); return; }
    const cur = regen(s);
    if (cur !== s) update(cur);
    if (cur.hearts < 1) { setNotice(`You’re out of hearts. Your power to play refills in ${fmtCountdown(heartsReturnIn(cur))}.`); return; }
    setNotice('');
    setLesson({ n, key: Date.now() });
  };
  const go = (v) => { setView(v); };
  const lang = LG(s.lang);
  const level = 1 + Math.floor(s.xp / 100);
  const views = { learn: <Home s={s} start={start} update={update} go={go} />, langs: info && <Languages s={s} update={update} info={info} coins={coins} onUnlock={unlockLang} busy={busy} error={langErr} />, practice: <Practice s={s} start={start} />, ranks: <Ranks s={s} />, quests: <Quests s={s} />, me: <Progress s={s} update={update} user={user} onOpenProfile={onOpenProfile} coins={coins} /> }[view];
  const panel = !info
    ? (langErr ? <div className="lx-card life-empty" role="alert">{langErr} <button type="button" className="lx-btn sm ghost" onClick={loadInfo}>Try again</button></div> : <div className="lx-card life-empty"><Owl size={70} /> Loading…</div>)
    : !info.chosen ? <FirstLanguage onPick={chooseFirst} busy={busy} error={langErr} /> : views;

  return (
    <section className="learn lx" aria-label="CHEX learn">
      <aside className="lx-side">
        <div className="lx-logo"><BookLogo size={46} /><b>CHEX<span>Learn</span></b></div>
        <nav className="lx-nav" role="tablist" aria-label="CHEX learn sections">
          {VIEWS.map(([k, ico, label]) => <button type="button" key={k} role="tab" aria-selected={view === k} className={`lx-navbtn${view === k ? ' on' : ''}`} onClick={() => go(k)}><span className="lx-navico" aria-hidden="true">{ico}</span><span>{label}</span></button>)}
        </nav>
        <button type="button" className="lx-me lx-tilt" {...T3} onClick={() => go('me')}>
          {user ? <Avatar user={user} size={42} showPresence={false} /> : <Owl size={42} cap={false} />}
          <span className="learn-grow"><b>CHEX Star</b><span className="lx-lv">👑 Lv.{level}</span></span><span aria-hidden="true">›</span>
        </button>
      </aside>

      <main className="lx-main">
        <div className="lx-top" aria-label="Your stats">
          <span className="lx-stat"><span className="lx-flame" aria-hidden="true">🔥</span><span><b>{s.streak}</b><small>Day Streak</small></span></span>
          <span className="lx-stat"><Gem size={34} /><span><b>{s.xp.toLocaleString()}</b><small>XP</small></span></span>
          <span className="lx-stat lx-coin" title="Your CHEX coins"><CoinLogo size={30} spin /><span><b>{showCoins(coins)}</b><small>Coins</small></span></span>
          <button type="button" className="lx-stat lx-langpill" onClick={() => go('langs')} title="Change language"><span className="learn-flag" aria-hidden="true">{lang[2]}</span><span><b>{lang[1]}</b><small>Course</small></span></button>
          <span className="lx-stat lx-hearts-row" aria-label={`${s.hearts} of 5 hearts`}>{Array.from({ length: 5 }, (_, h) => <span key={h} className={h < s.hearts ? 'on' : 'off'}><Heart size={24} /></span>)}<b>{s.hearts >= 5 ? 'Full' : `${s.hearts}/5`}</b></span>
        </div>
        {s.hearts < 5 && <div className="learn-power" role="status">⚡ Power to play: {s.hearts}/5 · full again in <b>{fmtCountdown(heartsReturnIn(s))}</b></div>}
        {error && <div className="error-banner" role="alert">{error}</div>}
        {notice && <div className="lx-card learn-card" role="status">❤️ {notice}</div>}
        <div key={view} className="lx-panel">{panel}</div>
      </main>
      {lesson && <Lesson key={lesson.key} C={C} n={lesson.n} s={s} update={update} onClose={() => setLesson(null)} onCoins={(b) => { setCoins(b); loadInfo(); }} />}
    </section>
  );
}
