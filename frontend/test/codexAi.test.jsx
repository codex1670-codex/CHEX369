// CODEX AI page + admin dashboard: streaming, engine routing badges, media previews, limits, uploads, memory approval,
// app-command bridge (with confirmations), history, microphone, and provider management.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';

const api = vi.hoisted(() => ({}));
vi.mock('../src/api.js', () => ({ api, CLIENT_ID: 'test' }));
vi.mock('../src/codexContext.js', () => ({ getCodexContext: () => ({ screen: 'codexai', page: {} }) }));
const theme = vi.hoisted(() => ({ applyTheme: vi.fn() }));
vi.mock('../src/theme.js', () => theme);
import CodexAI from '../src/pages/CodexAI.jsx';
import AiAdmin from '../src/pages/AiAdmin.jsx';

const STATUS = {
  freeOnly: true, memory: { kind: 'mongodb', ok: true },
  engines: [
    { engine: 'text', label: 'Text AI', what: 'chat', provider: 'groq', model: 'openai/gpt-oss-120b', enabled: true, configured: true, state: 'ready', message: '', remaining: { perUser: 90, global: 700 }, limits: { perUserDaily: 100, globalDaily: 800 } },
    { engine: 'image', label: 'Image AI', what: 'text-to-image', provider: 'cloudflare', model: 'flux', enabled: true, configured: true, state: 'limit_reached', message: 'Your free daily limit for Image AI is used up. Resets 00:00 UTC.', remaining: { perUser: 0, global: 30 }, limits: { perUserDaily: 8, globalDaily: 40 } },
    { engine: 'video', label: 'Video AI', what: 'video', provider: 'pollinations', model: 'grok-video', enabled: false, configured: true, experimental: true, state: 'disabled', message: 'Video AI is switched off by the admin.', remaining: { perUser: 2, global: 6 }, limits: { perUserDaily: 2, globalDaily: 6 } },
  ],
};
const stream = (events) => vi.fn(async (_payload, onEvent) => { for (const [n, d] of events) onEvent(n, d); });
const type = (text) => fireEvent.change(screen.getByLabelText('Message CODEX'), { target: { value: text } });
const send = () => fireEvent.click(screen.getByRole('button', { name: 'Send' }));
const ask = async (text) => { type(text); send(); await waitFor(() => expect(api.aiChat).toHaveBeenCalled()); };

