import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  lifeItems: vi.fn(), addLifeItem: vi.fn(), updateLifeItem: vi.fn(), deleteLifeItem: vi.fn(), startFocusAlert: vi.fn(), stopFocusAlert: vi.fn(),
  stickies: vi.fn(), ringingStickies: vi.fn(), addSticky: vi.fn(), updateSticky: vi.fn(), snoozeSticky: vi.fn(), dismissSticky: vi.fn(), deleteSticky: vi.fn(),
}));
vi.mock('../src/api.js', () => ({ api }));
vi.mock('../src/socket.js', () => ({ getSocket: () => ({ on: () => {}, off: () => {} }) }));
vi.mock('../src/stickyVoice.js', () => ({ speakReminder: vi.fn(), stickyVoiceOn: () => true, setStickyVoice: (v) => v }));

const { default: MyLife } = await import('../src/pages/MyLife.jsx');
const U = await import('../src/lifeUtils.js');

const today = U.dateStr();
beforeEach(() => {
  cleanup(); localStorage.clear();
  Object.values(api).forEach(f => f.mockReset());
  api.lifeItems.mockResolvedValue({ items: [] });
  api.startFocusAlert.mockResolvedValue({ ok: true }); api.stopFocusAlert.mockResolvedValue({ ok: true });
  api.stickies.mockResolvedValue({ notes: [] });
  api.ringingStickies.mockResolvedValue({ notes: [] });
});
afterEach(() => cleanup());

