import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ notifications: vi.fn(), conversations: vi.fn(), userPosts: vi.fn() }));
vi.mock('../src/api.js', () => ({ api }));
vi.mock('../src/components/Avatar.jsx', () => ({ default: ({ user }) => <i data-testid="av">{user?.displayName}</i> }));

const store = await import('../src/orbit/orbitStore.js');
const { default: Orbit } = await import('../src/orbit/Orbit.jsx');
const { default: OrbitSettings } = await import('../src/orbit/OrbitSettings.jsx');
const gestures = await import('../src/gestures/gestureStore.js');

const user = { id: 'me', username: 'me', displayName: 'Me' };
const ptr = (type, el, x = 100, y = 100, extra = {}) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.assign(e, { clientX: x, clientY: y, button: 0, isPrimary: true, pointerType: 'touch', ...extra }); el.dispatchEvent(e); };
const tap = (el, x = 100, y = 100) => { ptr('pointerdown', el, x, y); ptr('pointerup', el, x, y); };

beforeEach(() => {
  cleanup(); localStorage.clear();
  api.notifications.mockReset().mockResolvedValue({ unreadMessages: 3, unreadOther: 1, notifications: [] });
  api.conversations.mockReset().mockResolvedValue({ conversations: [{ id: 'c1', participants: [user, { id: 'a', username: 'amy', displayName: 'Amy' }], lastMessage: { content: 'hello there' }, unreadCount: 2 }] });
  api.userPosts.mockReset().mockResolvedValue({ posts: [] });
  window.matchMedia = (q) => ({ matches: /reduce/.test(q), addEventListener() {}, removeEventListener() {} });   // reduced motion → flat grid in jsdom
});
afterEach(() => vi.useRealTimers());

describe('ring maths', () => {
  it('radius makes neighbouring cards touch or open slightly', () => {
    expect(store.ringRadius(8, 240)).toBeGreaterThan(290);
    expect(store.ringRadius(1, 240)).toBe(0);
  });
  it('knows which card is in front', () => {
    expect(store.frontIndex(0, 8)).toBe(0);
    expect(store.frontIndex(-45, 8)).toBe(1);
    expect(store.frontIndex(45, 8)).toBe(7);
    expect(store.frontIndex(-360 - 90, 8)).toBe(2);
  });
  it('angle from front is signed and wraps', () => {
    expect(store.angleFromFront(0, 0, 8)).toBe(0);
    expect(Math.abs(store.angleFromFront(4, 0, 8))).toBe(180);
    expect(store.angleFromFront(1, -45, 8)).toBe(0);
  });
  it('a flick snaps to a card', () => {
    expect(store.snapTheta(-20, 0, 8)).toBeCloseTo(0);
    expect(store.snapTheta(-20, -0.2, 8)).toBe(-45);    // gentle swipe: one card
    expect(store.snapTheta(-20, -0.35, 8)).toBe(-90);   // fast swipe carries two cards
  });
  it('opens facing the page you are on', () => {
    expect(store.ringIndexForRoute('messages')).toBe(1);
    expect(store.ringIndexForRoute('profile')).toBe(5);   // Profile, not Gallery
    expect(store.ringIndexForRoute('games')).toBe(0);
  });
});

