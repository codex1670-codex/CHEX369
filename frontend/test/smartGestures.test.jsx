import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

const api = vi.hoisted(() => ({ conversations: vi.fn(), getFollowing: vi.fn(), searchUsers: vi.fn(), shareItem: vi.fn(), getFollowers: vi.fn() }));
vi.mock('../src/api.js', () => ({ api }));
vi.mock('../src/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'me', username: 'me', displayName: 'Me' } }) }));
vi.mock('../src/components/Avatar.jsx', () => ({ default: ({ user }) => <i data-testid="av">{user?.displayName}</i> }));

const store = await import('../src/gestures/gestureStore.js');
const { default: QuickShare, ringGeometry, nearestSlot } = await import('../src/gestures/QuickShare.jsx');
const { default: SmartGestures } = await import('../src/gestures/SmartGestures.jsx');
const { default: VoiceSearch } = await import('../src/gestures/VoiceSearch.jsx');
const { useShareGesture } = await import('../src/gestures/useShareGesture.js');

const person = (id, name) => ({ id, username: name, displayName: name[0].toUpperCase() + name.slice(1) });
const convo = (id, other) => ({ id: `c${id}`, type: 'direct', name: null, participants: [person('me', 'me'), other] });

beforeEach(() => {
  cleanup(); localStorage.clear(); store.clearPeopleCache();
  Object.values(api).forEach(f => f.mockReset());
  api.conversations.mockResolvedValue({ conversations: [convo(1, person('a', 'amy')), convo(2, person('b', 'ben')), { id: 'g', type: 'group', name: 'Gang', participants: [] }, convo(3, person('c', 'cat'))] });
  api.getFollowing.mockResolvedValue({ users: [person('d', 'dan'), person('e', 'eve'), person('f', 'fay')] });
  vi.useRealTimers();
});
afterEach(() => vi.useRealTimers());

describe('gesture settings', () => {
  it('has exactly 10 gestures with the requested defaults', () => {
    expect(store.GESTURES).toHaveLength(10);
    const { map } = store.loadGestures();
    expect(map.shareHold).toBe('quickShare');
    expect(map.searchHold).toBe('voiceSearch');
    expect(map.shake).toBe('codexMini');
  });
  it('saves a change, ignores junk, and refuses share-only actions on non-share gestures', () => {
    store.setGestureAction('shake', 'go:reels');
    expect(store.loadGestures().map.shake).toBe('go:reels');
    store.setGestureAction('searchHold', 'quickShare');   // needs a post/reel, not allowed here
    expect(store.loadGestures().map.searchHold).toBe('voiceSearch');
    localStorage.setItem('chex.gestures', '{"map":{"shake":"nope"}}');
    expect(store.loadGestures().map.shake).toBe('codexMini');
    localStorage.setItem('chex.gestures', 'not json');
    expect(store.loadGestures().map.shareHold).toBe('quickShare');
  });
  it('fireGesture emits the event with the action, and does nothing for "none"', () => {
    const got = vi.fn(); window.addEventListener(store.GESTURE_EVENT, e => got(e.detail));
    store.setGestureAction('homeHold', 'none');
    expect(store.fireGesture('homeHold')).toBe(false);
    expect(got).not.toHaveBeenCalled();
    store.setGestureAction('homeHold', 'voiceSearch');
    expect(store.fireGesture('homeHold', { a: 1 })).toBe(true);
    expect(got).toHaveBeenCalledWith({ gestureId: 'homeHold', action: 'voiceSearch', ctx: { a: 1 } });
  });
  it('double tap fires only on the second quick tap', () => {
    const got = vi.fn(); window.addEventListener(store.GESTURE_EVENT, e => got(e.detail.action));
    expect(store.registerTap('homeDouble')).toBe(false);
    expect(store.registerTap('homeDouble')).toBe(true);
    expect(got).toHaveBeenCalledWith('scrollTop');
  });
});

describe('top 5 people', () => {
  it('auto mode: recent 1:1 chats first (groups skipped), then people you follow, never yourself, max 5', async () => {
    const list = await store.loadTopPeople(api, { id: 'me', username: 'me' });
    expect(list.map(u => u.username)).toEqual(['amy', 'ben', 'cat', 'dan', 'eve']);
  });
  it('custom mode puts your picks first', async () => {
    store.saveGestures({ ...store.loadGestures(), people: { mode: 'custom', list: [person('z', 'zed')] } });
    const list = await store.loadTopPeople(api, { id: 'me', username: 'me' });
    expect(list.map(u => u.username).slice(0, 2)).toEqual(['zed', 'amy']);
    expect(list).toHaveLength(5);
  });
});

describe('shake detector', () => {
  const motion = (x) => { const e = new Event('devicemotion'); e.accelerationIncludingGravity = { x, y: 0, z: 9.8 }; window.dispatchEvent(e); };
  it('fires after three hard jolts, not after a gentle move', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    const onShake = vi.fn(); const stop = store.startShakeDetector(onShake, () => 22);
    motion(0); vi.advanceTimersByTime(100); motion(3); vi.advanceTimersByTime(100); motion(1);
    expect(onShake).not.toHaveBeenCalled();
    for (const v of [30, -30, 30, -30]) { vi.advanceTimersByTime(120); motion(v); }
    expect(onShake).toHaveBeenCalledTimes(1);
    for (const v of [30, -30, 30, -30]) { vi.advanceTimersByTime(120); motion(v); }
    expect(onShake).toHaveBeenCalledTimes(1);   // quiet period
    stop();
  });
});