beforeEach(() => {
  cleanup();
  for (const k of Object.keys(api)) delete api[k];
  Object.assign(api, {
    aiStatus: vi.fn().mockResolvedValue(STATUS), aiChat: stream([['route', { engine: 'text', label: 'Text AI', reason: 'Answered by the Text AI.' }], ['token', { text: 'Hello ' }], ['token', { text: 'there' }], ['done', { conversationId: 'c1', engine: 'text' }]]),
    aiUpload: vi.fn().mockResolvedValue({ media: { id: 'm1', kind: 'image', url: '/uploads/ai/u/m1.png', mime: 'image/png' } }), aiTranscribe: vi.fn().mockResolvedValue({ text: 'spoken words' }),
    aiConversations: vi.fn().mockResolvedValue({ conversations: [{ id: 'c1', title: 'Owls', updatedAt: '2026-11-15T10:00:00Z' }] }),
    aiConversation: vi.fn().mockResolvedValue({ id: 'c1', messages: [{ id: 'x1', role: 'user', text: 'Tell me about owls' }, { id: 'x2', role: 'assistant', text: 'Owls are birds.', engine: 'text', media: [] }] }),
    aiDeleteConversation: vi.fn().mockResolvedValue({ ok: true }), aiMemory: vi.fn().mockResolvedValue({ memories: [{ id: 'k1', text: 'I like chai' }] }),
    aiAddMemory: vi.fn().mockImplementation(async (text) => ({ memory: { id: 'k2', text } })), aiDeleteMemory: vi.fn().mockResolvedValue({ ok: true }), aiClearMemory: vi.fn().mockResolvedValue({ deleted: 1 }),
    aiMedia: vi.fn().mockResolvedValue({ media: [{ id: 'g1', kind: 'image', url: '/uploads/ai/u/g1.jpg', prompt: 'a fox' }] }), aiDeleteMedia: vi.fn().mockResolvedValue({ ok: true }), aiDeleteAllData: vi.fn().mockResolvedValue({ ok: true }),
    codexAct: vi.fn(), codexConfirm: vi.fn(), codexResolve: vi.fn(), codexConfirmPlan: vi.fn(),
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const mount = (props = {}) => render(<CodexAI onBack={vi.fn()} navigate={vi.fn()} {...props} />);

describe('CODEX AI chat', () => {
  it('shows every engine with its state, the free-only notice, and nothing sensitive', async () => {
    mount();
    await screen.findByText(/Free-only mode/);
    expect(screen.getByTitle(/Video AI is switched off/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Image AI/ }).className).toMatch(/st-limit_reached/);
    expect(screen.getByRole('button', { name: /Text AI/ }).className).toMatch(/st-ready/);
  });

  it('streams the answer, shows which AI CODEX chose, and continues the same conversation', async () => {
    mount(); await ask('Explain recursion');
    await screen.findByText('Hello there');
    expect(screen.getByText(/Text AI — Answered by the Text AI\./)).toBeTruthy();
    expect(api.aiChat.mock.calls[0][0]).toEqual({ text: 'Explain recursion', engine: 'auto', attachmentIds: [], conversationId: null, save: true });
    expect(api.aiChat.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
    api.aiChat.mockClear(); await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());
    type('and again'); send(); await waitFor(() => expect(api.aiChat).toHaveBeenCalled());
    expect(api.aiChat.mock.calls[0][0].conversationId).toBe('c1');
  });

  it('lets the person pick an engine, and send a temporary chat that is not saved', async () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: '🎨 Image' })); fireEvent.click(screen.getByLabelText(/Temporary chat/));
    await ask('a red fox');
    expect(api.aiChat.mock.calls[0][0]).toMatchObject({ engine: 'image', save: false });
  });

  it('renders generated images, audio and video previews', async () => {
    api.aiChat = stream([['route', { engine: 'image', label: 'Image AI', reason: 'x' }], ['media', { id: 'i1', kind: 'image', url: '/uploads/ai/u/i1.jpg', prompt: 'a fox' }], ['media', { id: 'a1', kind: 'audio', url: '/uploads/ai/u/a1.mp3' }], ['media', { id: 'v1', kind: 'video', url: '/uploads/ai/u/v1.mp4' }], ['token', { text: 'Here you go' }], ['done', {}]]);
    const { container } = mount(); await ask('draw a fox');
    await screen.findByAltText('a fox');
    expect(container.querySelector('audio').getAttribute('src')).toBe('/uploads/ai/u/a1.mp3'); expect(container.querySelector('video').getAttribute('src')).toBe('/uploads/ai/u/v1.mp4');
  });

  it('shows a free-plan limitation plainly (not as a crash) and offers the on-device voice fallback', async () => {
    api.aiChat = stream([['route', { engine: 'image', label: 'Image AI', reason: 'x' }], ['error', { code: 'LIMIT', message: "You've reached your free daily limit for Image AI (8 a day). It resets at 00:00 UTC.", limitation: true }], ['done', {}]]);
    const { container } = mount(); await ask('draw a cat');
    await screen.findByText(/free daily limit for Image AI/); expect(container.querySelector('.cai-msg.limit')).toBeTruthy();
    api.aiChat = stream([['error', { code: 'BAD_INPUT', message: 'My voice engine speaks English, Spanish, French, Japanese and Korean.', fallback: 'browser-speech' }], ['done', {}]]);
    const speak = vi.fn(); vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() }); vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(t) { this.text = t; } });
    type('/speak வணக்கம்'); send();
    fireEvent.click(await screen.findByRole('button', { name: /Read aloud on this device/ }));
    expect(speak.mock.calls[0][0].text).toBe('வணக்கம்');
  });

  it('shows a server/network error and keeps working', async () => {
    api.aiChat = vi.fn().mockRejectedValue(Object.assign(new Error('Too many requests'), { status: 429 }));
    mount(); await ask('hi'); await screen.findByText('Too many requests');
    expect(screen.getByLabelText('Message CODEX')).toBeTruthy();
  });

  it('stop cancels the stream', async () => {
    let aborted = false;
    api.aiChat = vi.fn((_p, onEvent, signal) => new Promise((_, reject) => { onEvent('token', { text: 'partial' }); signal.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }); }));
    mount(); await ask('long one'); await screen.findByText('partial');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' })); await waitFor(() => expect(aborted).toBe(true));
    expect(screen.getByText('partial')).toBeTruthy(); await screen.findByRole('button', { name: 'Send' });
  });

  it('attaches a picture, previews it, and sends its id to the Vision engine', async () => {
    const { container } = mount();
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [new File([new Uint8Array(10)], 'p.png', { type: 'image/png' })] } });
    await waitFor(() => expect(api.aiUpload).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('.cai-att img').getAttribute('src')).toBe('/uploads/ai/u/m1.png'));
    await ask('what is this?');
    expect(api.aiChat.mock.calls[0][0].attachmentIds).toEqual(['m1']);
  });
  it('reports upload problems in plain words', async () => {
    api.aiUpload.mockRejectedValue(new Error('That file type is not supported.'));
    const { container } = mount(); fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [new File(['x'], 'x.txt')] } });
    await screen.findByText(/not supported/);
  });

  it('memory proposals need approval: Save writes it, No thanks does not', async () => {
    api.aiChat = stream([['route', { engine: 'memory', label: '', reason: '' }], ['token', { text: 'I can remember that.' }], ['memory_proposal', { text: 'I prefer short answers' }], ['done', {}]]);
    mount(); await ask('remember that I prefer short answers');
    await screen.findByText(/Save “I prefer short answers” to your memory\?/);
    expect(api.aiAddMemory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save to memory' }));
    await waitFor(() => expect(api.aiAddMemory).toHaveBeenCalledWith('I prefer short answers', 'chat'));
    await waitFor(() => expect(screen.queryByText(/to your memory\?/)).toBeNull());
    api.aiAddMemory.mockClear(); await ask('remember that I like owls');
    fireEvent.click((await screen.findAllByRole('button', { name: 'No thanks' }))[0]); expect(api.aiAddMemory).not.toHaveBeenCalled();
  });
});

