import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ getFollowing: vi.fn(), getFollowers: vi.fn(), searchUsers: vi.fn(), shareItem: vi.fn() }));
vi.mock('../src/api.js', () => ({ api }));
vi.mock('../src/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'me', username: 'me', displayName: 'Me' } }) }));
vi.mock('../src/components/Avatar.jsx', () => ({ default: () => null }));
vi.mock('../src/components/EditedMedia.jsx', () => ({ default: () => <div data-testid="media" /> }));

const { default: ShareSheet } = await import('../src/components/ShareSheet.jsx');
const { default: PostGrid } = await import('../src/components/PostGrid.jsx');

const u = (id, name) => ({ id, username: name, displayName: name.toUpperCase() });

beforeEach(() => {
  cleanup();
  Object.values(api).forEach(f => f.mockReset());
  api.getFollowing.mockResolvedValue({ users: [u('a', 'amy'), u('b', 'ben')] });
  api.getFollowers.mockResolvedValue({ users: [u('b', 'ben'), u('c', 'cat')] });
  api.searchUsers.mockResolvedValue({ users: [] });
});

describe('ShareSheet', () => {
  it('lists following and followers (no duplicates), filters by search, and sends to the people picked', async () => {
    api.shareItem.mockResolvedValue({ results: [{ username: 'amy', status: 'sent' }, { username: 'cat', status: 'message_request' }] });
    const onClose = vi.fn();
    render(<ShareSheet kind="reel" id="r1" onClose={onClose} />);
    await screen.findByText('AMY');
    expect(screen.getAllByText('BEN')).toHaveLength(1);
    expect(screen.getByText(/@ben · Mutual/)).toBeTruthy();
    expect(screen.getByText(/@cat · Follows you/)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Search people…'), { target: { value: 'ca' } });
    expect(screen.queryByText('AMY')).toBeNull();
    expect(screen.getByText('CAT')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Search people…'), { target: { value: '' } });

    fireEvent.click(screen.getByText('AMY'));
    fireEvent.click(screen.getByText('CAT'));
    fireEvent.click(screen.getByRole('button', { name: 'Send to 2 people' }));
    await waitFor(() => expect(api.shareItem).toHaveBeenCalledWith('reel', 'r1', ['amy', 'cat'], ''));
    await screen.findByText(/Sent to 1 chat · 1 will arrive as a message request/);
  });

  it('send is disabled until someone is picked, and you can pick your own notes', async () => {
    render(<ShareSheet kind="post" id="p1" onClose={vi.fn()} />);
    await screen.findByText('AMY');
    expect(screen.getByRole('button', { name: 'Pick who to send to' }).disabled).toBe(true);
    fireEvent.click(screen.getByText('Your notes (just you)'));
    expect(screen.getByRole('button', { name: 'Send to 1 person' }).disabled).toBe(false);
  });
});

describe('PostGrid', () => {
  it('shows one tile per post and opens the tapped post', () => {
    const open = vi.fn();
    const posts = [
      { id: 'p1', caption: 'a', mediaUrl: '/a.jpg', mediaType: 'image', likeCount: 1, commentCount: 0 },
      { id: 'p2', caption: 'just words', mediaUrl: null, mediaType: null, likeCount: 0, commentCount: 2 },
      { id: 'p3', caption: 'v', mediaUrl: '/v.mp4', mediaType: 'video', likeCount: 0, commentCount: 0 },
    ];
    render(<PostGrid posts={posts} onOpen={open} />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByText('just words')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button')[1]);
    expect(open).toHaveBeenCalledWith(posts[1]);
  });
});
