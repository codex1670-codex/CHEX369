// CHEX learn — progress rules. Pure functions: each takes the saved progress object and returns a new one,
// so the React screen stays simple and the rules (hearts, XP, streak, quests) can be unit-tested.
// Rewards are XP and CHEX coins: 1 coin for every finished section (9 levels), paid and verified by the server.
import { LV, PER } from './course.js';

export const HEART_MS = 24 * 60 * 60 * 1000;       // power to play: all 5 hearts refill 24 hours after the first one was lost
export const today = () => new Date().toDateString();

export const newProgress = () => ({
  lang: 'es', pr: {}, min: 0, want: {}, lvl: 0, xp: 0, hearts: 5, ht: Date.now(), streak: 0, last: '', goal: 20,
  q: { xp: 0, les: 0, perf: 0, d: today() }, onb: 1,
});

// Fill in anything missing (older / partial saves) so every screen can trust the shape.
export function normalize(p) {
  const b = newProgress();
  const s = { ...b, ...(p || {}) };
  s.pr = s.pr || {}; s.want = s.want || {}; s.lang = s.lang || 'es';
  s.q = { ...b.q, ...(s.q || {}) };
  delete s.gems; delete s.boost; delete s.freeze; delete s.q.c;     // older saves: the gem economy no longer exists
  return s;
}

// Hearts refill with time and the daily quests reset each new day. Returns the SAME object when nothing changed.
export function regen(s, now = Date.now()) {
  let n = s;
  if (n.hearts < 5 && now - n.ht >= HEART_MS) n = { ...n, hearts: 5, ht: now };
  if (n.q.d !== today()) n = { ...n, q: { xp: 0, les: 0, perf: 0, d: today() } };
  return n;
}

// Milliseconds until the power to play is full again (0 when already full).
export const heartsReturnIn = (s, now = Date.now()) => (s.hearts >= 5 ? 0 : Math.max(0, s.ht + HEART_MS - now));
export const fmtCountdown = (ms) => { const m = Math.ceil(ms / 6e4), h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m` : `${m}m`; };

export const loseHeart = (s, now = Date.now()) => ({ ...s, hearts: Math.max(0, s.hearts - 1), ht: s.hearts === 5 ? now : s.ht });

export const SECTION_LEVELS = PER / 3;     // 9 levels per section (3 sections per stage)
export const sectionOf = (n) => Math.floor(n / SECTION_LEVELS);

// Called once when the last question of a level is answered.
export function finishLevel(s, { n, miss, elapsedMs }, now = Date.now()) {
  const xp = 10 + (miss ? 0 : 5);
  const next = { ...s, q: { ...s.q } };
  next.min = s.min + Math.max(0.5, Math.min(30, elapsedMs / 6e4));
  next.xp = s.xp + xp;
  if (n === s.lvl && s.lvl < LV) next.lvl = s.lvl + 1;
  next.q.xp += xp; next.q.les += 1; if (!miss) next.q.perf += 1;
  if (s.last !== today()) {
    const y = new Date(now - 864e5).toDateString();
    next.streak = s.last === y ? s.streak + 1 : 1;       // yesterday → keep going, otherwise start again
    next.last = today();
  }
  const newStage = next.lvl > 0 && next.lvl % PER === 0 && n + 1 === next.lvl && next.lvl < LV;
  // Finishing the last level of a 9-level section. (The coin itself is paid by the server, once per section.)
  const section = (n + 1) % SECTION_LEVELS === 0 ? (n + 1) / SECTION_LEVELS : 0;
  return { next, xp, newStage, stage: Math.floor((n + 1) / PER), section };
}

export const quests = (s) => [
  { id: 0, title: `Earn ${s.goal} XP (daily goal)`, have: s.q.xp, need: s.goal },
  { id: 1, title: 'Complete 2 levels', have: s.q.les, need: 2 },
  { id: 2, title: 'Finish a perfect level', have: s.q.perf, need: 1 },
];

export const achievements = (s) => [
  ['🌱', 'First level', s.lvl > 0],
  ['🔥', '3-day streak', s.streak >= 3],
  ['⚡', '100 XP', s.xp >= 100],
  ['🧠', 'Finished Easy stage', s.lvl >= PER],
  ['🧩', 'Sentence builder', s.lvl >= PER * 3],
];

export function switchLanguage(s, code) {
  const pr = { ...s.pr, [s.lang]: s.lvl };
  return { ...s, pr, lang: code, lvl: pr[code] || 0 };
}