describe('app commands through the existing Codex engine', () => {
  const cmd = () => { api.aiChat = stream([['route', { engine: 'command', label: 'App command', reason: 'x' }], ['command', { text: 'open reels' }], ['done', {}]]); };
  it('runs the command, navigates, and applies results', async () => {
    cmd(); api.codexAct.mockResolvedValue({ handled: true, message: 'Opening Reels.', navigate: { screen: 'reels' } });
    const navigate = vi.fn(); mount({ navigate }); await ask('open reels');
    await screen.findByText('Opening Reels.'); expect(api.codexAct.mock.calls[0][0]).toBe('open reels'); expect(navigate).toHaveBeenCalledWith('reels', { screen: 'reels' });
    api.codexAct.mockResolvedValue({ handled: true, message: 'Dark mode on.', setTheme: 'dark' }); await ask('dark mode'); await screen.findByText('Dark mode on.'); expect(theme.applyTheme).toHaveBeenCalledWith('dark', true);
  });
  it('asks for confirmation before anything risky, and honours Cancel', async () => {
    cmd(); api.codexAct.mockResolvedValue({ needsConfirmation: true, message: 'Send "hi" to @rahul?', pendingAction: { name: 'send_message', input: {} }, remainingActions: [] });
    api.codexConfirm.mockResolvedValue({ handled: true, message: 'Sent.' });
    mount(); await ask('/do hi to rahul'); await screen.findByText(/Send "hi" to @rahul\?/);
    expect(api.codexConfirm).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByText('Sent.');
    cleanup(); mount(); api.codexConfirm.mockClear(); await ask('/do hi to rahul'); fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await screen.findByText('Cancelled.'); expect(api.codexConfirm).not.toHaveBeenCalled();
  });
  it('lets the person pick between matching people', async () => {
    cmd(); api.codexAct.mockResolvedValue({ needsDisambiguation: true, message: 'Which Priya?', pendingAction: { name: 'follow_user', input: {} }, remainingActions: [], candidates: [{ username: 'priya_k' }, { username: 'priya_s' }] });
    api.codexResolve.mockResolvedValue({ handled: true, message: 'Followed.' });
    mount(); await ask('/do follow priya'); fireEvent.click(await screen.findByRole('button', { name: '@priya_s' }));
    await screen.findByText('Followed.'); expect(api.codexResolve.mock.calls[0][0].input.username).toBe('priya_s');
  });
});