describe('quick-send circle', () => {
  it('lays out 5 profiles around a ring that stays on screen', () => {
    const g = ringGeometry(10, 790, 390, 800);
    expect(g.slots).toHaveLength(5);
    g.slots.forEach(s => { expect(s.x).toBeGreaterThan(0); expect(s.x).toBeLessThan(390); expect(s.y).toBeGreaterThan(0); expect(s.y).toBeLessThan(800); });
    expect(nearestSlot(g.slots[2], g.slots)).toBe(2);
    expect(nearestSlot({ x: g.cx, y: g.cy }, g.slots)).toBe(-1);
  });

  it('dragging the video onto a profile and releasing sends it to that person', async () => {
    api.shareItem.mockResolvedValue({ results: [{ username: 'amy', status: 'sent' }] });
    const onClose = vi.fn();
    render(<QuickShare item={{ kind: 'reel', id: 'r9', x: 200, y: 700, held: true }} me={{ id: 'me', username: 'me' }} onClose={onClose} onOpenSheet={vi.fn()} onOpenSettings={vi.fn()} />);
    await screen.findByRole('button', { name: 'Send to Amy' });
    const g = ringGeometry(200, 700, window.innerWidth, window.innerHeight);
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: g.slots[0].x + 5, clientY: g.slots[0].y + 5 })); });
    await screen.findByText(/Release to send to Amy/);
    act(() => { window.dispatchEvent(new MouseEvent('pointerup', { clientX: g.slots[0].x, clientY: g.slots[0].y })); });
    await waitFor(() => expect(api.shareItem).toHaveBeenCalledWith('reel', 'r9', ['amy'], ''));
    await screen.findByText(/Sent to Amy/);
  });

  it('releasing on empty space keeps it open, and tapping a profile then sends', async () => {
    api.shareItem.mockResolvedValue({ results: [{ username: 'ben', status: 'message_request' }] });
    render(<QuickShare item={{ kind: 'post', id: 'p1', x: 200, y: 700, held: true }} me={{ id: 'me', username: 'me' }} onClose={vi.fn()} onOpenSheet={vi.fn()} onOpenSettings={vi.fn()} />);
    await screen.findByRole('button', { name: 'Send to Ben' });
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 2, clientY: 2 })); window.dispatchEvent(new MouseEvent('pointerup', { clientX: 2, clientY: 2 })); });
    expect(api.shareItem).not.toHaveBeenCalled();
    await screen.findByText('Tap a profile to send');
    fireEvent.click(screen.getByRole('button', { name: 'Send to Ben' }));
    await screen.findByText(/as a message request/);
  });

  it('shows an error and lets you try again when sending fails', async () => {
    api.shareItem.mockRejectedValueOnce(new Error('Nope')).mockResolvedValueOnce({ results: [{ username: 'amy', status: 'sent' }] });
    render(<QuickShare item={{ kind: 'post', id: 'p1', held: false }} me={{ id: 'me', username: 'me' }} onClose={vi.fn()} onOpenSheet={vi.fn()} onOpenSettings={vi.fn()} />);
    await screen.findByRole('button', { name: 'Send to Amy' });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Amy' }));
    await screen.findByText('Nope');
    fireEvent.click(screen.getByRole('button', { name: 'Send to Amy' }));
    await screen.findByText(/Sent to Amy/);
  });
});

