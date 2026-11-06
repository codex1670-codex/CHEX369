import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

const api = vi.hoisted(() => ({
  lifeItems: vi.fn(), addLifeItem: vi.fn(), updateLifeItem: vi.fn(), learnBoard: vi.fn(), learnLevel: vi.fn(), coins: vi.fn(),
  learnLanguages: vi.fn(), learnChooseLanguage: vi.fn(), learnUnlockLanguage: vi.fn(),
  deleteLifeItem: vi.fn(), startFocusAlert: vi.fn(), stopFocusAlert: vi.fn(),
  stickies: vi.fn(), ringingStickies: vi.fn(), addSticky: vi.fn(), updateSticky: vi.fn(), snoozeSticky: vi.fn(), dismissSticky: vi.fn(), deleteSticky: vi.fn(),
}));
const auth = vi.hoisted(() => ({ user: { id: 'u1', username: 'ada', displayName: 'Ada Lovelace', avatarColor: '#7C5CFF' } }));
vi.mock('../src/api.js', () => ({ api }));
vi.mock('../src/AuthContext.jsx', () => ({ useAuth: () => auth }));
vi.mock('../src/socket.js', () => ({ getSocket: () => ({ on: () => {}, off: () => {} }) }));
vi.mock('../src/stickyVoice.js', () => ({ speakReminder: vi.fn(), stickyVoiceOn: () => true, setStickyVoice: (v) => v }));
// Make lessons deterministic: every level is seven "hello" questions with 'hello' as the right answer.
vi.mock('../src/learn/course.js', async (orig) => ({
  ...(await orig()),
  genLevel: () => Array.from({ length: 7 }, () => ({ k: 'ch', t: 'Select the correct translation', p: 'hola', sp: 'hola', o: ['hello', 'goodbye', 'cat', 'dog'], a: 'hello' })),
}));

const Course = await vi.importActual('../src/learn/course.js');
const R = await import('../src/learn/learnState.js');
const { default: Learn } = await import('../src/learn/Learn.jsx');
const { default: LearnPage } = await import('../src/pages/LearnPage.jsx');
const { default: MyLife } = await import('../src/pages/MyLife.jsx');

const saved = (over = {}) => ({ id: 'L1', kind: 'learn', ...R.newProgress(), onb: 0, createdAt: '2026-11-01T00:00:00Z', updatedAt: '', ...over });
beforeEach(() => {
  cleanup(); localStorage.clear();
  Object.values(api).forEach(f => f.mockReset());
  api.lifeItems.mockResolvedValue({ items: [saved()] });
  api.updateLifeItem.mockResolvedValue({ item: {} });
  api.learnBoard.mockResolvedValue({ board: [] });
  api.coins.mockResolvedValue({ balance: 4 });
  api.learnLevel.mockResolvedValue({ recorded: true, coins: 0, balance: 4 });
  api.learnLanguages.mockResolvedValue({ chosen: true, owned: ['es'], completed: {}, unlockLevels: 100, price: 100, canUnlock: false, balance: 4 });   // Spanish is this person's free first language
  api.stickies.mockResolvedValue({ notes: [] }); api.ringingStickies.mockResolvedValue({ notes: [] });
});
afterEach(() => cleanup());

