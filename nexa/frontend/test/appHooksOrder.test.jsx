// React needs hooks to run in the same order on every render. App returns early for the splash and
// login screens, so any hook placed after those returns crashes the app the moment a user logs in
// ("Rendered more hooks than during the previous render"). Keep every hook above them.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('App.jsx hook order', () => {
  it('has no hooks after the early splash / login returns', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf-8');
    const lines = src.split('\n');
    const first = lines.findIndex(l => /^\s{2}if \((booting|!user)\b.*\breturn\b/.test(l));
    expect(first).toBeGreaterThan(0);
    const late = lines.slice(first).map((l, i) => ({ l, n: first + i + 1 }))
      .filter(({ l }) => /^\s{2}(const .*= )?use[A-Z]\w*\(/.test(l));
    expect(late, `hooks after early return: ${late.map(x => `line ${x.n}`).join(', ')}`).toEqual([]);
  });
});
