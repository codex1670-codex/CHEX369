import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

const ME = { id: 'me', username: 'me', displayName: 'Me', avatarColor: '#7C5CFF' };
const person = (n) => ({ id: `id-${n}`, username: n, displayName: n.toUpperCase(), avatarColor: '#123456', since: '2026-10-01T00:00:00.000Z' });

const api = vi.hoisted(() => ({
  blockedUsers: vi.fn(), mutedUsers: vi.fn(), restrictedUsers: vi.fn(),
  unblock: vi.fn(), unmute: vi.fn(), unrestrict: vi.fn(), mute: vi.fn(), restrict: vi.fn(), block: vi.fn(), report: vi.fn(),
  storyArchive: vi.fn(), userHighlights: vi.fn(), getHighlight: vi.fn(), createHighlight: vi.fn(), editHighlight: vi.fn(), deleteHighlight: vi.fn(),
  getUser: vi.fn(), userPosts: vi.fn(() => Promise.resolve({ posts: [], nextCursor: null })), reelsHistory: vi.fn(), callHistory: vi.fn(), getStory: vi.fn(), storyViewers: vi.fn(),
}));
vi.mock('../src/api.js', () => ({ api, setTokens: vi.fn(), getStoredRefreshToken: () => null, onAuthFailure: vi.fn() }));
vi.mock('../src/AuthContext.jsx', () => ({ useAuth: () => ({ user: ME, setUser: vi.fn(), logout: vi.fn(), clearSession: vi.fn() }) }));
vi.mock('../src/presence.jsx', () => ({ useIsOnline: () => false, PresenceProvider: ({ children }) => children }));
vi.mock('../src/codexContext.js', () => ({ updateCodexContext: vi.fn(), setCodexContext: vi.fn() }));
// The studio header is heavy and unrelated: stand in for it, keeping its children (the relationship buttons).
vi.mock('../src/components/ProfileStudio.jsx', () => ({ default: ({ children }) => <div data-testid="studio">{children}</div> }));

import SafetyLists from '../src/components/SafetyLists.jsx';
import HighlightsRow from '../src/components/HighlightsRow.jsx';
import HighlightEditor from '../src/components/HighlightEditor.jsx';
import HistoryPanel from '../src/components/HistoryPanel.jsx';
import Profile from '../src/pages/Profile.jsx';

