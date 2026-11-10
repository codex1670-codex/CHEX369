// CHEX Coins: wallet, monthly reward and the store. All rules live in COIN_RULES / STORE_ITEMS.
import db from './db.js';
import { captionHash, normCaption, mediaHashSync, mediaHashAsync } from './contentHash.js';

export const COIN_RULES = {
  monthlyPublicPostGoal: 30,   // public posts in one calendar month (UTC) ...
  monthlyReward: 100,          // ... earn this many CHEX coins, once per month
  gameWinReward: 1,            // CHEX coins for every game you win ...
  gameWinDailyCap: 20,         // ... up to this many wins a day (stops two-account farming)
  streakDays: 30,              // post or share a reel every day for this many days in a row ...
  streakReward: 100,           // ... and earn this many coins (a missed day restarts it)
  learnSectionReward: 1,       // CHEX coins for finishing one CHEX learn section (9 levels) ...
  learnSectionLevels: 9,       // ... of a language; each section pays once per language
  learnUnlockLevels: 100,      // finish this many levels of your language(s) ...
  learnUnlockPrice: 100,       // ... then pay this many CHEX coins to unlock one more language (the first is free)
  learnMinLevelSeconds: 10,    // a level can't be recorded sooner than this after the previous one
  copiedCaptionMinLength: 25,  // a text post only counts as 'copied from someone' when it is this long
};

export const STORE_ITEMS = [
  { id: 'premium-themes', name: 'Premium Themes & Animations', price: 1000,
    description: 'Unlocks all 9 animated premium themes — Amber Noir, Teal Slate, Aurora, Obsidian Gold, Neon Noir, Emerald Velvet, Sunset Glass, Rose Quartz and Ocean Pearl.' },
  { id: 'premium-frames', name: 'Premium Profile Frames', price: 2000,
    description: 'Unlocks all 12 animated profile frames — Golden Halo, Aurora Spin, Neon Pulse, Royal Crown, Emerald Flame, Rainbow Orbit, Diamond Sparkle, Inferno, Ocean Wave, Cherry Blossom, Cyber Glitch and Galaxy Orbit. Your frame shows around your photo everywhere on CHEX.' },
];

// Animated profile frames (the artwork lives in frontend/src/profileFrames.js + frames.css).
export const PROFILE_FRAMES = ['golden', 'aurora', 'neon', 'crown', 'emerald', 'rainbow', 'diamond', 'inferno', 'ocean', 'blossom', 'glitch', 'galaxy'];

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

// The master account ("sanjiv", see admin.js) has unlimited coins and owns every store item.
// Its "balance" is the largest safe integer, and the UI shows ∞ for it (coinsSummary().unlimited).
export const UNLIMITED_BALANCE = Number.MAX_SAFE_INTEGER;
const isMasterId = (userId) => !!db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'master'").get(userId);

export const getBalance = (userId) =>
  isMasterId(userId) ? UNLIMITED_BALANCE
    : db.prepare('SELECT COALESCE(SUM(amount), 0) AS b FROM coin_ledger WHERE user_id = ?').get(userId).b;

export const publicPostsInMonth = (userId, mk = monthKey()) =>
  db.prepare("SELECT COUNT(*) AS c FROM posts WHERE user_id = ? AND audience = 'public' AND deleted_at IS NULL AND coin_eligible = 1 AND substr(created_at, 1, 7) = ?").get(userId, mk).c;

// Called after a public post is created / made public. Returns the coins awarded (0 if none).
export function awardMonthlyIfEarned(userId) {
  const mk = monthKey();
  if (publicPostsInMonth(userId, mk) < COIN_RULES.monthlyPublicPostGoal) return 0;
  const r = db.prepare("INSERT OR IGNORE INTO coin_ledger (user_id, amount, reason, ref) VALUES (?, ?, ?, ?)")
    .run(userId, COIN_RULES.monthlyReward, `${COIN_RULES.monthlyPublicPostGoal} public posts in ${mk}`, `monthly-public-posts:${mk}`);
  return r.changes ? COIN_RULES.monthlyReward : 0;
}

