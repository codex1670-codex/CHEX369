import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

const api = vi.hoisted(() => ({ reactPost: vi.fn(), unreactPost: vi.fn(), like: vi.fn(), unlike: vi.fn() }));
vi.mock('../src/api.js', () => ({ api }));
vi.mock('../src/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'me', username: 'me' } }) }));
vi.mock('../src/codexContext.js', () => ({ updateCodexContext: vi.fn() }));
vi.mock('../src/components/EditedMedia.jsx', () => ({ default: () => <div data-testid="media" /> }));
vi.mock('../src/components/FullscreenMediaViewer.jsx', () => ({ default: () => <div data-testid="viewer" /> }));
vi.mock('../src/components/Avatar.jsx', () => ({ default: () => null }));

const { default: PostCard } = await import('../src/components/PostCard.jsx');

const post = (over = {}) => ({
  id: 'p1', caption: 'hello', mediaUrl: '/x.jpg', mediaType: 'image', edits: null, audience: 'public',
  likeCount: 0, commentCount: 0, likedByMe: false, savedByMe: false, reactions: [],
  author: { id: 'u2', username: 'amy', displayName: 'Amy' }, createdAt: new Date().toISOString(), ...over,
});

beforeEach(() => {
  cleanup(); localStorage.clear(); vi.useFakeTimers();
  Object.values(api).forEach(f => f.mockReset());
  globalThis.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
});
afterEach(() => vi.useRealTimers());

const longPress = (el) => { fireEvent.pointerDown(el, { clientX: 5, clientY: 5 }); act(() => { vi.advanceTimersByTime(500); }); fireEvent.pointerUp(el); };

describe('post reactions', () => {
  it('long-pressing the photo/video opens the top-10 picker, and picking one reacts', async () => {
    api.reactPost.mockResolvedValue({ post: post({ reactions: [{ emoji: '🔥', count: 1, mine: true }] }) });
    render(<PostCard post={post()} />);
    longPress(screen.getByTestId('media').parentElement);
    const group = screen.getByRole('group', { name: 'Quick reactions' });
    expect(group.querySelectorAll('button')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'React 🔥' }));
    await act(async () => { await Promise.resolve(); });
    expect(api.reactPost).toHaveBeenCalledWith('p1', '🔥');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /🔥 1, yours/ })).toBeTruthy();
  });

  it('a short tap does not open the picker', () => {
    render(<PostCard post={post()} />);
    const el = screen.getByTestId('media').parentElement;
    fireEvent.pointerDown(el, { clientX: 5, clientY: 5 });
    act(() => { vi.advanceTimersByTime(150); });
    fireEvent.pointerUp(el);
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dragging a finger (scrolling) cancels the long press', () => {
    render(<PostCard post={post()} />);
    const el = screen.getByTestId('media').parentElement;
    fireEvent.pointerDown(el, { clientX: 5, clientY: 5 });
    fireEvent.pointerMove(el, { clientX: 5, clientY: 60 });
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses my customized top-10 and lets me remove my reaction', async () => {
    const mine = ['🐶', '🐱', '🍕', '☕', '⚽', '🚀', '💯', '✨', '👻', '💀'];
    localStorage.setItem('chexQuickReactions', JSON.stringify(mine));
    api.unreactPost.mockResolvedValue({ post: post() });
    render(<PostCard post={post({ reactions: [{ emoji: '🍕', count: 1, mine: true }] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'React with an emoji' }));
    expect(screen.getByRole('button', { name: 'React 🐶' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove my reaction' }));
    await act(async () => { await Promise.resolve(); });
    expect(api.unreactPost).toHaveBeenCalledWith('p1');
  });
});
