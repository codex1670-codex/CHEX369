import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  notesFeed: vi.fn(), noteMoods: vi.fn(), noteSongs: vi.fn(), createNote: vi.fn(), editNote: vi.fn(),
  deleteMyNote: vi.fn(), likeNote: vi.fn(), unlikeNote: vi.fn(), replyNote: vi.fn(),
}));
vi.mock('../src/api.js', () => ({ api }));
vi.mock('../src/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'me', username: 'me', displayName: 'Me' } }) }));
vi.mock('../src/components/Avatar.jsx', () => ({ default: () => null }));

const { default: NotesBar } = await import('../src/components/NotesBar.jsx');

// jsdom does not implement media playback: fake play/pause and fire the same events a browser would.
const paused = new WeakMap();
const plays = [];
let pauses = 0;
beforeEach(() => {
  cleanup(); plays.length = 0; pauses = 0;
  Object.values(api).forEach(f => f.mockReset());
  api.noteMoods.mockResolvedValue({ moods: ['none', 'happy'] });
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return paused.get(this) !== false; } });
  HTMLMediaElement.prototype.play = function () { plays.push(this.src); paused.set(this, false); this.dispatchEvent(new Event('play')); return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function () { pauses++; if (paused.get(this) === false) { paused.set(this, true); this.dispatchEvent(new Event('pause')); } };
});

const note = (over = {}) => ({
  id: 'n1', text: 'vibes', emoji: '🎧', mood: 'happy', audience: 'everyone', likeCount: 0, likedByMe: false,
  author: { id: 'u2', username: 'amy', displayName: 'Amy' },
  song: { id: 'itunes-1', title: 'Song One', artist: 'Artist', previewUrl: 'https://audio/1.m4a' }, ...over,
});
const mine = (over = {}) => note({ id: 'mine', text: 'mine', author: { id: 'me', username: 'me', displayName: 'Me' }, ...over });

describe('NotesBar music', () => {
  it('tapping a note autoplays its preview, shows Pause, and closing stops it', async () => {
    api.notesFeed.mockResolvedValue({ notes: [note()] });
    render(<NotesBar />);
    fireEvent.click(await screen.findByText(/vibes/));
    await waitFor(() => expect(plays).toEqual(['https://audio/1.m4a']));
    expect(await screen.findByRole('button', { name: /Pause/ })).toBeTruthy();
    const before = pauses;
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(pauses).toBeGreaterThan(before);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Pause/ })).toBeNull());
  });

  it('never autoplays just from loading the bar', async () => {
    api.notesFeed.mockResolvedValue({ notes: [note()] });
    render(<NotesBar />);
    await screen.findByText(/vibes/);
    expect(plays).toHaveLength(0);
  });

  it('a note whose song has no preview does not try to play', async () => {
    api.notesFeed.mockResolvedValue({ notes: [note({ song: { id: 'itunes-2', title: 'Quiet', artist: 'A', previewUrl: null } })] });
    render(<NotesBar />);
    fireEvent.click(await screen.findByText(/vibes/));
    expect(await screen.findByText('Preview unavailable')).toBeTruthy();
    expect(plays).toHaveLength(0);
  });

  it('picker preview button flips to pause as soon as it plays, and back when tapped again', async () => {
    api.notesFeed.mockResolvedValue({ notes: [] });
    api.noteSongs.mockResolvedValue({ songs: [{ id: 'itunes-9', title: 'Found', artist: 'B', artworkUrl: '', previewUrl: 'https://audio/9.m4a' }] });
    render(<NotesBar />);
    fireEvent.click(await screen.findByText('Your note'));
    fireEvent.click(screen.getByRole('button', { name: /Search real songs/ }));
    fireEvent.change(screen.getByPlaceholderText(/Search songs/), { target: { value: 'fou' } });
    await screen.findByText('Found', {}, { timeout: 2000 });
    expect(api.noteSongs).toHaveBeenLastCalledWith('fou', 'tamil');
    fireEvent.click(screen.getByTitle('Play preview'));
    await waitFor(() => expect(screen.getByTitle('Play preview').textContent).toBe('Ⅱ'));
    fireEvent.click(screen.getByTitle('Play preview'));
    await waitFor(() => expect(screen.getByTitle('Play preview').textContent).toBe('▶'));
  });

  it('editing my note keeps its song, and "No mood" is sent as cleared', async () => {
    api.notesFeed.mockResolvedValue({ notes: [mine()] });
    api.editNote.mockResolvedValue({ note: mine() });
    render(<NotesBar />);
    fireEvent.click(await screen.findByText(/mine/));
    fireEvent.click(screen.getByRole('button', { name: 'No mood' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.editNote).toHaveBeenCalled());
    const payload = api.editNote.mock.calls[0][0];
    expect(payload.songId).toBe('itunes-1');
    expect(payload.mood).toBeNull();
  });

  it('shows the server message instead of failing silently when saving fails', async () => {
    api.notesFeed.mockResolvedValue({ notes: [mine()] });
    api.editNote.mockRejectedValue(new Error('Pick a song from the list.'));
    render(<NotesBar />);
    fireEvent.click(await screen.findByText(/mine/));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Pick a song from the list.');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy(); // form stays open, button re-enabled
  });

  it('opens the picker on trending songs, flags trending/lyrics matches', async () => {
    api.notesFeed.mockResolvedValue({ notes: [] });
    api.noteSongs.mockImplementation(async (term) => (term
      ? { kind: 'search', songs: [{ id: 'itunes-5', title: 'Lyric Hit', artist: 'C', previewUrl: '', matchedBy: 'lyrics' }] }
      : { kind: 'trending', songs: [{ id: 'itunes-3', title: 'Hot Song', artist: 'D', previewUrl: '', trending: true, trendRank: 1 }] }));
    render(<NotesBar />);
    fireEvent.click(await screen.findByText('Your note'));
    fireEvent.click(screen.getByRole('button', { name: /Search real songs/ }));
    expect(await screen.findByText('Hot Song')).toBeTruthy();
    expect(screen.getByText(/Trending now/)).toBeTruthy();
    expect(api.noteSongs).toHaveBeenCalledWith('', 'tamil');
    fireEvent.change(screen.getByPlaceholderText(/lyrics line/), { target: { value: 'some lyric words here' } });
    expect(await screen.findByText('Lyric Hit', {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText(/lyrics match/)).toBeTruthy();
    expect(screen.queryByText(/Trending now/)).toBeNull();
  });
});
