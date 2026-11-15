// Circle to Ask — the whole flow in the UI: circle → permission → preview → Codex panel → actions → "take me there".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

const api = vi.hoisted(() => ({ circleAsk: vi.fn() }));
const priv = vi.hoisted(() => ({ open: false }));
vi.mock('../src/api.js', () => ({ api, inPrivateSpace: () => priv.open }));
vi.mock('../src/codexContext.js', () => ({ getCodexContext: () => ({ screen: 'games', page: { title: 'CHEX', headings: ['Game Store'], activeTabs: ['Discover'], device: 'phone', text: 'WHOLE PAGE TEXT' } }) }));
const cap = vi.hoisted(() => ({ captureRegion: vi.fn(), collectRegionText: vi.fn() }));
vi.mock('../src/circleAsk/capture.js', () => cap);
import CircleAsk from '../src/circleAsk/CircleAsk.jsx';

const IMG = { mediaType: 'image/jpeg', data: 'QUJD', previewUrl: 'data:image/jpeg;base64,QUJD', width: 100, height: 80, bytes: 3 };
const reply = (o = {}) => ({ answer: 'This is the Game Store.', steps: [], navigate: null, followUps: ['What can I play?'], usedImage: true, ...o });
const start = () => act(() => { window.dispatchEvent(new Event('chex:circle-ask-start')); });
const pickWholeScreen = () => { start(); fireEvent.click(screen.getByRole('button', { name: 'Whole screen' })); };

beforeEach(() => {
  cleanup(); localStorage.clear(); localStorage.setItem('chex.circleAsk', 'on'); priv.open = false;
  api.circleAsk.mockReset().mockResolvedValue(reply());
  cap.captureRegion.mockReset().mockResolvedValue({ image: IMG, text: 'Game Store · Discover', controls: ['Create room'], hidden: 2 });
  cap.collectRegionText.mockReset().mockReturnValue({ text: 'Messages · New chat', controls: [], hidden: 0 });
});
afterEach(() => cleanup());