describe('My life helpers', () => {
  it('habit streak counts back from today, or from yesterday if today is not ticked yet', () => {
    expect(U.habitStreak([today, U.addDays(today, -1), U.addDays(today, -2)], today)).toBe(3);
    expect(U.habitStreak([U.addDays(today, -1), U.addDays(today, -2)], today)).toBe(2);
    expect(U.habitStreak([U.addDays(today, -2)], today)).toBe(0);
    expect(U.bestStreak(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-10', '2026-10-11'])).toBe(3);
  });
  it('due dates become overdue / today / soon / ok, and done work is never urgent', () => {
    expect(U.dueState(U.addDays(today, -2), 'todo', today).tone).toBe('late');
    expect(U.dueState(today, 'doing', today).label).toBe('Due today');
    expect(U.dueState(U.addDays(today, 1), 'todo', today).tone).toBe('soon');
    expect(U.dueState(U.addDays(today, 9), 'todo', today).tone).toBe('ok');
    expect(U.dueState(U.addDays(today, -2), 'done', today).tone).toBe('none');
  });
  it('timetable weeks start on Monday and the timer formats as mm:ss', () => {
    expect(U.todayDayIndex(new Date(2026, 9, 31))).toBe(5);   // Saturday
    expect(U.todayDayIndex(new Date(2026, 10, 2))).toBe(0);   // Monday
    expect(U.mmss(25 * 60000)).toBe('25:00');
    expect(U.mmss(61_000)).toBe('01:01');
  });
});

describe('My life page', () => {
  it('lists all seven sections and opens on the planner', async () => {
    render(<MyLife />);
    const tabs = screen.getAllByRole('tab').map(t => t.textContent.replace(/^\S+\s/, ''));
    expect(tabs).toEqual(['Smart reminders', 'Alarm', 'Sticky notes', 'Daily planner', 'Study timetable', 'Assignments', 'Focus timer', 'Habit tracker']);
    expect(screen.getByRole('tab', { name: /Daily planner/ }).getAttribute('aria-selected')).toBe('true');
    await screen.findByText(/Nothing planned/);
  });

  it('planner: adds a task for the chosen day and ticks it off', async () => {
    api.addLifeItem.mockResolvedValue({ item: {} });
    api.updateLifeItem.mockResolvedValue({ item: {} });
    render(<MyLife />);
    await screen.findByText(/Nothing planned/);
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Revise maths' } });
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    await waitFor(() => expect(api.addLifeItem).toHaveBeenCalledWith('planner', expect.objectContaining({ title: 'Revise maths', date: today })));

    api.lifeItems.mockResolvedValue({ items: [{ id: 'p1', kind: 'planner', title: 'Revise maths', date: today, time: '', priority: 'med', done: false, createdAt: '' }] });
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    fireEvent.click(await screen.findByLabelText(/Mark "Revise maths" done/));
    await waitFor(() => expect(api.updateLifeItem).toHaveBeenCalledWith('p1', { done: true }));
  });

  it('smart reminders tab needs a time, then saves with it', async () => {
    api.addSticky.mockResolvedValue({ note: {} });
    render(<MyLife initialTab="reminders" />);
    fireEvent.change(await screen.findByLabelText('New sticky note'), { target: { value: 'Call mom' } });
    fireEvent.click(screen.getByRole('button', { name: /Add reminder/ }));
    expect(await screen.findByText(/Pick a time so CHEX knows/)).toBeTruthy();
    expect(api.addSticky).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'In 1 hour' }));
    fireEvent.click(screen.getByRole('button', { name: /Add reminder/ }));
    await waitFor(() => expect(api.addSticky).toHaveBeenCalledWith(expect.objectContaining({ text: 'Call mom', remindAt: expect.any(String) })));
  });

  it('smart reminders hides notes that have no time; sticky notes shows all', async () => {
    api.stickies.mockResolvedValue({ notes: [
      { id: 'a', text: 'Plain note', color: 'yellow', remindAt: null, repeat: 'none', done: false },
      { id: 'b', text: 'Timed one', color: 'pink', remindAt: new Date(Date.now() + 3600e3).toISOString(), repeat: 'none', done: false },
    ] });
    render(<MyLife initialTab="reminders" />);
    await screen.findByText('Timed one');
    expect(screen.queryByText('Plain note')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Sticky notes/ }));
    await screen.findByText('Plain note');
    expect(screen.getByText('Timed one')).toBeTruthy();
  });

  it('timetable: rejects nothing client-side but sends the day as a number', async () => {
    api.addLifeItem.mockResolvedValue({ item: {} });
    render(<MyLife initialTab="timetable" />);
    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'Physics' } });
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to timetable/ }));
    await waitFor(() => expect(api.addLifeItem).toHaveBeenCalledWith('timetable', expect.objectContaining({ subject: 'Physics', day: 2, start: '09:00', end: '10:00' })));
  });

  it('assignments: groups by status and moves a card forward', async () => {
    api.lifeItems.mockResolvedValue({ items: [
      { id: 'a1', kind: 'assignment', title: 'Lab report', subject: 'Chem', due: U.addDays(today, -1), status: 'todo', createdAt: '' },
      { id: 'a2', kind: 'assignment', title: 'Essay', subject: '', due: '', status: 'done', createdAt: '' },
    ] });
    api.updateLifeItem.mockResolvedValue({ item: {} });
    render(<MyLife initialTab="assignments" />);
    await screen.findByText('Lab report');
    expect(screen.getByText(/Overdue by 1 day/)).toBeTruthy();
    expect(screen.getByText(/1 overdue/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '→ In progress' })[0]);
    await waitFor(() => expect(api.updateLifeItem).toHaveBeenCalledWith('a1', { status: 'doing' }));
  });

  it('habits: ticking a day sends the updated list and shows the streak', async () => {
    api.lifeItems.mockResolvedValue({ items: [{ id: 'h1', kind: 'habit', name: 'Read', emoji: '📖', days: [U.addDays(today, -1)], createdAt: '1' }] });
    api.updateLifeItem.mockResolvedValue({ item: {} });
    render(<MyLife initialTab="habits" />);
    await screen.findByText('Read');
    expect(screen.getByText(/1 day streak/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Read, Today/ }));
    await waitFor(() => expect(api.updateLifeItem).toHaveBeenCalledWith('h1', { days: [U.addDays(today, -1), today] }));
  });

  it('habits: a daily reminder time can be set when adding a habit', async () => {
    api.addLifeItem.mockResolvedValue({ item: {} });
    render(<MyLife initialTab="habits" />);
    fireEvent.change(await screen.findByLabelText('Habit'), { target: { value: 'Drink water' } });
    fireEvent.change(screen.getByLabelText(/Daily reminder time/), { target: { value: '08:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    await waitFor(() => expect(api.addLifeItem).toHaveBeenCalledWith('habit', expect.objectContaining({ name: 'Drink water', remindTime: '08:00' })));
  });

  it('every tab tells you it will notify', async () => {
    for (const [tab, re] of [['planner', /notify you and read the task/], ['timetable', /10 minutes before/], ['assignments', /8:00 am/], ['focus', /spoken alert and a phone notification/], ['habits', /Remind me every day/], ['reminders', /says it out loud/]]) {
      cleanup();
      render(<MyLife initialTab={tab} />);
      expect(await screen.findByText(re)).toBeTruthy();
    }
  });

  it('focus timer: starting counts down; stopping clears it', async () => {
    render(<MyLife initialTab="focus" />);
    await screen.findByText('25:00');
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    await screen.findByRole('button', { name: /Stop/ });
    expect(JSON.parse(localStorage.getItem('chex.focusTimer')).minutes).toBe(25);
    expect(api.startFocusAlert).toHaveBeenCalledWith(25, '');   // server alert for when it ends (works with the app closed)
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
    expect(api.stopFocusAlert).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('chex.focusTimer')).toBeNull();
    expect(api.addLifeItem).not.toHaveBeenCalled();           // a stopped session is not logged
  });

  it('focus timer: a finished session is saved to today\'s total', async () => {
    api.addLifeItem.mockResolvedValue({ item: {} });
    localStorage.setItem('chex.focusTimer', JSON.stringify({ end: Date.now() - 1000, minutes: 25, label: 'Maths', isBreak: false }));
    render(<MyLife initialTab="focus" />);
    await waitFor(() => expect(api.addLifeItem).toHaveBeenCalledWith('focus', { minutes: 25, label: 'Maths', date: today }));
    expect(api.stopFocusAlert).toHaveBeenCalled();             // the open app speaks it, so the server copy is removed
    expect(localStorage.getItem('chex.focusTimer')).toBeNull();
  });

  it('alarm: set a time and days, and it is saved (no song)', async () => {
    api.addLifeItem.mockResolvedValue({ item: {} });
    render(<MyLife initialTab="alarm" />);
    expect(screen.queryByRole('button', { name: /alarm song/i })).toBeNull();
    fireEvent.change(await screen.findByLabelText('Alarm time'), { target: { value: '06:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Weekdays' }));
    fireEvent.click(screen.getByRole('button', { name: /Set alarm/ }));
    await waitFor(() => expect(api.addLifeItem).toHaveBeenCalled());
    const [kind, data] = api.addLifeItem.mock.calls[0];
    expect(kind).toBe('alarm');
    expect(data.time).toBe('06:15');
    expect(data.days).toEqual([0, 1, 2, 3, 4]);
    expect('song' in data).toBe(false);
  });

  it('alarm helpers: rings on the right minute and day, never when off or the wrong day', () => {
    const at = (h, m, s = 0) => new Date(2026, 9, 31, h, m, s);                  // Saturday 31 Oct 2026 (day index 5)
    const a = { id: 'x', enabled: true, time: '07:30', days: [] };
    expect(U.alarmDue(a, at(7, 30, 2))).toBe(true);
    expect(U.alarmDue(a, at(7, 29, 59))).toBe(false);
    expect(U.alarmDue(a, at(7, 33))).toBe(false);                                 // too late to ring now
    expect(U.alarmDue({ ...a, enabled: false }, at(7, 30))).toBe(false);
    expect(U.alarmDue({ ...a, days: [0, 1, 2, 3, 4] }, at(7, 30))).toBe(false);   // weekdays only, today is Saturday
    expect(U.alarmDue({ ...a, days: [5, 6] }, at(7, 30))).toBe(true);
    expect(U.repeatLabel([0, 1, 2, 3, 4])).toBe('Weekdays');
    expect(U.repeatLabel([])).toBe('Once');
  });

  it('alarm: offers to turn on notifications (so it can alert while CHEX is closed) and says when they are on', async () => {
    const perm = vi.fn(async () => 'granted');
    const fakeNotification = Object.assign(function Notification() {}, { permission: 'default', requestPermission: perm });
    vi.stubGlobal('Notification', fakeNotification);
    Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => ({ toJSON: () => ({}) }) } }) }, configurable: true });
    window.PushManager = function PushManager() {};
    api.pushSubscribe = vi.fn().mockResolvedValue({ ok: true });
    render(<MyLife initialTab="alarm" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));
    expect(perm).toHaveBeenCalled();
    await waitFor(() => expect(Notification.permission).toBe('default'));   // the fake never changes the real value …
    fakeNotification.permission = 'granted';                               // … so flip it as the browser would
    cleanup(); render(<MyLife initialTab="alarm" />);
    await screen.findByText(/Notifications are on/);
    vi.unstubAllGlobals(); delete window.PushManager;
  });
});