beforeEach(() => {
  cleanup();
  Object.values(api).forEach(f => f.mockReset());
  api.userPosts.mockResolvedValue({ posts: [], nextCursor: null });
  api.blockedUsers.mockResolvedValue({ users: [person('amy')] });
  api.mutedUsers.mockResolvedValue({ users: [person('bob'), person('cat')] });
  api.restrictedUsers.mockResolvedValue({ users: [] });
  for (const k of ['unblock', 'unmute', 'unrestrict', 'mute', 'restrict', 'block', 'report']) api[k].mockResolvedValue({ ok: true });
  api.getStory.mockResolvedValue({});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('Settings: blocked / muted / restricted', () => {
  it('shows each list with counts and lets me undo one', async () => {
    render(<SafetyLists onOpenProfile={vi.fn()} />);
    await screen.findByText('AMY');
    expect(screen.getByRole('tab', { name: /Blocked \(1\)/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Muted \(2\)/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Restricted \(0\)/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Unblock @amy' }));
    await waitFor(() => expect(api.unblock).toHaveBeenCalledWith('amy'));
    await screen.findByText('You haven’t blocked anyone.');
    expect(screen.getByRole('status').textContent).toBe('Unblocked @amy.');
    expect(screen.getByRole('tab', { name: /Blocked \(0\)/ })).toBeTruthy();
  });

  it('muted tab: unmute removes only that person; View opens their profile', async () => {
    const open = vi.fn();
    render(<SafetyLists onOpenProfile={open} />);
    await screen.findByText('AMY');
    fireEvent.click(screen.getByRole('tab', { name: /Muted/ }));
    await screen.findByText('BOB');
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[0]);
    expect(open).toHaveBeenCalledWith('bob');
    fireEvent.click(screen.getByRole('button', { name: 'Unmute @bob' }));
    await waitFor(() => expect(screen.queryByText('BOB')).toBeNull());
    expect(screen.getByText('CAT')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Unmuted @bob.');
  });

  it('blocked people have no "View" link (their profile is hidden), and an empty list says so', async () => {
    render(<SafetyLists onOpenProfile={vi.fn()} />);
    await screen.findByText('AMY');
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Restricted/ }));
    expect(await screen.findByText('You haven’t restricted anyone.')).toBeTruthy();
  });

  it('an API failure shows an error instead of an endless spinner', async () => {
    api.mutedUsers.mockRejectedValue(new Error('Network down'));
    render(<SafetyLists />);
    await screen.findByText('AMY');
    fireEvent.click(screen.getByRole('tab', { name: /Muted/ }));
    expect(await screen.findByText('Network down')).toBeTruthy();
  });

  it('a failed undo keeps the person in the list and says why', async () => {
    api.unblock.mockRejectedValue(new Error('Server said no'));
    render(<SafetyLists />);
    await screen.findByText('AMY');
    fireEvent.click(screen.getByRole('button', { name: 'Unblock @amy' }));
    await screen.findByText('Server said no');
    expect(screen.getByText('AMY')).toBeTruthy();
  });
});

const HL = { id: 'h1', title: 'Trip', storyCount: 2, cover: { storyId: 's1', mediaType: 'text', content: 'Beach day', background: '#ff0000' } };
const story = (id, text) => ({ id, mediaType: 'text', content: text, caption: '', background: '#7C5CFF', audience: 'everyone', createdAt: '2026-09-01T10:00:00.000Z', expiresAt: '2026-09-02T10:00:00.000Z', viewCount: 0, expired: true, highlightCount: 0, edits: null });

describe('profile highlights row', () => {
  it('others see highlights and open one in the story viewer', async () => {
    api.userHighlights.mockResolvedValue({ highlights: [HL] });
    api.getHighlight.mockResolvedValue({ highlight: { id: 'h1', title: 'Trip', isMine: false }, author: person('amy'), stories: [story('s1', 'Beach day'), story('s2', 'Sunset')] });
    render(<HighlightsRow username="amy" isSelf={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open highlight Trip' }));
    expect(await screen.findByText('AMY')).toBeTruthy();          // viewer header shows the author
    expect(screen.getAllByText('Beach day').length).toBeGreaterThan(0);
    expect(screen.queryByText('Delete')).toBeNull();              // not my story: no owner controls
    expect(screen.queryByRole('button', { name: 'New highlight' })).toBeNull();
  });

  it('renders nothing for someone else with no highlights', async () => {
    api.userHighlights.mockResolvedValue({ highlights: [] });
    const { container } = render(<HighlightsRow username="amy" isSelf={false} />);
    await waitFor(() => expect(api.userHighlights).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="highlights-row"]')).toBeNull();
  });

  it('on my own profile I get New + edit controls even with none yet', async () => {
    api.userHighlights.mockResolvedValue({ highlights: [] });
    render(<HighlightsRow username="me" isSelf />);
    expect(await screen.findByRole('button', { name: 'New highlight' })).toBeTruthy();
  });
});

describe('highlight editor', () => {
  it('creates a highlight from picked archive stories (and the chosen cover)', async () => {
    api.storyArchive.mockResolvedValue({ stories: [story('s1', 'One'), story('s2', 'Two'), story('s3', 'Three')] });
    api.createHighlight.mockResolvedValue({ highlight: { id: 'new1' } });
    api.editHighlight.mockResolvedValue({ highlight: { id: 'new1' } });
    const onSaved = vi.fn(), onClose = vi.fn();
    render(<HighlightEditor onClose={onClose} onSaved={onSaved} />);
    await screen.findByText('Two');
    expect(screen.getByRole('button', { name: 'Create highlight' }).disabled).toBe(true); // nothing picked yet
    const tiles = screen.getAllByRole('button', { name: /story from/ });
    fireEvent.click(tiles[0]); fireEvent.click(tiles[1]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Use as cover' })[1]);          // cover = second pick
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Holiday ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create highlight' }));
    await waitFor(() => expect(api.createHighlight).toHaveBeenCalledWith({ title: 'Holiday', storyIds: ['s1', 's2'] }));
    await waitFor(() => expect(api.editHighlight).toHaveBeenCalledWith('new1', { coverStoryId: 's2' }));
    expect(onSaved).toHaveBeenCalled(); expect(onClose).toHaveBeenCalled();
  });

  it('refuses to save without a name and tells me', async () => {
    api.storyArchive.mockResolvedValue({ stories: [story('s1', 'One')] });
    render(<HighlightEditor onClose={vi.fn()} />);
    await screen.findByText('One');
    fireEvent.click(screen.getAllByRole('button', { name: /story from/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Create highlight' }));
    expect(await screen.findByText('Give your highlight a name.')).toBeTruthy();
    expect(api.createHighlight).not.toHaveBeenCalled();
  });

  it('editing sends only what changed: rename, one story added, one removed; delete asks first', async () => {
    api.storyArchive.mockResolvedValue({ stories: [story('s1', 'One'), story('s2', 'Two'), story('s3', 'Three')] });
    api.getHighlight.mockResolvedValue({ highlight: { id: 'h1', title: 'Trip', isMine: true }, author: { ...person('me'), username: 'me' }, stories: [story('s1', 'One'), story('s2', 'Two')] });
    api.userHighlights.mockResolvedValue({ highlights: [HL] });
    api.editHighlight.mockResolvedValue({ highlight: {} });
    api.deleteHighlight.mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    render(<HighlightEditor highlight={{ id: 'h1', title: 'Trip' }} onClose={onClose} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Name').value).toBe('Trip'));
    const tiles = await screen.findAllByRole('button', { name: /story from/ });
    expect(tiles.filter(t => t.getAttribute('aria-pressed') === 'true')).toHaveLength(2);
    fireEvent.click(tiles[1]);   // remove s2
    fireEvent.click(tiles[2]);   // add s3
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Trip 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.editHighlight).toHaveBeenCalledWith('h1', { title: 'Trip 2', addStoryIds: ['s3'], removeStoryIds: ['s2'], coverStoryId: 's1' }));

    cleanup();
    window.confirm.mockReturnValueOnce(false);
    render(<HighlightEditor highlight={{ id: 'h1', title: 'Trip' }} onClose={onClose} />);
    await screen.findAllByRole('button', { name: /story from/ });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete highlight' }));
    expect(api.deleteHighlight).not.toHaveBeenCalled();         // cancelled the confirm
    window.confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete highlight' }));
    await waitFor(() => expect(api.deleteHighlight).toHaveBeenCalledWith('h1'));
  });
});

describe('Settings: history', () => {
  it('stories archive marks expired vs live, then reels and calls tabs load', async () => {
    api.storyArchive.mockResolvedValue({ stories: [{ ...story('s1', 'Old one'), expired: true, highlightCount: 1 }, { ...story('s2', 'Fresh'), expired: false }] });
    api.reelsHistory.mockResolvedValue({ watched: [{ id: 'r1', caption: 'Funny cat', videoUrl: '/x.mp4', interactionAt: '2026-10-01T00:00:00Z' }], liked: [], saved: [], created: [] });
    api.callHistory.mockResolvedValue({ calls: [
      { id: 'c1', type: 'video', status: 'ended', callerId: 'me', startedAt: '2026-10-02T10:00:00Z', answeredAt: '2026-10-02T10:00:00Z', endedAt: '2026-10-02T10:01:05Z', wasMissed: false, participants: [ME, person('amy')] },
      { id: 'c2', type: 'voice', status: 'missed', callerId: 'id-bob', startedAt: '2026-10-03T10:00:00Z', wasMissed: true, participants: [ME, person('bob')] },
    ] });
    render(<HistoryPanel />);
    await screen.findByText('Expired'); expect(screen.getByText('Live')).toBeTruthy(); expect(screen.getByText('★ 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Reels/ }));
    await screen.findByText('Funny cat');
    fireEvent.click(screen.getByRole('button', { name: 'Liked' }));
    expect(await screen.findByText('Nothing here yet.')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Calls/ }));
    await screen.findByText('AMY');
    expect(screen.getByText(/Outgoing · 1:05/)).toBeTruthy();
    expect(screen.getByText(/Missed/)).toBeTruthy();
  });
});

describe('profile: mute / restrict / block', () => {
  const other = (extra = {}) => ({ id: 'id-amy', username: 'amy', displayName: 'Amy', isSelf: false, isFollowing: true, isMuted: false, isRestricted: false, followerCount: 0, followingCount: 0, postCount: 0, ...extra });
  const open = async (profile, props = {}) => {
    api.getUser.mockResolvedValue({ user: profile });
    api.userHighlights.mockResolvedValue({ highlights: [] });
    render(<Profile username="amy" onOpenMessage={vi.fn()} onOpenSettings={props.onOpenSettings} />);
    fireEvent.click(await screen.findByRole('button', { name: 'More options' }));
  };

  it('menu reflects what is already saved on the server', async () => {
    await open(other({ isMuted: true, isRestricted: true }));
    expect(screen.getByRole('menuitem', { name: /Unmute/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Unrestrict/ })).toBeTruthy();
    expect(screen.getByText('🔇 Muted')).toBeTruthy(); expect(screen.getByText('🚷 Restricted')).toBeTruthy();
  });

  it('mute then unmute flips the menu and the status chip', async () => {
    await open(other());
    fireEvent.click(screen.getByRole('menuitem', { name: /Mute/ }));
    await waitFor(() => expect(api.mute).toHaveBeenCalledWith('amy'));
    await screen.findByText('🔇 Muted');
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Unmute/ }));
    await waitFor(() => expect(api.unmute).toHaveBeenCalledWith('amy'));
    await waitFor(() => expect(screen.queryByText('🔇 Muted')).toBeNull());
  });

  it('restrict and unrestrict call the right endpoints', async () => {
    await open(other());
    fireEvent.click(screen.getByRole('menuitem', { name: /Restrict/ }));
    await waitFor(() => expect(api.restrict).toHaveBeenCalledWith('amy'));
    await screen.findByText('🚷 Restricted');
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Unrestrict/ }));
    await waitFor(() => expect(api.unrestrict).toHaveBeenCalledWith('amy'));
  });

  it('block asks first; cancelling does nothing; confirming shows an undo screen', async () => {
    const settings = vi.fn();
    await open(other(), { onOpenSettings: settings });
    window.confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('menuitem', { name: /Block/ }));
    expect(api.block).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Block/ }));
    await screen.findByText('You blocked @amy');
    expect(api.block).toHaveBeenCalledWith('amy');
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();   // profile is gone
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(settings).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Undo block' }));
    await waitFor(() => expect(api.unblock).toHaveBeenCalledWith('amy'));
    expect(await screen.findByRole('button', { name: 'More options' })).toBeTruthy();
  });

  it('my own profile has no relationship menu', async () => {
    api.getUser.mockResolvedValue({ user: other({ isSelf: true, username: 'me' }) });
    api.userHighlights.mockResolvedValue({ highlights: [] });
    render(<Profile username="me" onOpenMessage={vi.fn()} />);
    await screen.findByTestId('studio');
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
  });
});