describe('history, memory, gallery, limits', () => {
  it('lists, opens and deletes saved chats', async () => {
    mount(); fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    fireEvent.click(await screen.findByText('Owls')); await screen.findByText('Owls are birds.'); expect(screen.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'History' })); fireEvent.click(await screen.findByRole('button', { name: 'Delete Owls' }));
    await waitFor(() => expect(api.aiDeleteConversation).toHaveBeenCalledWith('c1'));
  });
  it('manages memory: add, forget one, forget all; explains it is never automatic', async () => {
    mount(); fireEvent.click(screen.getByRole('tab', { name: 'Memory' }));
    await screen.findByText('I like chai'); expect(screen.getByText(/never saves anything by itself/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Add a memory'), { target: { value: 'I live in Vaniyambadi' } }); fireEvent.click(screen.getByRole('button', { name: 'Save memory' }));
    await screen.findByText('I live in Vaniyambadi'); expect(api.aiAddMemory).toHaveBeenCalledWith('I live in Vaniyambadi', 'user');
    fireEvent.click(screen.getByRole('button', { name: 'Forget I like chai' })); await waitFor(() => expect(api.aiDeleteMemory).toHaveBeenCalledWith('k1'));
    fireEvent.click(screen.getByRole('button', { name: 'Forget everything' })); await waitFor(() => expect(api.aiClearMemory).toHaveBeenCalled());
  });
  it('shows a clear message when memory storage is unavailable', async () => {
    api.aiMemory.mockRejectedValue(new Error('Chat history and memory are unavailable right now. CODEX itself still works.'));
    mount(); fireEvent.click(screen.getByRole('tab', { name: 'Memory' })); await screen.findByText(/memory are unavailable right now/);
  });
  it('deleting all data asks first', async () => {
    mount(); fireEvent.click(screen.getByRole('tab', { name: 'History' })); await screen.findByText('Owls');
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false); fireEvent.click(screen.getByRole('button', { name: /Delete all my CODEX AI data/ })); expect(api.aiDeleteAllData).not.toHaveBeenCalled();
    window.confirm.mockReturnValueOnce(true); fireEvent.click(screen.getByRole('button', { name: /Delete all my CODEX AI data/ })); await waitFor(() => expect(api.aiDeleteAllData).toHaveBeenCalled());
  });
  it('gallery shows creations and deletes them', async () => {
    mount(); fireEvent.click(screen.getByRole('tab', { name: 'Gallery' })); await screen.findByAltText('a fox');
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' })); await waitFor(() => expect(api.aiDeleteMedia).toHaveBeenCalledWith('g1'));
  });
  it('limits tab states what is left today, honestly', async () => {
    mount(); fireEvent.click(screen.getByRole('tab', { name: 'Limits' }));
    await screen.findByText(/90 of 100 left for you/); expect(screen.getByText(/0 of 8 left for you/)).toBeTruthy(); expect(screen.getByText(/nothing here is unlimited/)).toBeTruthy(); expect(screen.getByText(/MongoDB/)).toBeTruthy();
  });
});

describe('microphone', () => {
  it('records, transcribes with the Speech-to-text engine, and puts the words in the box', async () => {
    const track = { stop: vi.fn() }; vi.stubGlobal('MediaRecorder', class { static isTypeSupported() { return true; } constructor(s) { this.stream = s; this.mimeType = 'audio/webm'; this.state = 'inactive'; } start() { this.state = 'recording'; } stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob([new Uint8Array(50)]) }); this.onstop(); } });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) } });
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Record your voice' })); fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }));
    await waitFor(() => expect(api.aiTranscribe).toHaveBeenCalledWith('m1')); await waitFor(() => expect(screen.getByLabelText('Message CODEX').value).toBe('spoken words')); expect(track.stop).toHaveBeenCalled();
  });
  it('says so when the microphone is denied or unsupported', async () => {
    vi.stubGlobal('MediaRecorder', class {}); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) } });
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Record your voice' })); await screen.findByText(/Microphone permission was denied/);
  });
});

