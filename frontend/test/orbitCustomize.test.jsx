import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

const api = vi.hoisted(() => ({ notifications: vi.fn(), conversations: vi.fn(), userPosts: vi.fn() }));
vi.mock('../src/api.js', () => ({ api }));
vi.mock('../src/components/Avatar.jsx', () => ({ default: ({ user }) => <i data-testid="av">{user?.displayName}</i> }));

const store = await import('../src/orbit/orbitStore.js');
const { default: Orbit } = await import('../src/orbit/Orbit.jsx');
const { default: OrbitSettings } = await import('../src/orbit/OrbitSettings.jsx');

const user = { id: 'me', username: 'me', displayName: 'Me' };
const ids = (list) => list.map(x => x.id);

beforeEach(() => {
  cleanup(); localStorage.clear();
  api.notifications.mockReset().mockResolvedValue({ unreadMessages: 0, unreadOther: 0, notifications: [] });
  api.conversations.mockReset().mockResolvedValue({ conversations: [] });
  api.userPosts.mockReset().mockResolvedValue({ posts: [] });
  window.matchMedia = (q) => ({ matches: /reduce/.test(q), addEventListener() {}, removeEventListener() {} });   // flat grid in jsdom
});
afterEach(() => vi.useRealTimers());

describe('menu model (pure)', () => {
  it('defaults to the eight ring cards and six quick actions', () => {
    const d = store.defaultMenu();
    expect(d.ring).toEqual(ids(store.RING));
    expect(d.radial).toHaveLength(6);
    expect(store.isDefaultMenu(d)).toBe(true);
  });
  it('drops unknown / duplicate ids and falls back when too few remain', () => {
    expect(store.normalizeMenu({ ring: ['feed', 'feed', 'nope', 'games', 'reels'], radial: ['codex', 'x', 'mic'] }))
      .toEqual({ ring: ['feed', 'games', 'reels'], radial: store.defaultMenu().radial });   // radial: only 1 valid → default
    expect(store.normalizeMenu({ ring: ['feed', 'games'] }).ring).toEqual(ids(store.RING));   // < 3 cards → default
    expect(store.normalizeMenu('junk')).toEqual(store.defaultMenu());
    expect(store.normalizeMenu({ ring: Array(30).fill(0).map((_, i) => ['feed', 'messages', 'codex', 'reels', 'gallery', 'profile', 'notifications', 'search', 'games', 'learn', 'sim3d', 'stickies', 'mylife', 'coins'][i % 14]) }).ring.length).toBeLessThanOrEqual(12);
  });
  it('saves and reloads from this device; reset clears it', () => {
    store.saveMenu({ ring: ['reels', 'feed', 'games'], radial: ['codex', 'voice'] });
    expect(store.loadMenu()).toEqual({ ring: ['reels', 'feed', 'games'], radial: ['codex', 'voice'] });
    store.resetMenu();
    expect(store.loadMenu()).toEqual(store.defaultMenu());
  });
  it('corrupt storage gives the defaults', () => {
    localStorage.setItem('chex.orbit.menu', '{{{');
    expect(store.loadMenu()).toEqual(store.defaultMenu());
  });
  it('never shows admin-only cards to non-admins, even if saved', () => {
    const menu = { ring: ['feed', 'messages', 'reels', 'admin'], radial: store.defaultMenu().radial };
    expect(ids(store.resolveRing(menu, { isAdmin: false }))).toEqual(['feed', 'messages', 'reels']);
    expect(ids(store.resolveRing(menu, { isAdmin: true }))).toEqual(['feed', 'messages', 'reels', 'admin']);
  });
  it('list helpers move, add and remove within the limits', () => {
    expect(store.moveId(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(store.moveId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(store.removeId(['a', 'b', 'c'], 'a', 3)).toEqual(['a', 'b', 'c']);     // at the minimum
    expect(store.removeId(['a', 'b', 'c', 'd'], 'a', 3)).toEqual(['b', 'c', 'd']);
    expect(store.addId(['a'], 'a', 5)).toEqual(['a']);
    expect(store.addId(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);                  // at the maximum
  });
  it('opens facing the right card in a customised ring', () => {
    const items = store.resolveRing({ ring: ['reels', 'messages', 'feed'], radial: store.defaultMenu().radial }, user);
    expect(store.ringIndexForRoute('messages', items)).toBe(1);
    expect(store.ringIndexForRoute('feed', items)).toBe(2);
    expect(store.ringIndexForRoute('messages')).toBe(1);   // default list unchanged
  });
});

describe('<Orbit> Customize tab', () => {
  const setup = (route = 'feed', u = user) => { const navigate = vi.fn(), onClose = vi.fn(); render(<Orbit user={u} route={route} navigate={navigate} onClose={onClose} />); return { navigate, onClose }; };
  const openCust = () => fireEvent.click(screen.getByRole('button', { name: /Customize/ }));
  const ringLabels = () => within(screen.getByLabelText('Modules')).getAllByRole('button').map(b => b.getAttribute('aria-label').split('.')[0]);

  it('opens from the header and closes with Done or Escape', () => {
    setup();
    expect(screen.queryByTestId('orbit-customize')).toBeNull();
    openCust();
    expect(screen.getByTestId('orbit-customize')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('orbit-customize')).toBeNull();
    openCust();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'CHEX Orbit' }), { key: 'Escape' });
    expect(screen.queryByTestId('orbit-customize')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'CHEX Orbit' })).toBeTruthy();      // Escape closed only the tab
  });

  it('reorders cards and the ring follows, saved on this device', () => {
    setup();
    expect(ringLabels()[0]).toBe('Home');
    openCust();
    fireEvent.click(screen.getByRole('button', { name: 'Move Home down' }));
    expect(ringLabels().slice(0, 2)).toEqual(['Messages', 'Home']);
    expect(store.loadMenu().ring.slice(0, 2)).toEqual(['messages', 'feed']);
  });

  it('hides a card, adds Games from the hidden list, and keeps at least 3', () => {
    setup();
    openCust();
    fireEvent.click(screen.getByRole('button', { name: 'Add Games' }));
    expect(ringLabels()).toContain('Games');
    expect(screen.getByTestId('orbit-cu-count').textContent).toMatch(/^9 of 12/);
    fireEvent.click(screen.getByRole('button', { name: 'Hide Search' }));
    expect(ringLabels()).not.toContain('Search');
    // shrink to the minimum: the hide buttons lock
    let guard = 0;
    while (!screen.getByRole('button', { name: 'Hide Reels' }).disabled && guard++ < 20) {
      const hide = screen.getAllByRole('button', { name: /^Hide / }).find(b => !/Reels|Home|Messages/.test(b.getAttribute('aria-label')));
      if (!hide) break; fireEvent.click(hide);
    }
    expect(ringLabels()).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /^Hide / }).every(b => b.disabled)).toBe(true);
  });

  it('a card added from the old satellite list opens a working workspace', async () => {
    const { navigate } = setup();
    openCust();
    fireEvent.click(screen.getByRole('button', { name: 'Add Games' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: /^Games\./ }));
    fireEvent.click(screen.getByRole('button', { name: /Open Games/ }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('games', undefined));
  });

  it('Quick actions tab changes what the orb shows', () => {
    setup();
    const radialLabels = () => within(document.querySelector('.ob-hubwrap')).getAllByRole('button').map(b => b.getAttribute('aria-label')).filter(l => l !== 'Quick actions');
    expect(radialLabels()).toHaveLength(6);
    openCust();
    fireEvent.click(screen.getByRole('tab', { name: 'Quick actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide Voice search' }));
    expect(radialLabels()).toHaveLength(5);
    expect(radialLabels()).not.toContain('Voice search');
    expect(store.loadMenu().radial).not.toContain('voice');
  });

  it('Reset to default restores everything', () => {
    setup();
    openCust();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Search' }));
    fireEvent.click(screen.getByRole('button', { name: /Reset to default/ }));
    expect(ringLabels()).toHaveLength(8);
    expect(store.isDefaultMenu(store.loadMenu())).toBe(true);
    expect(screen.getByRole('button', { name: /Reset to default/ }).disabled).toBe(true);
  });

  it('a saved layout is used the next time Orbit opens', () => {
    store.saveMenu({ ring: ['reels', 'feed', 'search', 'games'], radial: store.defaultMenu().radial });
    setup();
    expect(ringLabels()).toEqual(['Reels', 'Home', 'Search', 'Games']);
  });

  it('only admins can add the Admin card', () => {
    setup();
    openCust();
    expect(screen.queryByRole('button', { name: 'Add Admin' })).toBeNull();
    cleanup();
    setup('feed', { ...user, isAdmin: true });
    openCust();
    expect(screen.getByRole('button', { name: 'Add Admin' })).toBeTruthy();
  });
});

describe('Settings → Orbit card', () => {
  it('offers a reset only when the menu was customised', () => {
    render(<OrbitSettings />);
    expect(screen.queryByRole('button', { name: /Reset menu/ })).toBeNull();
    cleanup();
    store.saveMenu({ ring: ['reels', 'feed', 'games'], radial: store.defaultMenu().radial });
    render(<OrbitSettings />);
    fireEvent.click(screen.getByRole('button', { name: /Reset menu/ }));
    expect(store.isDefaultMenu(store.loadMenu())).toBe(true);
  });
});