describe('Share button hold', () => {
  function Btn({ onClick }) { const p = useShareGesture({ kind: 'post', id: 'p7', thumb: '/x.jpg' }); return <button {...p} onClick={onClick}>Share</button>; }
  it('a tap still clicks; a hold fires the gesture and swallows the click', () => {
    vi.useFakeTimers();
    const got = vi.fn(); window.addEventListener(store.GESTURE_EVENT, e => got(e.detail));
    const onClick = vi.fn();
    render(<Btn onClick={onClick} />);
    const b = screen.getByText('Share');
    fireEvent.pointerDown(b, { clientX: 5, clientY: 5 }); fireEvent.pointerUp(b); fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1); expect(got).not.toHaveBeenCalled();
    fireEvent.pointerDown(b, { clientX: 5, clientY: 5 }); act(() => { vi.advanceTimersByTime(400); });
    expect(got).toHaveBeenCalledWith(expect.objectContaining({ action: 'quickShare', ctx: expect.objectContaining({ kind: 'post', id: 'p7', held: true }) }));
    fireEvent.pointerUp(b); fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('does nothing special when the gesture is switched off', () => {
    vi.useFakeTimers(); store.setGestureAction('shareHold', 'none');
    const got = vi.fn(); window.addEventListener(store.GESTURE_EVENT, e => got(e.detail));
    render(<Btn onClick={vi.fn()} />);
    fireEvent.pointerDown(screen.getByText('Share')); act(() => { vi.advanceTimersByTime(600); });
    expect(got).not.toHaveBeenCalled();
  });
});

describe('Voice search', () => {
  it('searches what it hears', async () => {
    let inst;
    window.isSecureContext = true;
    window.webkitSpeechRecognition = class { constructor() { inst = this; } start() { this.onstart?.(); } abort() {} };
    const onSearch = vi.fn();
    render(<VoiceSearch onSearch={onSearch} onClose={vi.fn()} />);
    await waitFor(() => expect(inst).toBeTruthy());
    act(() => { inst.onresult({ results: [Object.assign([{ transcript: 'priya sharma' }], { isFinal: true })] }); });
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith('priya sharma'), { timeout: 1500 });
    delete window.webkitSpeechRecognition;
  });
  it('says so when the browser has no voice input, and Type instead still works', () => {
    const onSearch = vi.fn();
    render(<VoiceSearch onSearch={onSearch} onClose={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toMatch(/can't do voice input/);
    fireEvent.click(screen.getByRole('button', { name: /Type instead/ }));
    expect(onSearch).toHaveBeenCalledWith('');
  });
});

describe('Settings card', () => {
  it('lists the 10 gestures, changes the shake action, and picks custom people', async () => {
    api.searchUsers.mockResolvedValue({ users: [person('q', 'quin')] });
    render(<SmartGestures />);
    expect(document.querySelectorAll('[data-testid^="gesture-"]')).toHaveLength(10);
    fireEvent.change(screen.getByLabelText('Action for: Shake phone'), { target: { value: 'codexFull' } });
    expect(store.loadGestures().map.shake).toBe('codexFull');
    fireEvent.click(screen.getByRole('button', { name: /My five/ }));
    fireEvent.change(screen.getByLabelText('Search a person to add'), { target: { value: 'qu' } });
    fireEvent.click(await screen.findByRole('button', { name: /Quin/ }));
    expect(store.loadGestures().people).toMatchObject({ mode: 'custom', list: [{ username: 'quin' }] });
    // share-only actions are not offered on other gestures
    const opts = [...screen.getByLabelText('Action for: Hold Search icon').querySelectorAll('option')].map(o => o.value);
    expect(opts).not.toContain('quickShare'); expect(opts).toContain('voiceSearch');
  });
});
