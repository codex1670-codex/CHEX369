import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { iconFor, labelKey, compactEnabled, setCompact, startCompactLayer, scan } from '../src/compact.js';

const flush = () => act(() => new Promise((r) => setTimeout(r, 40)));

describe('compact: label → icon', () => {
  it('maps plain action words to an icon and ignores decoration', () => {
    expect(iconFor('Save')).toBe('💾');
    expect(iconFor('  Cancel ')).toBe('✕');
    expect(iconFor('🗑 Delete')).toBe('🗑');
    expect(iconFor('✏️ Edit')).toBe('✎');
    expect(iconFor('Try again…')).toBe('↻');
    expect(labelKey('← Back')).toBe('back');
  });
  it('leaves choices, sentences and unknown words as text', () => {
    for (const t of ['Truth', 'Dare', 'Higher', 'Log in', 'Sign up', 'Pick a username that suits you', '', '🔊']) expect(iconFor(t), t).toBe('');
  });
});

describe('compact: preference', () => {
  beforeEach(() => localStorage.clear());
  it('is on by default and can be switched off and on', () => {
    expect(compactEnabled()).toBe(true);
    setCompact(false);
    expect(compactEnabled()).toBe(false);
    expect(document.documentElement.getAttribute('data-compact')).toBe('off');
    setCompact(true);
    expect(document.documentElement.getAttribute('data-compact')).toBe('on');
  });
});

describe('compact layer on the page', () => {
  let stop;
  beforeEach(() => { localStorage.clear(); setCompact(true); });
  afterEach(() => { stop?.(); stop = undefined; cleanup(); });

  it('marks text buttons with an icon + tooltip but keeps the words in the DOM', async () => {
    render(<div><button>Save</button><button>Truth</button></div>);
    stop = startCompactLayer();
    await flush();
    const save = screen.getByText('Save');
    expect(save.getAttribute('data-ico')).toBe('💾');
    expect(save.getAttribute('title')).toBe('Save');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();   // still reachable by its word
    expect(screen.getByText('Truth').hasAttribute('data-ico')).toBe(false);
  });

  it('never overwrites a title someone wrote on purpose, and skips the sign-in card', async () => {
    render(<div><button title="Delete this post forever">Delete</button><div className="auth-card"><button>Cancel</button></div></div>);
    stop = startCompactLayer();
    await flush();
    const del = screen.getByText('Delete');
    expect(del.getAttribute('data-ico')).toBe('🗑');
    expect(del.getAttribute('title')).toBe('Delete this post forever');
    expect(screen.getByText('Cancel').hasAttribute('data-ico')).toBe(false);
  });

  it('follows a button whose label changes (Follow → Following)', async () => {
    function F() { const [on, setOn] = useState(false); return <button onClick={() => setOn(true)}>{on ? 'Following' : 'Follow'}</button>; }
    render(<F />);
    stop = startCompactLayer();
    await flush();
    const b = screen.getByRole('button');
    expect(b.getAttribute('data-ico')).toBe('＋');
    fireEvent.click(b);
    await flush();
    expect(b.getAttribute('data-ico')).toBe('✓');
    expect(b.getAttribute('title')).toBe('Following');
  });

  it('picks up buttons added later', async () => {
    const { rerender } = render(<div />);
    stop = startCompactLayer();
    rerender(<div><button>Close</button></div>);
    await flush();
    expect(screen.getByText('Close').getAttribute('data-ico')).toBe('✕');
  });

  it('does not touch buttons that hold other elements (e.g. avatar + name)', async () => {
    render(<button><span>Save</span></button>);
    stop = startCompactLayer();
    await flush();
    expect(screen.getByRole('button').hasAttribute('data-ico')).toBe(false);
  });

  it('collapses long notes, expands on tap, and leaves short ones, links and chat alone', async () => {
    const long = 'Choose Light or Dark, or unlock the premium animated themes with CHEX coins. Changes apply instantly.';
    render(<div>
      <p style={{ color: 'var(--text-mid)' }}>{long}</p>
      <p style={{ color: 'var(--text-mid)' }}>Short note.</p>
      <p style={{ color: 'var(--text-mid)' }}>{long} <a href="/x">read more</a></p>
      <div className="chat-messages"><p style={{ color: 'var(--text-mid)' }}>{long}</p></div>
      <div role="dialog"><p style={{ color: 'var(--text-mid)' }}>{long}</p></div>
    </div>);
    stop = startCompactLayer();
    await flush();
    const ps = document.querySelectorAll('p');
    expect(ps[0].hasAttribute('data-hint')).toBe(true);
    expect(ps[1].hasAttribute('data-hint')).toBe(false);
    expect(ps[2].hasAttribute('data-hint')).toBe(false);
    expect(ps[3].hasAttribute('data-hint')).toBe(false);
    expect(ps[4].hasAttribute('data-hint')).toBe(false); // dialogs keep their full instructions
    fireEvent.click(ps[0]);
    expect(ps[0].hasAttribute('data-open')).toBe(true);
    fireEvent.click(ps[0]);
    expect(ps[0].hasAttribute('data-open')).toBe(false);
  });

  it('keeps tabs, filters and switches as words (an icon would hide which is which)', async () => {
    render(<div>
      <div className="feed-tabs"><button>Following</button><button>For You</button></div>
      <div role="tablist"><button role="tab">Save</button></div>
      <button aria-pressed="true">Edit</button>
      <button role="switch" aria-checked="true">Lock</button>
      <button>Follow</button>
    </div>);
    stop = startCompactLayer();
    await flush();
    for (const name of ['Following', 'Save', 'Edit', 'Lock']) expect(screen.getByText(name).hasAttribute('data-ico'), name).toBe(false);
    expect(screen.getByText('Follow').getAttribute('data-ico')).toBe('＋');
  });

  it('stops watching when told to', async () => {
    const spy = vi.spyOn(MutationObserver.prototype, 'disconnect');
    stop = startCompactLayer();
    stop(); stop = undefined;
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('scan() is safe on empty input', () => {
    expect(() => { scan(null); scan(document.createTextNode('x')); }).not.toThrow();
  });
});