describe('CHEX learn rules', () => {
  it('power to play: all hearts refill 24 hours after the first one was lost', () => {
    const s = { ...R.newProgress(), hearts: 2, ht: Date.now() - 23 * 3600e3 };
    expect(R.regen(s).hearts).toBe(2);
    expect(R.regen({ ...s, ht: Date.now() - 25 * 3600e3 }).hearts).toBe(5);
    const full = R.newProgress();
    expect(R.regen(full)).toBe(full);                       // nothing changed → same object, so nothing is re-saved
  });

  it('a clean level earns 15 XP and unlocks the next level; a replay does not advance', () => {
    const a = R.finishLevel(R.newProgress(), { n: 0, miss: 0, elapsedMs: 60e3 });
    expect([a.xp, a.next.lvl, a.next.streak, a.section]).toEqual([15, 1, 1, 0]);
    const b = R.finishLevel(a.next, { n: 0, miss: 2, elapsedMs: 60e3 });
    expect([b.xp, b.next.lvl]).toEqual([10, 1]);
  });

  it('there are no gems any more: nothing in the progress or the rewards mentions them', () => {
    const s = R.newProgress(), r = R.finishLevel(s, { n: 0, miss: 0, elapsedMs: 1000 });
    expect(JSON.stringify([s, r])).not.toMatch(/gems|boost|freeze/);
    expect(R.normalize({ ...s, gems: 99, boost: 1, freeze: 2, q: { ...s.q, c: [0] } })).not.toHaveProperty('gems');
  });

  it('the 9th level of each block closes a section; level 27 also opens the next stage', () => {
    const at = (n) => R.finishLevel({ ...R.newProgress(), lvl: n }, { n, miss: 0, elapsedMs: 1000 });
    expect([7, 8, 9, 17, 26].map(n => at(n).section)).toEqual([0, 1, 0, 2, 3]);
    expect(at(26).newStage).toBe(true); expect(at(26).stage).toBe(1);
    expect(at(8).newStage).toBe(false);
  });

  it('streak continues from yesterday, otherwise it restarts', () => {
    const day = 864e5, d = (n) => new Date(Date.now() - n * day).toDateString();
    expect(R.finishLevel({ ...R.newProgress(), streak: 4, last: d(1) }, { n: 0, miss: 0, elapsedMs: 1 }).next.streak).toBe(5);
    expect(R.finishLevel({ ...R.newProgress(), streak: 4, last: d(2) }, { n: 0, miss: 0, elapsedMs: 1 }).next.streak).toBe(1);
  });

  it('switching language remembers the level you reached in each', () => {
    let s = { ...R.newProgress(), lvl: 5 };
    s = R.switchLanguage(s, 'fr'); expect([s.lang, s.lvl]).toEqual(['fr', 0]);
    s = R.switchLanguage(s, 'es'); expect([s.lang, s.lvl]).toEqual(['es', 5]);
  });

  it('every language builds 7 well-formed questions for every one of the 108 levels', () => {
    for (const [code] of Course.LANGS) {
      const C = Course.makeCourse(code);
      for (let n = 0; n < Course.LV; n++) {
        const Q = Course.genLevel(C, n);
        expect(Q).toHaveLength(7);
        Q.forEach(q => { if (q.k === 'ch') expect(q.o).toContain(q.a); });
      }
    }
  });
});

