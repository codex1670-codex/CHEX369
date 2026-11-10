import { createContext, useContext, useEffect, useState, useCallback, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { api, setTokens, getStoredRefreshToken, onAuthFailure } from './api.js';
import { unregisterPush } from './push.js';
import type { User, Tokens } from './types';

interface SignupPayload { username: string; email: string; password: string; displayName?: string }
type LoginOutcome = { requires2FA: boolean; requiresPassword2?: boolean; challenge?: string; reactivated?: boolean };

export interface AuthContextValue {
  user: User | null;
  setUser: Dispatch<SetStateAction<User | null>>;
  booting: boolean;
  login: (identifier: string, password: string, totpCode?: string) => Promise<LoginOutcome>;
  loginVerify: (challenge: string, password2: string) => Promise<LoginOutcome>;
  signup: (payload: SignupPayload) => Promise<void>;
  logout: () => Promise<void>;
  clearSession: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);

  // Local sign-out only (used after deactivate/delete, when the server already ended the session).
  const clearSession = useCallback(() => { setTokens(null); setUser(null); }, []);

  const logout = useCallback(async () => {
    try { await unregisterPush(); } catch { /* best-effort */ }   // this phone stops getting this account's notifications
    try { await api.logout(); } catch { /* best-effort */ }
    setTokens(null);
    setUser(null);
  }, []);

  useEffect(() => {
    onAuthFailure(() => setUser(null));
  }, []);

  useEffect(() => {
    (async () => {
      const stored = getStoredRefreshToken();
      if (!stored) { setBooting(false); return; }
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: stored }),
        });
        if (res.ok) {
          const tokens = (await res.json()) as Tokens;
          setTokens(tokens);
          const me = await api.me();
          setUser(me.user);
        }
      } catch { /* stay logged out */ }
      setBooting(false);
    })();
  }, []);

  const login: AuthContextValue['login'] = async (identifier, password, totpCode) => {
    const data = await api.login({ identifier, password, totpCode });
    if (data.requires2FA) return { requires2FA: true };
    if (data.requiresPassword2) return { requires2FA: false, requiresPassword2: true, challenge: data.challenge };
    setTokens(data);
    setUser(data.user);
    return { requires2FA: false, reactivated: !!data.reactivated };
  };

  const loginVerify: AuthContextValue['loginVerify'] = async (challenge, password2) => {
    const data = await api.loginVerify({ challenge, password2 });
    setTokens(data);
    setUser(data.user);
    return { requires2FA: false };
  };

  const signup: AuthContextValue['signup'] = async (payload) => {
    const data = await api.signup(payload);
    setTokens(data);
    setUser(data.user);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, booting, login, loginVerify, signup, logout, clearSession }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Auth state for the current session. Throws if used outside <AuthProvider>. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