describe('admin: AI providers', () => {
  const OV = {
    freeOnly: true, providers: { groq: { host: 'https://api.groq.com/openai/v1', configured: true, keySet: true, concurrency: 4, note: 'Free tier: per-minute and per-day limits apply.' }, cloudflare: { configured: true, accountSet: true, tokenSet: true, freeNeuronsPerDay: 10000, chexDailyCap: 8000, neuronsUsedToday: 4200, note: 'Resets 00:00 UTC.' }, video: { configured: true, keySet: false, freeModels: ['grok-video'], note: 'Experimental.' }, memory: { kind: 'sqlite', ok: true } },
    engines: [{ ...STATUS.engines[0], usageToday: { requests: 12, errors: 1 }, cooldownUntil: Date.now() + 60000 }, { ...STATUS.engines[2], usageToday: { requests: 0, errors: 0 }, cooldownUntil: null }],
    usage: { day: '2026-11-15', week: [], topUsers: [{ username: 'ann', requests: 9 }], recentErrors: [{ engine: 'text', code: 'RATE_LIMIT', at: '2026-11-15T09:00:00Z' }] },
  };
  beforeEach(() => Object.assign(api, { aiAdminOverview: vi.fn().mockResolvedValue(OV), aiAdminModels: vi.fn().mockResolvedValue({ models: ['gpt-oss:20b', 'openai/gpt-oss-120b'] }), aiAdminSetEngine: vi.fn().mockResolvedValue({}), aiAdminTest: vi.fn().mockResolvedValue({ ok: true, ms: 321, detail: 'Replied.' }), aiAdminReset: vi.fn().mockResolvedValue({ ok: true }) }));
  it('shows provider health, free-only status, the neuron meter, usage and errors', async () => {
    render(<AiAdmin flash={vi.fn()} fail={vi.fn()} />);
    await screen.findByText(/FREE_ONLY_MODE is ON/); expect(screen.getByText(/4200 neurons used today \(42% of the free allowance\)/)).toBeTruthy(); expect(screen.getByText(/@ann \(9\)/)).toBeTruthy(); expect(screen.getByText(/text · RATE_LIMIT/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/SECRET/); expect(screen.getByText(/key set ✓/)).toBeTruthy();
  });
  it('saves model + limits, toggles an engine, tests the connection, and clears a pause', async () => {
    const flash = vi.fn(); render(<AiAdmin flash={flash} fail={vi.fn()} />);
    const card = within(await screen.findByTestId('engine-text'));
    fireEvent.change(card.getByLabelText('Text AI model'), { target: { value: 'openai/gpt-oss-120b' } }); fireEvent.change(card.getByLabelText('Text AI per-user daily limit'), { target: { value: '40' } });
    fireEvent.click(card.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.aiAdminSetEngine).toHaveBeenCalledWith('text', { model: 'openai/gpt-oss-120b', perUserDaily: 40, globalDaily: 800 })); expect(flash).toHaveBeenCalledWith('Text AI saved.');
    fireEvent.click(card.getByRole('switch')); await waitFor(() => expect(api.aiAdminSetEngine).toHaveBeenLastCalledWith('text', expect.objectContaining({ enabled: false })));
    fireEvent.click(card.getByRole('button', { name: 'Test connection' })); await card.findByText(/Replied\. \(321 ms\)/);
    fireEvent.click(card.getByRole('button', { name: 'Clear pause' })); await waitFor(() => expect(api.aiAdminReset).toHaveBeenCalledWith('text'));
  });
  it('surfaces a failed connection test and a rejected setting', async () => {
    api.aiAdminTest.mockResolvedValue({ ok: false, ms: 50, detail: 'Text AI: the provider rejected the API key.' }); const fail = vi.fn(); api.aiAdminSetEngine.mockRejectedValue(new Error('FREE_ONLY_MODE is on: video model must be one of grok-video'));
    render(<AiAdmin flash={vi.fn()} fail={fail} />); const card = within(await screen.findByTestId('engine-video'));
    fireEvent.click(card.getByRole('button', { name: 'Test connection' })); await card.findByText(/rejected the API key/);
    fireEvent.click(card.getByRole('button', { name: 'Save' })); await waitFor(() => expect(fail).toHaveBeenCalled());
  });
});
