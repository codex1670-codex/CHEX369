import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ privateStatus: vi.fn(), privateSetup: vi.fn(), privateEnter: vi.fn(), privateGallery: vi.fn() }));
const priv = vi.hoisted(() => ({ token: null }));
vi.mock('../src/api.js', () => ({ api, setPrivateSession: (t) => { priv.token = t; }, inPrivateSpace: () => !!priv.token }));
vi.mock('../src/socket.js', () => ({ reconnectSocket: vi.fn() }));
vi.mock('../src/AuthContext.jsx', async () => {
  const { createContext } = await import('react');
  return { AuthContext: createContext({ user: { id: 'u1', username: 'ann' }, setUser: () => {}, logout: async () => {} }) };
});
vi.mock('../src/pages/Feed.jsx', () => ({ default: () => <div>FEED</div> }));
vi.mock('../src/pages/Search.jsx', () => ({ default: () => <div>SEARCH</div> }));
vi.mock('../src/pages/Reels.jsx', () => ({ default: () => <div>REELS</div> }));
vi.mock('../src/pages/Messages.jsx', () => ({ default: () => <div>MESSAGES</div> }));
vi.mock('../src/pages/Profile.jsx', () => ({ default: ({ username }) => <div>PROFILE {username}</div> }));

const { default: PrivateSpace } = await import('../src/pages/PrivateSpace.jsx');
const session = { token: 'T', user: { id: 's1', username: 'ann.secret', displayName: 'Ann S' } };

beforeEach(() => { cleanup(); Object.values(api).forEach(f => f.mockReset()); priv.token = null; api.privateGallery.mockResolvedValue({ items: [] }); });
afterEach(() => cleanup());

describe('Private space', () => {
  it('asks for the password before showing anything, and shows nothing for a wrong one', async () => {
    api.privateStatus.mockResolvedValue({ exists: true });
    api.privateEnter.mockRejectedValueOnce(new Error('Wrong password.'));
    render(<PrivateSpace />);
    await screen.findByRole('heading', { name: 'Private space' });
    expect(screen.queryByText('FEED')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByText('Wrong password.');
    expect(screen.queryByText('FEED')).toBeNull();
    expect(priv.token).toBeNull();
  });

  it('unlocks with the right password: private tabs, own profile, and Lock closes it again', async () => {
    api.privateStatus.mockResolvedValue({ exists: true });
    api.privateEnter.mockResolvedValue(session);
    render(<PrivateSpace />);
    fireEvent.change(await screen.findByPlaceholderText('Password'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByText('FEED');
    expect(priv.token).toBe('T');
    for (const t of ['Home', 'Search', 'Reels', 'Chats', 'Gallery', 'Profile']) expect(screen.getByRole('tab', { name: new RegExp(t) })).toBeTruthy();
    // no Games, CHEX learn or Sticky notes in the second space
    for (const t of ['Games', 'Learn', 'Sticky']) expect(screen.queryByRole('tab', { name: new RegExp(t, 'i') })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Reels/ }));
    await screen.findByText('REELS');
    fireEvent.click(screen.getByRole('tab', { name: /Profile/ }));
    await screen.findByText('PROFILE ann.secret');
    fireEvent.click(screen.getByRole('tab', { name: /Gallery/ }));
    await screen.findByText(/Private gallery/);
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
    await screen.findByRole('button', { name: 'Unlock' });
    expect(priv.token).toBeNull();
  });

  it('first time: creates the private profile with its own username and password', async () => {
    api.privateStatus.mockResolvedValue({ exists: false });
    api.privateSetup.mockResolvedValue(session);
    render(<PrivateSpace />);
    await screen.findByText('Create your private space');
    fireEvent.change(screen.getByPlaceholderText('e.g. night.owl'), { target: { value: 'ann.secret' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'different' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create & open' }));
    await screen.findByText('The two passwords do not match.');
    expect(api.privateSetup).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create & open' }));
    await waitFor(() => expect(api.privateSetup).toHaveBeenCalledWith({ username: 'ann.secret', displayName: '', password: 'secret1' }));
    await screen.findByText('FEED');
  });
});
