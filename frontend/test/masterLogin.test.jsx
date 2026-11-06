import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react';
import { AuthProvider } from '../src/AuthContext.jsx';
import Auth from '../src/pages/Auth.jsx';

vi.mock('../src/three/Globe3D', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const typeInto = (ph, value) => fireEvent.change(screen.getByPlaceholderText(ph), { target: { value } });
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

describe('master (sanjiv) two-password login screen', () => {
  it('asks for the second password after the first, then sends both', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn((url, init) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      calls.push({ url, body });
      if (!String(url).endsWith('/auth/login')) return json(401, {});
      if (!body.password2) return json(200, { requiresPassword2: true });
      return json(200, { user: { id: 'u', username: 'sanjiv', displayName: 'Sanjiv', isAdmin: true }, accessToken: 'a', refreshToken: 'r' });
    }));
    render(<AuthProvider><Auth /></AuthProvider>);
    typeInto('Username or email', 'sanjiv');
    typeInto('Password', 'sanjiv369');
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(screen.getByPlaceholderText('Second password')).toBeTruthy());
    expect(screen.queryByPlaceholderText('Password')).toBeNull();
    typeInto('Second password', 'codecode');
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(calls.filter(c => String(c.url).endsWith('/auth/login')).length).toBe(2));
    const last = calls.filter(c => String(c.url).endsWith('/auth/login')).pop().body;
    expect(last).toMatchObject({ identifier: 'sanjiv', password: 'sanjiv369', password2: 'codecode' });
  });
});