// Never let a coin problem break posting.
export function safeAward(userId) {
  try { return awardMonthlyIfEarned(userId); } catch (e) { console.error('coin award failed', e); return 0; }
}

export const ownedItems = (userId) =>
  isMasterId(userId) ? STORE_ITEMS.map(i => i.id)
    : db.prepare('SELECT item_id FROM coin_unlocks WHERE user_id = ?').all(userId).map(r => r.item_id);

export function unlockItem(userId, itemId) {
  const item = STORE_ITEMS.find(i => i.id === itemId);
  if (!item) return { error: { status: 400, code: 'UNKNOWN_ITEM', message: 'That item is not in the store.' } };
  const tx = db.transaction(() => {
    if (isMasterId(userId) || db.prepare('SELECT 1 FROM coin_unlocks WHERE user_id = ? AND item_id = ?').get(userId, itemId)) {
      return { error: { status: 409, code: 'ALREADY_OWNED', message: 'You already unlocked this.' } };
    }
    const balance = getBalance(userId);
    if (balance < item.price) {
      return { error: { status: 402, code: 'NOT_ENOUGH_COINS', message: `You need ${item.price - balance} more CHEX coins.` } };
    }
    db.prepare('INSERT INTO coin_ledger (user_id, amount, reason, ref) VALUES (?, ?, ?, ?)').run(userId, -item.price, `Unlocked ${item.name}`, `unlock:${itemId}`);
    db.prepare('INSERT INTO coin_unlocks (user_id, item_id, price) VALUES (?, ?, ?)').run(userId, itemId, item.price);
    return { ok: true };
  });
  return tx.immediate();
}

// Pick (or remove, with null) the frame shown around your avatar. Needs the frames unlock.
export function setFrame(userId, frame) {
  if (frame !== null && !PROFILE_FRAMES.includes(frame)) return { error: { status: 400, code: 'UNKNOWN_FRAME', message: 'That frame does not exist.' } };
  if (frame !== null && !ownedItems(userId).includes('premium-frames')) {
    return { error: { status: 403, code: 'FRAMES_LOCKED', message: 'Unlock Premium Profile Frames in the CHEX Coins store first.' } };
  }
  db.prepare('UPDATE users SET profile_frame = ? WHERE id = ?').run(frame, userId);
  return { ok: true };
}

export function coinsSummary(userId) {
  const mk = monthKey();
  const owned = new Set(ownedItems(userId));
  const count = publicPostsInMonth(userId, mk);
  const claimed = !!db.prepare('SELECT 1 FROM coin_ledger WHERE user_id = ? AND ref = ?').get(userId, `monthly-public-posts:${mk}`);
  return {
    balance: getBalance(userId),
    unlimited: isMasterId(userId),
    unlocked: [...owned],
    frame: db.prepare('SELECT profile_frame AS f FROM users WHERE id = ?').get(userId)?.f || null,
    learn: { reward: COIN_RULES.learnSectionReward, levels: COIN_RULES.learnSectionLevels, unlockLevels: COIN_RULES.learnUnlockLevels, unlockPrice: COIN_RULES.learnUnlockPrice },
    game: { reward: COIN_RULES.gameWinReward, dailyCap: COIN_RULES.gameWinDailyCap, today: db.prepare("SELECT COUNT(*) AS c FROM coin_ledger WHERE user_id = ? AND ref LIKE 'game-win:%' AND substr(created_at, 1, 10) = ?").get(userId, new Date().toISOString().slice(0, 10)).c },
    streak: streakSummary(userId),
    monthly: { month: mk, count, goal: COIN_RULES.monthlyPublicPostGoal, reward: COIN_RULES.monthlyReward, claimed },
    items: STORE_ITEMS.map(i => ({ ...i, owned: owned.has(i.id) })),
    history: db.prepare('SELECT id, amount, reason, created_at AS createdAt FROM coin_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 10').all(userId),
  };
}

