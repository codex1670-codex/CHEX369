// A tiny per-provider concurrency gate. Providers can only handle a few requests at once, so extra requests wait their
// turn (up to waitMs) instead of failing; past that they get a clear "busy" message.
import { AiError } from './errors.js';

export function createLimiter(max, { waitMs = 25_000 } = {}) {
  let active = 0; const queue = [];
  const release = () => { active--; const next = queue.shift(); if (next) { clearTimeout(next.timer); active++; next.go(); } };
  const acquire = () => new Promise((resolve, reject) => {
    if (active < max) { active++; return resolve(); }
    const entry = { go: resolve, timer: setTimeout(() => { const i = queue.indexOf(entry); if (i >= 0) queue.splice(i, 1); reject(new AiError('BUSY', 'busy')); }, waitMs) };
    queue.push(entry);
  });
  return {
    async run(fn) { await acquire(); try { return await fn(); } finally { release(); } },
    get active() { return active; }, get waiting() { return queue.length; },
  };
}
