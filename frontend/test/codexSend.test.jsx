// Phone regression: typing a command in the small Ask bar and tapping Send must send it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

const api = vi.hoisted(() => ({
  codexStatus: vi.fn(), codexAct: vi.fn(), codexConfirm: vi.fn(), codexConfirmPlan: vi.fn(),
  codexUiReport: vi.fn(), codexUiResolve: vi.fn(), codexResolve: vi.fn(), codexHistory: vi.fn(),
}));
vi.mock('../src/api.js', () => ({ api }));
vi.mock('../src/codexContext.js', () => ({ getCodexContext: () => ({}), updateCodexContext: vi.fn(), setCodexContext: vi.fn() }));
import Codex from '../src/components/Codex.jsx';

beforeEach(() => {
  cleanup();
  Object.values(api).forEach(f => f.mockReset());
  api.codexStatus.mockResolvedValue({ aiConfigured: false });
  api.codexAct.mockResolvedValue({ message: 'Done.' });
});

const openCodex = () => act(() => { window.dispatchEvent(new CustomEvent('chex:codex-open', { detail: { mode: 'full' } })); });

describe('CHEX AI panel (opened from the Orbit menu)', () => {
  it('has a Send button that is disabled until something is typed, then sends the command', async () => {
    render(<Codex navigate={vi.fn()} goBack={vi.fn()} currentUser={{ id: 'me', username: 'me' }} />);
    openCodex();
    const send = screen.getByRole('button', { name: 'Send to Codex' });
    expect(send.disabled).toBe(true);
    const input = screen.getByLabelText('Ask Codex');
    expect(input.getAttribute('enterkeyhint')).toBe('send');
    fireEvent.change(input, { target: { value: 'follow priya' } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(api.codexAct).toHaveBeenCalled());
    expect(api.codexAct.mock.calls[0][0]).toBe('follow priya');
    expect(input.value).toBe('');
  });

  it('pressing Send does not take focus away from the text box (keeps the phone keyboard open)', () => {
    render(<Codex navigate={vi.fn()} goBack={vi.fn()} currentUser={{ id: 'me', username: 'me' }} />);
    openCodex();
    fireEvent.change(screen.getByLabelText('Ask Codex'), { target: { value: 'hi' } });
    const send = screen.getByRole('button', { name: 'Send to Codex' });
    const notCancelled = fireEvent.mouseDown(send);   // false = preventDefault was called
    expect(notCancelled).toBe(false);
  });
});

describe('No floating AI bar', () => {
  it('shows nothing until CHEX AI is opened from the menu, and goes away when closed', async () => {
    render(<Codex navigate={vi.fn()} goBack={vi.fn()} currentUser={{ id: 'me', username: 'me' }} />);
    expect(screen.queryByLabelText('Ask Codex')).toBeNull();
    openCodex();
    expect(await screen.findByLabelText('Ask Codex')).toBeTruthy();
    fireEvent.click(screen.getByText('✕'));
    await waitFor(() => expect(screen.queryByLabelText('Ask Codex')).toBeNull());
  });
});