// ── Posts that repeat or copy something don't count toward the monthly goal ──────────────────────
// 'repeat' = the same picture/video (or, for text posts, the same words) you already posted.
// 'copy'   = the same picture/video, or a long identical text, that someone else posted first.
// Only exact matches are caught (case/spacing/emoji/links ignored for text). This cannot know about
// copyrighted material that was never posted on CHEX.
export function checkPostContent(postId, { rehashMedia = false } = {}) {
  const row = db.prepare('SELECT rowid AS rid, * FROM posts WHERE id = ?').get(postId);
  if (!row) return { counted: false, reason: null };
  const cHash = captionHash(row.caption);
  const mHash = row.image_url ? (rehashMedia || !row.media_hash ? mediaHashSync(row.image_url) : row.media_hash) : null;
  let reason = null;
  const earlier = (where, ...args) => db.prepare(`SELECT user_id FROM posts WHERE id != ? AND deleted_at IS NULL AND rowid < ? AND ${where}`).all(row.id, row.rid, ...args);
  const found = mHash ? [...earlier('media_hash = ?', mHash), ...db.prepare('SELECT user_id FROM reels WHERE deleted_at IS NULL AND media_hash = ? AND created_at < ?').all(mHash, row.created_at)]
    : (cHash ? earlier('image_url IS NULL AND caption_hash = ?', cHash) : []);
  if (found.some(f => f.user_id === row.user_id)) reason = 'repeat';
  else if (found.length && (mHash || normCaption(row.caption).length >= COIN_RULES.copiedCaptionMinLength)) reason = 'copy';
  db.prepare('UPDATE posts SET caption_hash = ?, media_hash = ?, coin_eligible = ?, coin_skip_reason = ? WHERE id = ?')
    .run(cHash, mHash, reason ? 0 : 1, reason, row.id);
  return { counted: !reason, reason };
}
export const safeCheckPost = (postId, opts) => { try { return checkPostContent(postId, opts); } catch (e) { console.error('post check failed', e); return { counted: true, reason: null }; } };

// Same idea for reels: the same video again (by you = repeat, first posted by someone else = copy).
export function checkReelContent(reelId, { rehashMedia = false } = {}) {
  const row = db.prepare('SELECT rowid AS rid, * FROM reels WHERE id = ?').get(reelId);
  if (!row) return { counted: false, reason: null };
  const mHash = rehashMedia || !row.media_hash ? mediaHashSync(row.video_url) : row.media_hash;
  const found = mHash ? [
    ...db.prepare('SELECT user_id FROM reels WHERE id != ? AND deleted_at IS NULL AND rowid < ? AND media_hash = ?').all(row.id, row.rid, mHash),
    ...db.prepare('SELECT user_id FROM posts WHERE deleted_at IS NULL AND media_hash = ? AND created_at < ?').all(mHash, row.created_at),
  ] : [];
  const reason = !found.length ? null : found.some(f => f.user_id === row.user_id) ? 'repeat' : 'copy';
  db.prepare('UPDATE reels SET media_hash = ?, coin_eligible = ?, coin_skip_reason = ? WHERE id = ?').run(mHash, reason ? 0 : 1, reason, row.id);
  return { counted: !reason, reason };
}
export const safeCheckReel = (reelId, opts) => { try { return checkReelContent(reelId, opts); } catch (e) { console.error('reel check failed', e); return { counted: true, reason: null }; } };

