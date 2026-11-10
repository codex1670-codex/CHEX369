import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

const api = vi.hoisted(() => ({
  stickies: vi.fn(), ringingStickies: vi.fn(), addSticky: vi.fn(), updateSticky: vi.fn(),
  snoozeSticky: vi.fn(), dismissSticky: vi.fn(), deleteSticky: vi.fn(),
}));
const handlers = vi.hoisted(() => ({}));
const voice = vi.hoisted(() => ({ speakReminder: vi.fn(), on: true }));
vi.mock('../src/api.js', () => ({ api }));
vi.mock('../src/socket.js', () => ({ getSocket: () => ({ on: (ev, fn) => { handlers[ev] = fn; }, off: () => {} }) }));
vi.mock('../src/stickyVoice.js', () => ({ speakReminder: voice.speakReminder, stickyVoiceOn: () => voice.on, setStickyVoice: (v) => { voice.on = v; return v; } }));

const { default: Stickies, whenLabel } = await import('../src/pages/Stickies.jsx');
const { default: StickyAlerts } = await import('../src/components/StickyAlerts.jsx');

const note = (o = {}) => ({ id: 'n1', text: 'Call mom', color: 'yellow', remindAt: new Date(Date.now() + 3600e3).toISOString(), repeat: 'none', done: false, ringing: false, snoozeUntil: null, lastFiredAt: null, ...o });

beforeEach(() => {
  cleanup();
  Object.values(api).forEach(f => f.mockReset());
  voice.speakReminder.mockReset(); voice.on = true;
  Object.keys(handlers).forEach(k => delete handlers[k]);
  api.stickies.mockResolvedValue({ notes: [note()] });
  api.ringingStickies.mockResolvedValue({ notes: [] });
});
afterEach(() => cleanup());

describe('Sticky notes page', () => {
  it('shows notes with their time, adds a note with a reminder time, and can mark one done', async () => {
    api.addSticky.mockResolvedValue({ note: note({ id: 'n2', text: 'Buy milk' }) });
    api.updateSticky.mockResolvedValue({ note: note({ done: true }) });
    render(<Stickies />);
    await screen.findByText('Call mom');
    expect(screen.getByText(/⏰ Today|⏰ Tomorrow/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('New sticky note'), { target: { value: 'Buy milk' } });
    fireEvent.click(screen.getByRole('button', { name: 'In 10 min' }));
    fireEvent.click(screen.getByRole('button', { name: /Add note/ }));
    await waitFor(() => expect(api.addSticky).toHaveBeenCalledTimes(1));
    const body = api.addSticky.mock.calls[0][0];
    expect(body.text).toBe('Buy milk');
    const delta = Date.parse(body.remindAt) - Date.now();
    expect(delta).toBeGreaterThan(9 * 60000);   // never earlier than 10 minutes (rounded up to the next minute)
    expect(delta).toBeLessThanOrEqual(11 * 60000);
    expect(body.repeat).toBe('none');

    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(api.updateSticky).toHaveBeenCalledWith('n1', { done: true }));
  });

  it('cannot add an empty note; voice switch and test voice work', async () => {
    render(<Stickies />);
    await screen.findByText('Call mom');
    expect(screen.getByRole('button', { name: /Add note/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByText('🔇 Voice reminders off')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Test voice/ }));
    expect(voice.speakReminder).toHaveBeenCalledWith(expect.any(String), { force: true });
  });

  it('whenLabel reads naturally', () => {
    const now = new Date(2026, 9, 31, 10, 0);
    expect(whenLabel(new Date(2026, 9, 31, 17, 0).toISOString(), now)).toMatch(/^Today, /);
    expect(whenLabel(new Date(2026, 10, 1, 9, 0).toISOString(), now)).toMatch(/^Tomorrow, /);
    expect(whenLabel(null, now)).toBe('');
  });
});

describe('Ringing reminder alert', () => {
  it('speaks a reminder the moment the server says it is due, and Done / Snooze act on it', async () => {
    api.updateSticky.mockResolvedValue({}); api.snoozeSticky.mockResolvedValue({});
    render(<StickyAlerts onOpen={() => {}} />);
    await waitFor(() => expect(api.ringingStickies).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();

    act(() => handlers['sticky:due'](note({ ringing: true, lastFiredAt: '2026-10-31T10:00:00Z' })));
    expect(await screen.findByText('Call mom')).toBeTruthy();
    expect(voice.speakReminder).toHaveBeenCalledTimes(1);
    expect(voice.speakReminder).toHaveBeenCalledWith('Call mom');

    act(() => handlers['sticky:due'](note({ ringing: true, lastFiredAt: '2026-10-31T10:00:00Z' })));   // same ring again → not read twice
    expect(voice.speakReminder).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Snooze 10 min/ }));
    await waitFor(() => expect(api.snoozeSticky).toHaveBeenCalledWith('n1', 10));
    expect(screen.queryByText('Call mom')).toBeNull();
  });

  it('picks up reminders that rang while the app was closed (poll on open) and Done finishes them', async () => {
    api.ringingStickies.mockResolvedValue({ notes: [note({ id: 'late', text: 'Missed one', ringing: true, lastFiredAt: '2026-10-31T09:00:00Z' })] });
    api.updateSticky.mockResolvedValue({});
    render(<StickyAlerts onOpen={() => {}} />);
    await screen.findByText('Missed one');
    expect(voice.speakReminder).toHaveBeenCalledWith('Missed one');
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    await waitFor(() => expect(api.updateSticky).toHaveBeenCalledWith('late', { done: true }));
    expect(screen.queryByText('Missed one')).toBeNull();
  });
});
