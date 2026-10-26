import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  deletePost: vi.fn(), savePost: vi.fn(), unsavePost: vi.fn(), getFollowing: vi.fn(), getFollowers: vi.fn(), searchUsers: vi.fn(),
  createGroup: vi.fn(), renameGroup: vi.fn(), removeGroupMember: vi.fn(), muteChat: vi.fn(), unmuteChat: vi.fn(), deleteChat: vi.fn(), addGroupMembers: vi.fn(),
}));
vi.mock('../src/api.js', () => ({ api }));
vi.mock('../src/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'me', username: 'me', displayName: 'Me' } }) }));
vi.mock('../src/codexContext.js', () => ({ updateCodexContext: vi.fn() }));
vi.mock('../src/components/EditedMedia.jsx', () => ({ default: () => <div data-testid="media" /> }));
vi.mock('../src/components/FullscreenMediaViewer.jsx', () => ({ default: () => null }));
vi.mock('../src/components/Avatar.jsx', () => ({ default: () => null }));

const { default: ActionSheet, ConfirmSheet } = await import('../src/components/ActionSheet.jsx');
const { default: PostCard } = await import('../src/components/PostCard.jsx');
const { NewGroupSheet, GroupInfoSheet, groupTitle } = await import('../src/components/GroupSheets.jsx');

const person = (id, name, role) => ({ id, username: name, displayName: name.toUpperCase(), role });
const post = (over = {}) => ({
  id: 'p1', caption: 'hello', mediaUrl: null, mediaType: null, edits: null, audience: 'public',
  likeCount: 0, commentCount: 0, likedByMe: false, savedByMe: false, reactions: [],
  author: { id: 'me', username: 'me', displayName: 'Me' }, createdAt: new Date().toISOString(), ...over,
});

beforeEach(() => {
  cleanup(); Object.values(api).forEach(f => f.mockReset());
  globalThis.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
  api.getFollowing.mockResolvedValue({ users: [person('a', 'amy'), person('b', 'ben')] });
  api.getFollowers.mockResolvedValue({ users: [person('c', 'cat')] });
  api.searchUsers.mockResolvedValue({ users: [] });
});

describe('ActionSheet / ConfirmSheet', () => {
  it('runs the tapped action and closes; Escape and Cancel close without acting', () => {
    const onClose = vi.fn(), onClick = vi.fn(), other = vi.fn();
    render(<ActionSheet title="Chat" onClose={onClose} actions={[{ key: 'a', label: 'Mute', onClick }, false, { key: 'b', label: 'Block', danger: true, onClick: other }]} />);
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    fireEvent.click(screen.getByRole('menuitem', { name: /Mute/ }));
    expect(onClose).toHaveBeenCalledTimes(1); expect(onClick).toHaveBeenCalledTimes(1); expect(other).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' }); expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('confirm sheet disables both buttons while busy', () => {
    const onConfirm = vi.fn();
    render(<ConfirmSheet title="Delete chat?" confirmLabel="Delete" busy onConfirm={onConfirm} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Please wait…' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(true);
  });
});

describe('post delete', () => {
  it('my post: ⋯ → Delete → confirm calls the API, tells the page, and removes the card', async () => {
    api.deletePost.mockResolvedValue({ ok: true });
    const onDeleted = vi.fn();
    const { container } = render(<PostCard post={post()} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));
    expect(api.deletePost).not.toHaveBeenCalled();           // asks first
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deletePost).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('p1'));
    expect(container.querySelector('.post-card')).toBeNull();
  });

  it("someone else's post offers Report, never Delete or Edit", () => {
    render(<PostCard post={post({ author: { id: 'u2', username: 'amy', displayName: 'Amy' } })} />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Edit/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Report/ })).toBeTruthy();
  });

  it('cancelling the confirmation keeps the post', () => {
    render(<PostCard post={post()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.deletePost).not.toHaveBeenCalled();
    expect(screen.getByText('hello')).toBeTruthy();
  });
});

describe('group chat sheets', () => {
  it('New group needs 2 people, then creates with the name and picked usernames', async () => {
    api.createGroup.mockResolvedValue({ conversation: { id: 'g1' } });
    const onCreated = vi.fn();
    render(<NewGroupSheet onClose={() => {}} onCreated={onCreated} />);
    await screen.findByText('AMY');
    const create = screen.getByRole('button', { name: 'Create' });
    expect(create.disabled).toBe(true);
    fireEvent.click(screen.getByText('AMY'));
    expect(create.disabled).toBe(true);                       // one is not enough
    fireEvent.click(screen.getByText('CAT'));
    expect(create.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Trip' } });
    fireEvent.click(create);
    await waitFor(() => expect(api.createGroup).toHaveBeenCalledWith('Trip', ['amy', 'cat']));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'g1' }));
  });

  const convo = (myRole) => ({ id: 'g1', type: 'group', name: 'Trip', muted: false, myRole,
    participants: [person('me', 'me', myRole), person('a', 'amy', 'admin'), person('b', 'ben', 'member')] });

  it('admins see rename / add / remove; members only see mute and leave', () => {
    const { unmount } = render(<GroupInfoSheet convo={convo('admin')} onClose={() => {}} onChanged={() => {}} onLeft={() => {}} />);
    expect(screen.getByText('Rename group')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add people/ })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(2);   // not myself
    unmount();
    render(<GroupInfoSheet convo={convo('member')} onClose={() => {}} onChanged={() => {}} onLeft={() => {}} />);
    expect(screen.queryByText('Rename group')).toBeNull();
    expect(screen.queryByRole('button', { name: /Add people/ })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /^Remove / })).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Mute/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Leave group' })).toBeTruthy();
  });

  it('leaving asks first, then calls deleteChat and reports it', async () => {
    api.deleteChat.mockResolvedValue({ ok: true, left: true });
    const onLeft = vi.fn();
    render(<GroupInfoSheet convo={convo('member')} onClose={() => {}} onChanged={() => {}} onLeft={onLeft} />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave group' }));
    expect(api.deleteChat).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(api.deleteChat).toHaveBeenCalledWith('g1'));
    await waitFor(() => expect(onLeft).toHaveBeenCalledWith('g1'));
  });

  it('title falls back to member names when the group has no name', () => {
    expect(groupTitle({ name: null, participants: [person('me', 'me'), person('a', 'amy'), person('b', 'ben')] }, 'me')).toBe('AMY, BEN');
    expect(groupTitle({ name: 'Trip', participants: [] }, 'me')).toBe('Trip');
  });
});