describe('CHEX learn page', () => {
  it('has no login screen: no email or password fields, goes straight to the course', async () => {
    const { container } = render(<Learn />);
    await screen.findByText(/Spanish course/);
    expect(container.querySelector('input[type="password"], input[type="email"]')).toBeNull();
    expect(screen.queryByText(/Log in|Create account|Create a new account/)).toBeNull();
  });

  it('first visit creates the person’s progress on their account, then asks for a daily goal', async () => {
    api.lifeItems.mockResolvedValue({ items: [] });
    api.addLifeItem.mockResolvedValue({ item: saved({ onb: 1 }) });
    render(<Learn />);
    await screen.findByText('Pick your daily goal');
    expect(api.addLifeItem).toHaveBeenCalledWith('learn', expect.objectContaining({ lang: 'es', xp: 0, hearts: 5 }));
    fireEvent.click(screen.getByRole('button', { name: /Serious/ }));
    await waitFor(() => expect(api.updateLifeItem).toHaveBeenCalledWith('L1', expect.objectContaining({ goal: 50, onb: 0 })), { timeout: 2500 });
  });

  it('shows the signed-in CHEX user (same name and username) in My progress', async () => {
    const open = vi.fn();
    render(<Learn onOpenProfile={open} />);
    fireEvent.click(await screen.findByRole('tab', { name: /My progress/ }));
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('@ada')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /View my CHEX profile/ }));
    expect(open).toHaveBeenCalledWith('ada');
    expect(screen.queryByText(/Log out|Delete account/)).toBeNull();      // account actions stay in CHEX Settings
  });

  it('plays a level: wrong answer costs a heart, finishing awards XP and saves to the account', async () => {
    render(<Learn />);
    fireEvent.click(await screen.findByRole('button', { name: /Level 1, start/ }));
    const lesson = await screen.findByRole('dialog', { name: 'Lesson' });
    const q = within(lesson);
    // 1st question wrong
    fireEvent.click(q.getByRole('button', { name: 'cat' })); fireEvent.click(q.getByRole('button', { name: 'Check' }));
    expect(q.getByText('Correct answer:')).toBeTruthy(); expect(document.querySelector('.lx-hearts').textContent.trim()).toBe('4');
    fireEvent.click(q.getByRole('button', { name: 'Continue' }));
    // remaining 6 right
    for (let i = 0; i < 6; i++) {
      fireEvent.click(q.getByRole('button', { name: 'hello' })); fireEvent.click(q.getByRole('button', { name: 'Check' }));
      fireEvent.click(q.getByRole('button', { name: 'Continue' }));
    }
    expect(await q.findByText('Level 1 complete!')).toBeTruthy();
    await waitFor(() => expect(api.updateLifeItem).toHaveBeenLastCalledWith('L1', expect.objectContaining({ xp: 10, lvl: 1, hearts: 4, streak: 1 })), { timeout: 2500 });
    fireEvent.click(q.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /Level 2, start/ })).toBeTruthy();   // next level unlocked
  });

  it('running out of hearts ends the lesson; starting another level explains when hearts return', async () => {
    api.lifeItems.mockResolvedValue({ items: [saved({ hearts: 1 })] });
    render(<Learn />);
    fireEvent.click(await screen.findByRole('button', { name: /Level 1, start/ }));
    const q = within(await screen.findByRole('dialog'));
    fireEvent.click(q.getByRole('button', { name: 'cat' })); fireEvent.click(q.getByRole('button', { name: 'Check' }));
    fireEvent.click(q.getByRole('button', { name: 'Continue' }));
    expect(await q.findByText('You’re out of hearts')).toBeTruthy();
    expect(screen.queryByText(/shop/i)).toBeNull();
    fireEvent.click(q.getByRole('button', { name: 'Back to the course' }));
    fireEvent.click(screen.getByRole('button', { name: /Level 1, start/ }));
    expect(await screen.findByText(/refills in/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gems and the shop are gone; the top bar shows the CHEX coin balance', async () => {
    render(<Learn />);
    await screen.findByText(/Spanish course/);
    expect(screen.queryByText(/💎|gems/i)).toBeNull();
    expect(screen.queryByRole('tab', { name: /Shop/ })).toBeNull();
    expect((await screen.findByTitle('Your CHEX coins')).querySelector('b').textContent).toBe('4');
    fireEvent.click(screen.getByRole('tab', { name: /Quests/ }));
    expect(screen.queryByRole('button', { name: /Claim/ })).toBeNull();     // quests no longer pay gems
  });

  it('finishing the 9th level completes the section: the server pays 1 CHEX coin and the balance updates', async () => {
    api.lifeItems.mockResolvedValue({ items: [saved({ lvl: 8 })] });
    api.learnLevel.mockResolvedValue({ recorded: true, coins: 1, balance: 5 });
    render(<Learn />);
    expect((await screen.findAllByText('+1', { exact: false })).length).toBeGreaterThan(0);          // section banners advertise the reward
    fireEvent.click(await screen.findByRole('button', { name: /Level 9, start/ }));
    const q = within(await screen.findByRole('dialog'));
    for (let i = 0; i < 7; i++) {
      fireEvent.click(q.getByRole('button', { name: 'hello' })); fireEvent.click(q.getByRole('button', { name: 'Check' }));
      fireEvent.click(q.getByRole('button', { name: 'Continue' }));
    }
    expect(await q.findByText('🎉 Section 1 complete!')).toBeTruthy();
    expect(await q.findByText('+1 CHEX coin')).toBeTruthy();
    expect(api.learnLevel).toHaveBeenCalledWith('es', 8);
    await waitFor(() => expect(screen.getByTitle('Your CHEX coins').querySelector('b').textContent).toBe('5'));
  });

  it('an ordinary level reports to the server but shows no coin message', async () => {
    render(<Learn />);
    fireEvent.click(await screen.findByRole('button', { name: /Level 1, start/ }));
    const q = within(await screen.findByRole('dialog'));
    for (let i = 0; i < 7; i++) {
      fireEvent.click(q.getByRole('button', { name: 'hello' })); fireEvent.click(q.getByRole('button', { name: 'Check' }));
      fireEvent.click(q.getByRole('button', { name: 'Continue' }));
    }
    expect(await q.findByText('Level 1 complete!')).toBeTruthy();
    expect(q.queryByText(/Section \d+ complete/)).toBeNull();
    expect(api.learnLevel).toHaveBeenCalledWith('es', 0);
  });

  it('leaderboard lists you and followed learners from their CHEX profiles, highest XP first', async () => {
    api.learnBoard.mockResolvedValue({ board: [
      { user: { id: 'u1', username: 'ada', displayName: 'Ada Lovelace', avatarColor: '#7C5CFF' }, xp: 0, streak: 0, me: true },
      { user: { id: 'u2', username: 'grace', displayName: 'Grace Hopper', avatarColor: '#26e0c9' }, xp: 120, streak: 4, me: false },
    ] });
    render(<Learn />);
    fireEvent.click(await screen.findByRole('tab', { name: /Leaderboard/ }));
    await screen.findByText('Grace Hopper');
    const names = screen.getAllByText(/Ada Lovelace|Grace Hopper/).map(n => n.textContent);
    expect(names).toEqual(['Grace Hopper', 'Ada Lovelace']);
    expect(screen.getByText('@grace · 🔥 4')).toBeTruthy();
  });

  it('is its own page with a Back button, and no longer a tab inside My life', async () => {
    const back = vi.fn();
    render(<LearnPage onBack={back} />);
    await screen.findByText(/Spanish course/);
    expect(screen.getByRole('heading', { name: /CHEX learn/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(back).toHaveBeenCalled();
    cleanup();
    render(<MyLife />);
    await screen.findByRole('tab', { name: /Daily planner/ });
    expect(screen.queryByRole('tab', { name: /CHEX learn/ })).toBeNull();
  });

  it('shows a retry when progress cannot be loaded', async () => {
    api.lifeItems.mockRejectedValueOnce(new Error('Network down'));
    render(<Learn />);
    expect(await screen.findByText(/Network down/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/Spanish course/);
  });
});

describe('CHEX learn languages: first one free, the rest Premium', () => {
  const info = (over = {}) => ({ chosen: true, owned: ['es'], completed: { es: 12 }, unlockLevels: 100, price: 100, canUnlock: false, balance: 4, ...over });
  const openCourses = async () => { render(<Learn />); fireEvent.click(await screen.findByRole('tab', { name: /Courses/ })); };
  const rowOf = (name) => screen.getByText(name).closest('.lx-langrow');

  it('first visit asks for one free first language; picking it saves it and opens the course', async () => {
    api.learnLanguages.mockResolvedValue(info({ chosen: false, owned: [], completed: {} }));
    api.learnChooseLanguage.mockResolvedValue(info({ owned: ['fr'], completed: {} }));
    render(<Learn />);
    expect(await screen.findByText('Choose your first language')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pick a language' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /French/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start learning French' }));
    await waitFor(() => expect(api.learnChooseLanguage).toHaveBeenCalledWith('fr'));
    await waitFor(() => expect(screen.queryByText('Choose your first language')).toBeNull());
  });

  it('Courses: every other language is Premium and locked until 100 levels are finished', async () => {
    api.learnLanguages.mockResolvedValue(info());
    await openCourses();
    expect(await screen.findAllByText('👑 Premium')).toHaveLength(11);
    const locked = screen.getAllByRole('button', { name: /is locked until you finish 100 levels/ });
    expect(locked).toHaveLength(11);
    locked.forEach(b => expect(b.disabled).toBe(true));
    expect(screen.getByText('12/100 levels')).toBeTruthy();          // progress toward the unlock
    expect(api.learnUnlockLanguage).not.toHaveBeenCalled();
  });

  it('after 100 levels a Premium language unlocks for 100 CHEX coins', async () => {
    api.learnLanguages.mockResolvedValue(info({ completed: { es: 100 }, canUnlock: true }));
    api.coins.mockResolvedValue({ balance: 150 });
    api.learnUnlockLanguage.mockResolvedValue(info({ owned: ['es', 'it'], completed: { es: 100 }, balance: 50 }));
    await openCourses();
    await waitFor(() => expect(within(rowOf('Italian')).getByRole('button').textContent).toMatch(/Unlock/));
    fireEvent.click(within(rowOf('Italian')).getByRole('button'));
    await waitFor(() => expect(api.learnUnlockLanguage).toHaveBeenCalledWith('it'));
  });

  it('with fewer than 100 coins the unlock button says so and stays disabled', async () => {
    api.learnLanguages.mockResolvedValue(info({ completed: { es: 100 }, canUnlock: true }));   // balance is 4
    await openCourses();
    await waitFor(() => expect(within(rowOf('Italian')).getByRole('button').textContent).toMatch(/Need 100 coins/));
    expect(within(rowOf('Italian')).getByRole('button').disabled).toBe(true);
  });
});
