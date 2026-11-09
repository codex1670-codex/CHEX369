// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react';
import { AuthProvider } from '../src/AuthContext.jsx';
import Auth from '../src/pages/Auth.jsx';

vi.mock('../src/three/Globe3D', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const typeInto = (ph, value) => fireEvent.change(screen.getByPlaceholderText(ph), { target: { value } });
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

describe('two-step login screen', () => {
  it('asks for the second password after the first, then verifies with the challenge', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn((url, init) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      calls.push({ url: String(url), body });
      if (String(url).endsWith('/auth/login')) return json(200, { requiresPassword2: true, challenge: 'chal' });
      if (String(url).endsWith('/auth/login/verify')) return json(200, { user: { id: 'u', username: 'sanjiv', displayName: 'Sanjiv', isAdmin: true }, accessToken: 'a', refreshToken: 'r' });
      return json(401, {});
    }));
    render(<AuthProvider><Auth /></AuthProvider>);
    typeInto('Username or email', 'sanjiv');
    typeInto('Password', 'sanjiv369');
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Username or email')).toBeNull());
    expect(screen.queryByPlaceholderText('Username or email')).toBeNull();
    typeInto('Password', 'codecode');
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/auth/login/verify'))).toBe(true));
    expect(calls.find(c => c.url.endsWith('/auth/login/verify')).body).toEqual({ challenge: 'chal', password2: 'codecode' });
  });
});