// Fingerprint posts that existed before this feature (runs in the background after the server starts).
export async function backfillContentHashes() {
  try {
    db.prepare("SELECT id, caption FROM posts WHERE caption_hash IS NULL AND image_url IS NULL AND caption != ''").all()
      .forEach(r => db.prepare('UPDATE posts SET caption_hash = ? WHERE id = ?').run(captionHash(r.caption), r.id));
    for (const r of db.prepare('SELECT id, image_url FROM posts WHERE media_hash IS NULL AND image_url IS NOT NULL LIMIT 2000').all()) {
      const h = await mediaHashAsync(r.image_url);
      if (h) db.prepare('UPDATE posts SET media_hash = ? WHERE id = ?').run(h, r.id);
    }
    for (const r of db.prepare('SELECT id, video_url FROM reels WHERE media_hash IS NULL AND video_url IS NOT NULL LIMIT 2000').all()) {
      const h = await mediaHashAsync(r.video_url);
      if (h) db.prepare('UPDATE reels SET media_hash = ? WHERE id = ?').run(h, r.id);
    }
  } catch (e) { console.error('hash backfill failed', e); }
}

// ── Game wins ────────────────────────────────────────────────────────────────────────────────────
// 1 coin per won game (once per room, up to the daily cap). Draws and walk-over wins don't pay.
export function awardGameWin(roomId, winnerId) {
  try {
    if (!winnerId || winnerId === 'draw') return 0;
    const players = db.prepare('SELECT user_id FROM game_players WHERE room_id = ?').all(roomId).map(r => r.user_id);
    if (players.length < 2 || !players.includes(winnerId)) return 0;
    const today = new Date().toISOString().slice(0, 10);
    const n = db.prepare("SELECT COUNT(*) AS c FROM coin_ledger WHERE user_id = ? AND ref LIKE 'game-win:%' AND substr(created_at, 1, 10) = ?").get(winnerId, today).c;
    if (n >= COIN_RULES.gameWinDailyCap) return 0;
    const game = db.prepare('SELECT g.name FROM game_rooms r JOIN games g ON g.id = r.game_id WHERE r.id = ?').get(roomId);
    const r = db.prepare('INSERT OR IGNORE INTO coin_ledger (user_id, amount, reason, ref) VALUES (?, ?, ?, ?)')
      .run(winnerId, COIN_RULES.gameWinReward, game?.name ? `Won ${game.name}` : 'Won a game', `game-win:${roomId}`);
    return r.changes ? COIN_RULES.gameWinReward : 0;
  } catch (e) { console.error('game win coin failed', e); return 0; }
}

// ── 30-day posting streak ────────────────────────────────────────────────────────────────────────
// Press Start → that day is Day 1. Every day you must share a post or a reel (repeats/copies don't
// count); days follow the time zone your device had when you pressed Start. Miss one day and the
// streak ends — Start again from Day 1. 30 days in a row pays 100 coins; you can do it again.
const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return 'UTC'; } };
export function dayOf(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const diffDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

function activityDays(userId, tz, startDay, countFrom) {
  const lower = new Date(Date.parse(`${startDay}T00:00:00Z`) - 36 * 3600e3).toISOString();   // covers every time zone
  const rows = [
    ...db.prepare('SELECT created_at FROM posts WHERE user_id = ? AND deleted_at IS NULL AND coin_eligible = 1 AND created_at >= ?').all(userId, lower),
    ...db.prepare('SELECT created_at FROM reels WHERE user_id = ? AND deleted_at IS NULL AND coin_eligible = 1 AND created_at >= ?').all(userId, lower),
  ];
  const days = new Set();
  for (const r of rows) {
    if (countFrom && r.created_at <= countFrom) continue;
    const d = dayOf(new Date(r.created_at), tz);
    if (d >= startDay) days.add(d);
  }
  return days;
}

// Brings the stored streak up to date: marks it broken on a missed day, or pays out on day 30.
export function evaluateStreak(userId, now = new Date()) {
  const row = db.prepare('SELECT * FROM coin_streaks WHERE user_id = ?').get(userId);
  if (!row || row.status !== 'active') return { row, justCompleted: false };
  const today = dayOf(now, row.tz), S = row.start_day, goal = COIN_RULES.streakDays;
  const days = activityDays(userId, row.tz, S, row.count_from);
  const last = Math.min(diffDays(S, today), goal - 1);
  let done = 0, brokenOn = null;
  for (let i = 0; i <= last; i++) {
    const d = addDays(S, i);
    if (days.has(d)) done++;
    else if (d < today) { brokenOn = d; break; }
  }
  if (brokenOn) {
    db.prepare("UPDATE coin_streaks SET status = 'broken', broken_on = ?, best = MAX(best, ?) WHERE user_id = ?").run(brokenOn, done, userId);
  } else if (done >= goal) {
    db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO coin_ledger (user_id, amount, reason, ref) VALUES (?, ?, ?, ?)')
        .run(userId, COIN_RULES.streakReward, `${goal}-day posting streak`, `streak:${S}`);
      db.prepare("UPDATE coin_streaks SET status = 'completed', best = ?, completed_runs = completed_runs + 1, completed_at = ? WHERE user_id = ?")
        .run(goal, now.toISOString(), userId);
    })();
    return { row: db.prepare('SELECT * FROM coin_streaks WHERE user_id = ?').get(userId), justCompleted: true };
  }
  return { row: db.prepare('SELECT * FROM coin_streaks WHERE user_id = ?').get(userId), justCompleted: false };
}