describe('Circle to Ask flow', () => {
  it('does nothing until it is switched on in Settings', () => {
    localStorage.setItem('chex.circleAsk', 'off');
    render(<CircleAsk navigate={vi.fn()} route="games" />);
    start();
    expect(screen.getByRole('status').textContent).toMatch(/Turn on Circle to Ask/);
    expect(screen.queryByText(/Circle what you need help with/)).toBeNull();
  });

  it('asks permission first, then shows a preview, and only sends after "Send to Codex"', async () => {
    render(<CircleAsk navigate={vi.fn()} route="games" />);
    pickWholeScreen();
    expect(screen.getByRole('dialog', { name: /Let Codex look at this area/ })).toBeTruthy();
    expect(cap.captureRegion).not.toHaveBeenCalled();           // nothing captured before permission
    fireEvent.click(screen.getByRole('button', { name: /Capture & preview/ }));
    await screen.findByRole('dialog', { name: /Preview before sending/ });
    expect(screen.getByAltText(/circled area that will be sent/)).toBeTruthy();
    expect(screen.getByText(/2 private items hidden/)).toBeTruthy();
    expect(api.circleAsk).not.toHaveBeenCalled();                // …and nothing sent before approval
    fireEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));
    await screen.findByText('This is the Game Store.');
    const body = api.circleAsk.mock.calls[0][0];
    expect(body).toMatchObject({ mode: 'explain', consent: true, image: { mediaType: 'image/jpeg', data: 'QUJD' }, regionText: 'Game Store · Discover' });
    expect(body.context).toEqual({ screen: 'games', title: 'CHEX', headings: ['Game Store'], activeTabs: ['Discover'], device: 'phone' });
    expect(JSON.stringify(body)).not.toContain('WHOLE PAGE TEXT');   // only the circled text leaves, not the page digest
  });

  it('can send text only (picture unchecked) with no consent flag or image', async () => {
    render(<CircleAsk navigate={vi.fn()} route="games" />);
    pickWholeScreen(); fireEvent.click(screen.getByRole('button', { name: /Capture & preview/ }));
    await screen.findByRole('dialog', { name: /Preview before sending/ });
    fireEvent.click(screen.getByLabelText(/Include the picture/));
    fireEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));
    await screen.findByText('This is the Game Store.');
    expect(api.circleAsk.mock.calls[0][0].image).toBeUndefined(); expect(api.circleAsk.mock.calls[0][0].consent).toBeUndefined();
  });

  it('"Text only" never captures a picture', async () => {
    render(<CircleAsk navigate={vi.fn()} route="games" />);
    pickWholeScreen(); fireEvent.click(screen.getByRole('button', { name: 'Text only' }));
    await screen.findByRole('dialog', { name: /Preview before sending/ });
    expect(cap.captureRegion).not.toHaveBeenCalled(); expect(cap.collectRegionText).toHaveBeenCalled();
  });

  it('on Messages it only offers to read labels — no picture capture at all', async () => {
    render(<CircleAsk navigate={vi.fn()} route="messages" />);
    pickWholeScreen();
    expect(screen.queryByRole('button', { name: /Capture & preview/ })).toBeNull();
    expect(screen.getByText(/never pictures or message content/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Read labels' }));
    await screen.findByRole('dialog', { name: /Preview before sending/ });
    expect(cap.captureRegion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));
    await screen.findByText('This is the Game Store.');
    expect(api.circleAsk.mock.calls[0][0].context.headings).toEqual([]);   // even page headings (chat names) stay home
  });

  it('is switched off in Private space and on admin', () => {
    for (const route of ['mylife', 'admin']) { cleanup(); render(<CircleAsk navigate={vi.fn()} route={route} />); start(); expect(screen.getByRole('status').textContent).toMatch(/private screens/); }
    cleanup(); priv.open = true; render(<CircleAsk navigate={vi.fn()} route="feed" />); start();
    expect(screen.getByRole('status').textContent).toMatch(/private screens/);
  });

  it('has all six help types and the quick questions, each sending the right request', async () => {
    render(<CircleAsk navigate={vi.fn()} route="games" />);
    pickWholeScreen(); fireEvent.click(screen.getByRole('button', { name: /Capture & preview/ }));
    await screen.findByRole('button', { name: 'Send to Codex' }); fireEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));
    await screen.findByText('This is the Game Store.');
    for (const [label, mode] of [['Simplify', 'simplify'], ['Deep Explain', 'deep'], ['Translate', 'translate'], ['Show Steps', 'steps'], ['Take Me There', 'take_me_there'], ['Explain', 'explain']]) {
      api.circleAsk.mockClear();
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^\\S+ ${label}$`) }));
      await waitFor(() => expect(api.circleAsk).toHaveBeenCalled());
      expect(api.circleAsk.mock.calls[0][0].mode).toBe(mode);
      await waitFor(() => expect(screen.getByRole('button', { name: /Simplify/ }).disabled).toBe(false));
    }
    for (const q of ['What is this?', 'Why is this used?', 'How does it work?', 'What happens if I click it?', 'How can I fix this?', 'Give me an example']) {
      api.circleAsk.mockClear(); fireEvent.click(screen.getByRole('button', { name: q }));
      await waitFor(() => expect(api.circleAsk).toHaveBeenCalled());
      expect(api.circleAsk.mock.calls[0][0]).toMatchObject({ mode: 'ask', question: q });
      await waitFor(() => expect(screen.getByRole('button', { name: q }).disabled).toBe(false));
    }
  });

  it('Translate sends the chosen language; a typed question is sent; history is passed along', async () => {
    render(<CircleAsk navigate={vi.fn()} route="games" />);
    pickWholeScreen(); fireEvent.click(screen.getByRole('button', { name: /Capture & preview/ }));
    await screen.findByRole('button', { name: 'Send to Codex' }); fireEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));
    await screen.findByText('This is the Game Store.');
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'ta' } });
    api.circleAsk.mockClear(); fireEvent.click(screen.getByRole('button', { name: /Translate/ }));
    await waitFor(() => expect(api.circleAsk).toHaveBeenCalled());
    expect(api.circleAsk.mock.calls[0][0].language).toBe('Tamil');
    await waitFor(() => expect(screen.getByRole('button', { name: /Translate/ }).disabled).toBe(false));
    api.circleAsk.mockClear();
    fireEvent.change(screen.getByLabelText('Ask about the circled area'), { target: { value: 'why is it blue?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => expect(api.circleAsk).toHaveBeenCalled());
    const b = api.circleAsk.mock.calls[0][0];
    expect(b).toMatchObject({ mode: 'ask', question: 'why is it blue?' }); expect(b.language).toBeUndefined();
    expect(b.history.length).toBeGreaterThan(1);
  });

  it('"Take me there" only navigates after the person taps it, and never to anything but the suggested screen', async () => {
    const navigate = vi.fn();
    api.circleAsk.mockResolvedValue(reply({ answer: 'Games live here.', navigate: { screen: 'games', label: 'Games', reason: 'Play there.' } }));
    render(<CircleAsk navigate={navigate} route="feed" />);
    pickWholeScreen(); fireEvent.click(screen.getByRole('button', { name: /Capture & preview/ }));
    await screen.findByRole('button', { name: 'Send to Codex' }); fireEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));
    await screen.findByText('Games live here.');
    expect(navigate).not.toHaveBeenCalled();                       // suggestion alone never moves the screen
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('button', { name: 'Take me there' })).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('…and taking the suggestion closes the panel and navigates', async () => {
    const navigate = vi.fn();
    api.circleAsk.mockResolvedValue(reply({ navigate: { screen: 'reels', label: 'Reels', reason: '' } }));
    render(<CircleAsk navigate={navigate} route="feed" />);
    pickWholeScreen(); fireEvent.click(screen.getByRole('button', { name: /Capture & preview/ }));
    await screen.findByRole('button', { name: 'Send to Codex' }); fireEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Take me there' }));
    expect(navigate).toHaveBeenCalledWith('reels');
    expect(screen.queryByRole('dialog', { name: 'Circle to Ask' })).toBeNull();
  });

  it('shows honest errors (e.g. the AI is not set up) instead of pretending', async () => {
    api.circleAsk.mockRejectedValue(Object.assign(new Error('x'), { code: 'NOT_CONFIGURED' }));
    render(<CircleAsk navigate={vi.fn()} route="feed" />);
    pickWholeScreen(); fireEvent.click(screen.getByRole('button', { name: /Capture & preview/ }));
    await screen.findByRole('button', { name: 'Send to Codex' }); fireEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));
    await screen.findByText(/isn't set up on this server/);
  });

  it('closing wipes the picture and conversation; deleting the picture switches to text only', async () => {
    render(<CircleAsk navigate={vi.fn()} route="feed" />);
    pickWholeScreen(); fireEvent.click(screen.getByRole('button', { name: /Capture & preview/ }));
    await screen.findByRole('button', { name: 'Send to Codex' }); fireEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));
    await screen.findByText('This is the Game Store.');
    fireEvent.click(screen.getByRole('button', { name: 'Delete the picture' }));
    expect(screen.getByText(/Text only/)).toBeTruthy();
    api.circleAsk.mockClear(); fireEvent.click(screen.getByRole('button', { name: /Simplify/ }));
    await waitFor(() => expect(api.circleAsk).toHaveBeenCalled());
    expect(api.circleAsk.mock.calls[0][0].image).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: /Close and delete everything/ }));
    expect(screen.queryByRole('dialog', { name: 'Circle to Ask' })).toBeNull();
    expect(document.querySelector('.circle-mini')).toBeNull();
  });

  it('stops the page scrolling underneath while you circle', () => {
    render(<CircleAsk navigate={vi.fn()} route="feed" />);
    start();
    const ev = new Event('wheel', { bubbles: true, cancelable: true });
    screen.getByRole('application').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('Escape cancels at any step; leaving the page ends the session', async () => {
    const { rerender } = render(<CircleAsk navigate={vi.fn()} route="feed" />);
    start(); expect(screen.getByText(/Circle what you need help with/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' }); expect(screen.queryByText(/Circle what you need help with/)).toBeNull();
    pickWholeScreen(); expect(screen.getByRole('dialog', { name: /Let Codex look/ })).toBeTruthy();
    rerender(<CircleAsk navigate={vi.fn()} route="reels" />); expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('remembers the language only when asked, and "don\'t ask again" is not saved to disk', async () => {
    render(<CircleAsk navigate={vi.fn()} route="feed" />);
    pickWholeScreen(); fireEvent.click(screen.getByLabelText(/Don't ask me to capture again/));
    fireEvent.click(screen.getByRole('button', { name: /Capture & preview/ }));
    await screen.findByRole('button', { name: 'Send to Codex' }); fireEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));
    await screen.findByText('This is the Game Store.');
    expect(localStorage.getItem('chex.circleAsk.prefs')).toBeNull();
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByLabelText(/Remember my language/));
    expect(JSON.parse(localStorage.getItem('chex.circleAsk.prefs'))).toEqual({ remember: true, language: 'hi' });
    expect(Object.keys(localStorage).some((k) => /skip|dont/i.test(k))).toBe(false);
  });
});