describe('settings + fallback', () => {
  it('defaults on/auto and ignores junk', () => {
    expect(store.loadOrbit()).toEqual({ enabled: true, mode: 'auto' });
    localStorage.setItem('chex.orbit', '{"enabled":false,"mode":"warp"}');
    expect(store.loadOrbit()).toEqual({ enabled: false, mode: 'auto' });
    localStorage.setItem('chex.orbit', 'nope');
    expect(store.loadOrbit().enabled).toBe(true);
  });
  it('reduced motion always resolves to 2D', () => {
    expect(store.resolveMode({ enabled: true, mode: '3d' })).toBe('2d');
  });
  it('mode switch persists from the settings card', () => {
    render(<OrbitSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Flat (2D)' }));
    expect(store.loadOrbit().mode).toBe('2d');
    fireEvent.click(screen.getByLabelText(/Double-tap opens Orbit/));
    expect(store.loadOrbit().enabled).toBe(false);
  });
  it('does not add a gesture to the ten Smart gestures', () => { expect(gestures.GESTURES).toHaveLength(10); });
});

describe('double-tap detector', () => {
  let stop, hits;
  beforeEach(() => { hits = vi.fn(); stop = store.startOrbitDoubleTap(hits, () => store.loadOrbit().enabled); document.body.innerHTML = '<div id="bg"><p id="t">text</p><button id="b">x</button><img id="i" alt=""><div class="reel-stage"><span id="r"></span></div><div class="post-3d"><span id="p"></span></div></div>'; });
  afterEach(() => stop());
  it('opens on two quick taps in an empty area', () => { const el = document.getElementById('bg'); tap(el); tap(el, 104, 102); expect(hits).toHaveBeenCalledTimes(1); });
  it('needs two taps, close together and quick', () => {
    const el = document.getElementById('bg');
    tap(el); expect(hits).not.toHaveBeenCalled();
    tap(el, 400, 400); expect(hits).not.toHaveBeenCalled();   // far apart = two single taps
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 1000); tap(el, 400, 400); expect(hits).not.toHaveBeenCalled();   // too slow
  });
  it('keeps double-tap-to-like on media, reels, buttons and fields', () => {
    for (const id of ['b', 'i', 'r', 'p']) { const el = document.getElementById(id); tap(el); tap(el); }
    expect(hits).not.toHaveBeenCalled();
  });
  it('a swipe or drag is not a tap', () => { const el = document.getElementById('bg'); ptr('pointerdown', el, 10, 10); ptr('pointerup', el, 90, 10); tap(el); expect(hits).not.toHaveBeenCalled(); });
  it('respects the off switch', () => { store.saveOrbit({ enabled: false, mode: 'auto' }); const el = document.getElementById('bg'); tap(el); tap(el); expect(hits).not.toHaveBeenCalled(); });
});

describe('<Orbit> (flat fallback)', () => {
  const setup = (route = 'feed') => { const navigate = vi.fn(), onClose = vi.fn(); render(<Orbit user={user} route={route} navigate={navigate} onClose={onClose} />); return { navigate, onClose }; };

  it('shows every module and is an accessible dialog', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'CHEX Orbit' })).toBeTruthy();
    for (const l of ['Home', 'Messages', 'Codex', 'Reels', 'Gallery', 'Profile', 'Alerts', 'Search']) expect(screen.getByRole('button', { name: new RegExp(`^${l}\\.`) })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Settings' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
  });
  it('shows unread badges from the server', async () => {
    setup();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Messages\..*3 new/ })).toBeTruthy());
  });
  it('expands a card into a live workspace and opens the module', async () => {
    const { navigate, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Messages\./ }));
    expect(screen.getByRole('region', { name: 'Messages workspace' })).toBeTruthy();
    await screen.findByText('hello there');
    fireEvent.click(screen.getByRole('button', { name: /Open Messages/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith('messages', undefined);
  });
  it('opens a chat straight from the workspace', async () => {
    const { navigate } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Messages\./ }));
    fireEvent.click((await screen.findAllByText('Amy'))[0]);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('messages', 'amy'));
  });
  it('Gallery and Profile open the signed-in user\'s profile', async () => {
    const { navigate } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Gallery\./ }));
    fireEvent.click(screen.getByRole('button', { name: /Open Gallery/ }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('profile', 'me'));
  });
  it('Codex opens the Codex bar instead of a page', async () => {
    const got = vi.fn(); window.addEventListener('chex:codex-open', e => got(e.detail));
    const { navigate } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Codex\./ }));
    fireEvent.click(screen.getByRole('button', { name: /Open Codex/ }));
    await waitFor(() => expect(got).toHaveBeenCalledWith({ mode: 'mini' }));
    expect(navigate).not.toHaveBeenCalled();
  });
  it('satellite cards navigate', async () => {
    const { navigate } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Games' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('games'));
  });
  it('Escape collapses the workspace first, then closes Orbit', async () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Reels\./ }));
    const dlg = screen.getByRole('dialog');
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(screen.queryByRole('region')).toBeNull(); expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dlg, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
  it('the orb opens a radial menu whose actions fire gestures', async () => {
    const got = vi.fn(); window.addEventListener(gestures.GESTURE_EVENT, e => got(e.detail.action));
    setup();
    const hub = screen.getByRole('button', { name: 'Quick actions' });
    expect(hub.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(hub, { key: 'Enter' });
    expect(hub.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Voice search' }));
    await waitFor(() => expect(got).toHaveBeenCalledWith('voiceSearch'));
  });
  it('flat mode shows no 3D ring transform and respects reduced motion', () => {
    setup();
    const root = screen.getByRole('dialog');
    expect(root.className).toContain('ob-flat'); expect(root.className).toContain('ob-still');
    expect(screen.getByRole('button', { name: /3D/ }).disabled).toBe(true);
  });
});