// After a post/reel is shared: keeps the streak current and tells the person when they finish it.
export function safeStreakTick(userId, io) {
  try {
    const { justCompleted } = evaluateStreak(userId);
    if (justCompleted) io?.to(`user:${userId}`).emit('coins:earned', { amount: COIN_RULES.streakReward, reason: `${COIN_RULES.streakDays}-day posting streak complete!` });
    return justCompleted;
  } catch (e) { console.error('streak tick failed', e); return false; }
}

export function startStreak(userId, timezone, now = new Date()) {
  const { row } = evaluateStreak(userId, now);
  if (row?.status === 'active') return { error: { status: 409, code: 'ALREADY_ACTIVE', message: 'Your streak is already running.' } };
  const tz = validTz(timezone), today = dayOf(now, tz);
  const countFrom = row?.status === 'completed' ? row.completed_at : null;   // a finished run's last post can't also start the next one
  db.prepare(`INSERT INTO coin_streaks (user_id, status, start_day, tz, count_from, broken_on, started_at) VALUES (?, 'active', ?, ?, ?, NULL, ?)
    ON CONFLICT(user_id) DO UPDATE SET status = 'active', start_day = excluded.start_day, tz = excluded.tz, count_from = excluded.count_from, broken_on = NULL, started_at = excluded.started_at`)
    .run(userId, today, tz, countFrom, now.toISOString());
  evaluateStreak(userId, now);
  return { ok: true };
}

export function streakSummary(userId, now = new Date()) {
  const goal = COIN_RULES.streakDays, reward = COIN_RULES.streakReward;
  const { row } = evaluateStreak(userId, now);
  const base = { goal, reward, status: row?.status || 'idle', best: row?.best || 0, completedRuns: row?.completed_runs || 0, tz: row?.tz || null, brokenOn: row?.broken_on || null };
  if (row?.status !== 'active') return base;
  const today = dayOf(now, row.tz), days = activityDays(userId, row.tz, row.start_day, row.count_from);
  const dayNumber = diffDays(row.start_day, today) + 1;
  const marks = Array.from({ length: goal }, (_, i) => {
    const d = addDays(row.start_day, i);
    return days.has(d) ? 'done' : d === today ? 'today' : 'future';
  });
  return { ...base, startDay: row.start_day, today, dayNumber, done: marks.filter(m => m === 'done').length, todayDone: days.has(today), marks };
}

