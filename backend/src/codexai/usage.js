// Usage tracking, daily quotas (UTC days, like Cloudflare's reset), and provider cool-downs.
import { CLOUDFLARE_ENGINES } from './engines.js';

const utcDay = (d) => d.toISOString().slice(0, 10);
const nextUtcMidnight = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);

export function createUsage({ db, config, settings, now = () => new Date() }) {
  const cooldowns = new Map(); // engine → { until(ms), reason }

  const record = ({ userId = null, engine, provider, model = null, status, units = 0, ms = null, errorCode = null }) => {
    const t = now();
    db.prepare('INSERT INTO ai_usage (user_id, engine, provider, model, status, units, ms, error_code, day, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(userId, engine, provider, model, status, units, ms, errorCode, utcDay(t), t.toISOString());
  };
  // Requests that reached (or tried to reach) a provider count against request limits; blocked ones don't.
  const requestsToday = ({ engine, userId }) => {
    const day = utcDay(now());
    return userId
      ? db.prepare("SELECT COUNT(*) c FROM ai_usage WHERE day = ? AND engine = ? AND user_id = ? AND status != 'blocked'").get(day, engine, userId).c
      : db.prepare("SELECT COUNT(*) c FROM ai_usage WHERE day = ? AND engine = ? AND status != 'blocked'").get(day, engine).c;
  };
  const neuronsToday = () => db.prepare("SELECT COALESCE(SUM(units),0) s FROM ai_usage WHERE day = ? AND provider = 'cloudflare' AND status = 'ok'").get(utcDay(now())).s;

  const setCooldown = (engine, { untilMs, reason }) => cooldowns.set(engine, { until: untilMs, reason });
  const coolUntilMidnight = (engine, reason) => setCooldown(engine, { untilMs: nextUtcMidnight(now()), reason });
  const clearCooldown = (engine) => cooldowns.delete(engine);
  const cooldownOf = (engine) => { const c = cooldowns.get(engine); if (!c) return null; if (c.until <= now().getTime()) { cooldowns.delete(engine); return null; } return c; };

  // → { ok:true } | { ok:false, code, message }. `estUnits` = estimated Cloudflare neurons for this call.
  const check = ({ engine, userId, estUnits = 0 }) => {
    const s = settings.get(engine);
    if (!s.enabled) return { ok: false, code: 'DISABLED' };
    const cd = cooldownOf(engine);
    if (cd) return { ok: false, code: 'RATE_LIMIT', until: cd.until };
    if (requestsToday({ engine, userId }) >= s.perUserDaily) return { ok: false, code: 'USER_LIMIT', message: `You've reached your free daily limit for ${s.label} (${s.perUserDaily} a day). It resets at 00:00 UTC.` };
    if (requestsToday({ engine }) >= s.globalDaily) return { ok: false, code: 'GLOBAL_LIMIT', message: `${s.label} has reached CHEX's shared free limit for today (${s.globalDaily}). It resets at 00:00 UTC.` };
    if (CLOUDFLARE_ENGINES.includes(engine) && neuronsToday() + estUnits > config.cloudflare.dailyNeuronCap) {
      return { ok: false, code: 'QUOTA', message: `The free Cloudflare allowance CHEX allows itself for today is used up (${Math.round(neuronsToday())} of ${config.cloudflare.dailyNeuronCap} neurons). It resets at 00:00 UTC.` };
    }
    return { ok: true };
  };

  const remaining = (engine, userId) => {
    const s = settings.get(engine);
    return { perUser: Math.max(0, s.perUserDaily - requestsToday({ engine, userId })), global: Math.max(0, s.globalDaily - requestsToday({ engine })) };
  };

  const summary = () => {
    const day = utcDay(now());
    const since = utcDay(new Date(now().getTime() - 6 * 86400_000));
    const today = db.prepare("SELECT engine, COUNT(*) requests, SUM(status='ok') ok, SUM(status='error') errors, SUM(status='blocked') blocked, COALESCE(SUM(CASE WHEN status='ok' THEN units END),0) units FROM ai_usage WHERE day = ? GROUP BY engine").all(day);
    const week = db.prepare("SELECT day, engine, COUNT(*) requests, SUM(status='error') errors FROM ai_usage WHERE day >= ? GROUP BY day, engine ORDER BY day").all(since);
    const topUsers = db.prepare("SELECT u.user_id id, COALESCE(us.username, u.user_id) username, COUNT(*) requests FROM ai_usage u LEFT JOIN users us ON us.id = u.user_id WHERE u.day = ? AND u.user_id IS NOT NULL AND u.status != 'blocked' GROUP BY u.user_id ORDER BY requests DESC LIMIT 5").all(day);
    const errors = db.prepare("SELECT engine, provider, error_code code, created_at at FROM ai_usage WHERE status = 'error' ORDER BY id DESC LIMIT 10").all();
    return { day, today, week, topUsers, errors, neuronsToday: neuronsToday(), neuronCap: config.cloudflare.dailyNeuronCap };
  };

  return { record, requestsToday, neuronsToday, check, remaining, summary, setCooldown, coolUntilMidnight, clearCooldown, cooldownOf, utcDay };
}
