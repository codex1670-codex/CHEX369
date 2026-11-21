// CHEX AI chat panel: streams Groq text, shows generated images/videos, hands app commands to the command bar.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

const api = vi.hoisted(() => ({ aiStatus: vi.fn(), aiChat: vi.fn(), aiUpload: vi.fn(), aiTranscribe: vi.fn() }));
vi.mock('../src/api.js', () => ({ api }));
import ChexAI from '../src/components/ChexAI.jsx';

const open = () => act(() => { window.dispatchEvent(new Event('chex:ai-open')); });
const ready = { engines: [{ engine: 'image', state: 'ready' }, { engine: 'video', state: 'disabled', message: 'Video AI is switched off by the admin.' }] };

beforeEach(() => {
  cleanup(); Object.values(api).forEach(f => f.mockReset());
  api.aiStatus.mockResolvedValue(ready);
});

describe('CHEX AI', () => {
  it('shows nothing until opened from the menu (no floating bar)', () => {
    render(<ChexAI currentUser={{ username: 'me' }} />);
    expect(screen.queryByRole('dialog', { name: 'CHEX AI' })).toBeNull();
  });

  it('streams a chat reply word by word and keeps the conversation going', async () => {
    api.aiChat.mockImplementation(async (body, onEvent) => { onEvent('route', { label: 'Text AI' }); onEvent('token', { text: 'Hello ' }); onEvent('token', { text: 'there!' }); onEvent('done', { conversationId: 'c1' }); });
    render(<ChexAI currentUser={{ username: 'me' }} />); open();
    fireEvent.change(screen.getByLabelText('Message CHEX AI'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to CHEX AI' }));
    expect(await screen.findByText('Hello there!')).toBeTruthy();
    expect(api.aiChat.mock.calls[0][0]).toMatchObject({ text: 'hi', engine: 'auto', conversationId: null });
    fireEvent.change(screen.getByLabelText('Message CHEX AI'), { target: { value: 'and then?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to CHEX AI' }));
    await waitFor(() => expect(api.aiChat).toHaveBeenCalledTimes(2));
    expect(api.aiChat.mock.calls[1][0].conversationId).toBe('c1');
  });

  it('shows a generated image, and the Image button forces the image engine', async () => {
    api.aiChat.mockImplementation(async (body, onEvent) => { onEvent('media', { id: 'i1', kind: 'image', url: '/uploads/ai/x.png', prompt: 'a fox' }); onEvent('token', { text: 'Here is your image.' }); onEvent('done', {}); });
    const { container } = render(<ChexAI currentUser={{ username: 'me' }} />); open();
    await waitFor(() => expect(api.aiStatus).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Image' }));
    fireEvent.change(screen.getByLabelText('Message CHEX AI'), { target: { value: 'a red fox' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to CHEX AI' }));
    await waitFor(() => expect(container.querySelector('img[src="/uploads/ai/x.png"]')).toBeTruthy());
    expect(api.aiChat.mock.calls[0][0].engine).toBe('image');
  });

  it('disables the Video button with the admin’s reason when Video AI is off', async () => {
    render(<ChexAI currentUser={{ username: 'me' }} />); open();
    const v = await screen.findByRole('button', { name: 'Video' });
    await waitFor(() => expect(v.disabled).toBe(true));
    expect(v.title).toMatch(/switched off/);
  });

  it('shows a friendly limit message from the server', async () => {
    api.aiChat.mockImplementation(async (b, onEvent) => { onEvent('error', { message: 'Your free daily limit for Image AI is used up.', limitation: true }); onEvent('done', {}); });
    render(<ChexAI currentUser={{ username: 'me' }} />); open();
    fireEvent.change(screen.getByLabelText('Message CHEX AI'), { target: { value: 'draw a cat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to CHEX AI' }));
    expect(await screen.findByText(/daily limit/)).toBeTruthy();
  });

  it('hands an app command to the command bar', async () => {
    api.aiChat.mockImplementation(async (b, onEvent) => { onEvent('command', { text: 'open reels' }); onEvent('done', {}); });
    const got = vi.fn(); window.addEventListener('chex:codex-open', e => got(e.detail));
    render(<ChexAI currentUser={{ username: 'me' }} />); open();
    fireEvent.change(screen.getByLabelText('Message CHEX AI'), { target: { value: 'open reels' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to CHEX AI' }));
    await waitFor(() => expect(got).toHaveBeenCalledWith({ mode: 'full', run: 'open reels' }), { timeout: 2000 });
  });
});