// ── CHEX learn sections ──────────────────────────────────────────────────────────
// The browser reports each finished level. The server records it only if the level before it is already
// recorded (no skipping ahead) and enough time has passed since the last one, then pays 1 coin when the
// level closes a 9-level section. The ledger's unique ref means a section pays once per language, ever.
const LEARN_LANGS = ['es', 'fr', 'it', 'pt', 'de', 'ru', 'hi', 'el', 'zh', 'ja', 'ko', 'ar'];
const LEARN_NAMES = { es: 'Spanish', fr: 'French', it: 'Italian', pt: 'Portuguese', de: 'German', ru: 'Russian', hi: 'Hindi', el: 'Greek', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic' };
export const LEARN_LEVEL_COUNT = 108;
export const isLearnLang = (l) => LEARN_LANGS.includes(l);

// ── Which languages a person may study ───────────────────────────────────────────
// First language: free, chosen once. Every other language is premium: it unlocks only when ALL the languages you
// already own have 100 finished levels, and costs 100 CHEX coins. People who studied before this rule existed keep
// every language they had already started (kind 'earlier').
const langRows = (userId) => db.prepare('SELECT lang FROM learn_langs WHERE user_id = ? ORDER BY created_at, rowid').all(userId).map(r => r.lang);
function ownedLearnLangs(userId) {
  let owned = langRows(userId);
  if (!owned.length) {
    const started = db.prepare('SELECT lang FROM learn_levels WHERE user_id = ? GROUP BY lang ORDER BY MIN(completed_at)').all(userId).map(r => r.lang);
    for (const l of started) db.prepare("INSERT OR IGNORE INTO learn_langs (user_id, lang, kind) VALUES (?, ?, 'earlier')").run(userId, l);
    owned = started;
  }
  return owned;
}
const doneCounts = (userId) => Object.fromEntries(db.prepare('SELECT lang, COUNT(*) AS c FROM learn_levels WHERE user_id = ? GROUP BY lang').all(userId).map(r => [r.lang, r.c]));
const allDone = (owned, done) => owned.length > 0 && owned.every(l => (done[l] || 0) >= COIN_RULES.learnUnlockLevels);

export function learnLanguages(userId) {
  const owned = ownedLearnLangs(userId), done = doneCounts(userId);
  return {
    chosen: owned.length > 0, owned, completed: done,
    unlockLevels: COIN_RULES.learnUnlockLevels, price: COIN_RULES.learnUnlockPrice,
    canUnlock: allDone(owned, done) && owned.length < LEARN_LANGS.length,
    balance: getBalance(userId),
  };
}

export function chooseFirstLearnLanguage(userId, lang) {
  if (!isLearnLang(lang)) return { error: { status: 400, code: 'BAD_LANG', message: 'That language does not exist.' } };
  const tx = db.transaction(() => {
    if (ownedLearnLangs(userId).length) return { error: { status: 409, code: 'ALREADY_CHOSEN', message: 'You already chose your first language. Other languages are premium.' } };
    db.prepare("INSERT INTO learn_langs (user_id, lang, kind) VALUES (?, ?, 'first')").run(userId, lang);
    return { ok: true };
  });
  const r = tx.immediate();
  return r.error ? r : { ok: true, ...learnLanguages(userId) };
}

export function unlockLearnLanguage(userId, lang) {
  if (!isLearnLang(lang)) return { error: { status: 400, code: 'BAD_LANG', message: 'That language does not exist.' } };
  const tx = db.transaction(() => {
    const owned = ownedLearnLangs(userId);
    if (!owned.length) return { error: { status: 409, code: 'CHOOSE_FIRST', message: 'Choose your first language before unlocking others.' } };
    if (owned.includes(lang)) return { error: { status: 409, code: 'OWNED', message: 'You already have this language.' } };
    const done = doneCounts(userId);
    if (!allDone(owned, done)) {
      const need = owned.find(l => (done[l] || 0) < COIN_RULES.learnUnlockLevels);
      return { error: { status: 403, code: 'FINISH_LEVELS', message: `Finish ${COIN_RULES.learnUnlockLevels} levels of ${LEARN_NAMES[need]} first (${done[need] || 0}/${COIN_RULES.learnUnlockLevels}).` } };
    }
    const balance = getBalance(userId);
    if (balance < COIN_RULES.learnUnlockPrice) return { error: { status: 402, code: 'NOT_ENOUGH_COINS', message: `You need ${COIN_RULES.learnUnlockPrice - balance} more CHEX coins.` } };
    db.prepare('INSERT INTO coin_ledger (user_id, amount, reason, ref) VALUES (?, ?, ?, ?)').run(userId, -COIN_RULES.learnUnlockPrice, `Unlocked ${LEARN_NAMES[lang]} in CHEX learn`, `learn-lang:${lang}`);
    db.prepare("INSERT INTO learn_langs (user_id, lang, kind) VALUES (?, ?, 'unlocked')").run(userId, lang);
    return { ok: true };
  });
  const r = tx.immediate();
  return r.error ? r : { ok: true, ...learnLanguages(userId) };
}

export function recordLearnLevel(userId, lang, level, now = Date.now()) {
  const per = COIN_RULES.learnSectionLevels;
  const out = (recorded, coins, reason) => ({ recorded, coins, reason, balance: getBalance(userId) });
  if (!isLearnLang(lang) || !Number.isInteger(level) || level < 0 || level >= LEARN_LEVEL_COUNT) return { error: { status: 400, code: 'BAD_LEVEL', message: 'That level does not exist.' } };
  const tx = db.transaction(() => {
    if (!ownedLearnLangs(userId).includes(lang)) return out(false, 0, 'locked');      // premium language not unlocked yet
    if (db.prepare('SELECT 1 FROM learn_levels WHERE user_id = ? AND lang = ? AND level = ?').get(userId, lang, level)) return out(false, 0, 'already');
    if (level > 0 && !db.prepare('SELECT 1 FROM learn_levels WHERE user_id = ? AND lang = ? AND level = ?').get(userId, lang, level - 1)) return out(false, 0, 'order');
    const last = db.prepare('SELECT MAX(completed_at) AS t FROM learn_levels WHERE user_id = ?').get(userId).t;
    if (last && now - Date.parse(last) < COIN_RULES.learnMinLevelSeconds * 1000) return out(false, 0, 'too-fast');
    db.prepare('INSERT INTO learn_levels (user_id, lang, level, completed_at) VALUES (?, ?, ?, ?)').run(userId, lang, level, new Date(now).toISOString());
    let coins = 0;
    if ((level + 1) % per === 0) {
      const section = (level + 1) / per;
      const r = db.prepare('INSERT OR IGNORE INTO coin_ledger (user_id, amount, reason, ref) VALUES (?, ?, ?, ?)')
        .run(userId, COIN_RULES.learnSectionReward, `Finished ${LEARN_NAMES[lang]} section ${section} in CHEX learn`, `learn-section:${lang}:${section}`);
      if (r.changes) coins = COIN_RULES.learnSectionReward;
    }
    return out(true, coins, null);
  });
  return tx.immediate();
}

// ── Gifts between people ─────────────────────────────────────────────────────────────────────────
// The sender PAYS from their own wallet (coins gift = that many coins; theme/frame pack = its store price;
// a language = the 100-coin unlock price). The receiver gets it for free. The master account sends for free.
// Coin gifts are capped per day so two accounts can't be used to shuffle coins around endlessly.
export const GIFT_RULES = { minCoins: 1, maxCoinsPerGift: 500, dailyCoinCap: 500 };
export const LEARN_LANGUAGES = Object.entries(LEARN_NAMES).map(([code, name]) => ({ code, name }));

export function sendGift(fromId, to, spec) {
  const master = isMasterId(fromId);
  const bad = (status, code, message) => ({ error: { status, code, message } });
  const tx = db.transaction(() => {
    const charge = (amount, reason, ref) => {
      if (master) return null;
      const balance = getBalance(fromId);
      if (balance < amount) return bad(402, 'NOT_ENOUGH_COINS', `You need ${amount - balance} more CHEX coins for this gift.`);
      db.prepare('INSERT INTO coin_ledger (user_id, amount, reason, ref) VALUES (?, ?, ?, ?)').run(fromId, -amount, reason, `${ref}:${to.id}:${Date.now()}:${Math.random()}`);
      return null;
    };
    const who = `@${to.username}`;
    if (spec.type === 'coins') {
      const n = spec.amount;
      if (!Number.isInteger(n) || n < GIFT_RULES.minCoins || n > GIFT_RULES.maxCoinsPerGift) return bad(400, 'INVALID_AMOUNT', `Send between ${GIFT_RULES.minCoins} and ${GIFT_RULES.maxCoinsPerGift} coins at a time.`);
      if (!master) {
        const today = new Date().toISOString().slice(0, 10);
        const sent = -db.prepare("SELECT COALESCE(SUM(amount), 0) s FROM coin_ledger WHERE user_id = ? AND ref LIKE 'gift-coins-sent:%' AND substr(created_at, 1, 10) = ?").get(fromId, today).s;
        if (sent + n > GIFT_RULES.dailyCoinCap) return bad(429, 'DAILY_LIMIT', `You can send up to ${GIFT_RULES.dailyCoinCap} coins a day (${Math.max(0, GIFT_RULES.dailyCoinCap - sent)} left today).`);
      }
      const e = charge(n, `Gift of coins to ${who}`, 'gift-coins-sent'); if (e) return e;
      db.prepare('INSERT INTO coin_ledger (user_id, amount, reason, ref) VALUES (?, ?, ?, ?)').run(to.id, n, `Gift from @${spec.fromName}`, `gift-coins-recv:${fromId}:${Date.now()}:${Math.random()}`);
      return { ok: true, label: `${n} CHEX coins`, text: `🎁 @${spec.fromName} sent you ${n} CHEX coins!`, amount: n };
    }
    if (spec.type === 'premium-themes' || spec.type === 'premium-frames') {
      const item = STORE_ITEMS.find(i => i.id === spec.type);
      if (db.prepare('SELECT 1 FROM coin_unlocks WHERE user_id = ? AND item_id = ?').get(to.id, item.id)) return bad(409, 'ALREADY_OWNED', `${who} already has ${item.name}.`);
      const e = charge(item.price, `Gift of ${item.name} to ${who}`, 'gift-item-sent'); if (e) return e;
      db.prepare('INSERT INTO coin_unlocks (user_id, item_id, price) VALUES (?, ?, 0)').run(to.id, item.id);
      return { ok: true, label: item.name, text: `🎁 @${spec.fromName} gifted you ${item.name}!` };
    }
    if (spec.type === 'language') {
      if (!isLearnLang(spec.lang)) return bad(400, 'BAD_LANG', 'That language does not exist.');
      const owned = ownedLearnLangs(to.id);
      if (!owned.length) return bad(409, 'NO_FIRST_LANGUAGE', `${who} hasn’t picked their first CHEX learn language yet — they get that one free.`);
      if (owned.includes(spec.lang)) return bad(409, 'ALREADY_OWNED', `${who} already has ${LEARN_NAMES[spec.lang]}.`);
      const e = charge(COIN_RULES.learnUnlockPrice, `Gift of ${LEARN_NAMES[spec.lang]} to ${who}`, 'gift-lang-sent'); if (e) return e;
      db.prepare("INSERT INTO learn_langs (user_id, lang, kind) VALUES (?, ?, 'unlocked')").run(to.id, spec.lang);
      return { ok: true, label: LEARN_NAMES[spec.lang], text: `🎁 @${spec.fromName} gifted you ${LEARN_NAMES[spec.lang]} in CHEX learn!` };
    }
    return bad(400, 'INVALID_GIFT', 'Choose coins, premium themes, premium frames or a language.');
  });
  return tx.immediate();
}
