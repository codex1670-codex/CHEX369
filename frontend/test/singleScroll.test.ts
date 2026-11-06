import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../src');
const walk = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(d, e.name)) : /\.(jsx|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []);

/** Elements that really are pop-ups and are meant to scroll inside themselves. */
const OVERLAYS = new Set(['codex-panel', 'reel-comments-sheet', 'as-sheet', 'perm-sheet', 'react-sheet', 'gs-box', 'fl-box', 'pm-box', 'me-modal']);
/** Inline cards that must flow with the page (excluded from the catch-all scroll rule). */
const INLINE = ['perm-panel', 'lx-panel', 'me-panel'];

describe('single page scroll', () => {
  const responsive = fs.readFileSync(path.join(SRC, 'responsive.css'), 'utf8');
  const polish = fs.readFileSync(path.join(SRC, 'polish.css'), 'utf8');

  it('every inline card is excluded from the catch-all "-panel/-box/-sheet/-modal" scroller', () => {
    const rule = responsive.split('\n').find(l => l.includes('[class$="-panel"]')) ?? '';
    for (const c of INLINE) expect(rule, c).toContain(`.${c}`);
    for (const c of INLINE) expect(polish, c).toContain(`.${c}`);
  });

  it('no NEW class ending in -panel/-box/-sheet/-modal slips in unreviewed', () => {
    const found = new Set<string>();
    for (const f of walk(SRC)) {
      const text = fs.readFileSync(f, 'utf8');
      for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        for (const tok of (m[1] ?? m[2] ?? '').split(/\s+/)) {
          // the rule only matches when the class attribute ENDS with the suffix, i.e. the last token
          if (/-(panel|box|sheet|modal)$/.test(tok) && (m[1] ?? m[2] ?? '').trim().endsWith(tok)) found.add(tok);
        }
      }
    }
    const reviewed = new Set([...OVERLAYS, ...INLINE, 'chat-panel']); // chat-panel sets its own overflow
    const unreviewed = [...found].filter(c => !reviewed.has(c));
    expect(unreviewed, 'Add to OVERLAYS (real pop-up) or INLINE (flows with page, exclude in responsive.css)').toEqual([]);
  });
});
