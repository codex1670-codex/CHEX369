import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setTokens, getStoredRefreshToken, onAuthFailure } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  // Local sign-out only (used after deactivate/delete, when the server already ended the session).
  const clearSession = useCallback(() => { setTokens(null); setUser(null); }, []);

  const logout = useCallback(async () => {
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
          const tokens = await res.json();
          setTokens(tokens);
          const me = await api.me();
          setUser(me.user);
        }
      } catch { /* stay logged out */ }
      setBooting(false);
    })();
  }, []);

  const login = async (identifier, password, totpCode) => {
    const data = await api.login({ identifier, password, totpCode });

    if (data.requires2FA) {
      return { requires2FA: true };
    }

    if (data.requiresPassword2) {
      return {
        requires2FA: false,
        requiresPassword2: true,
        challenge: data.challenge
      };
    }

    setTokens(data);
    setUser(data.user);
    return { requires2FA: false, reactivated: !!data.reactivated };
  };

  const loginVerify = async (challenge, password2) => {
    const data = await api.loginVerify({ challenge, password2 });
    setTokens(data);
    setUser(data.user);
    return { requires2FA: false };
  };

  const signup = async (payload) => {
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

export function useAuth() {
  return useContext(AuthContext);
}

export { AuthContext };
