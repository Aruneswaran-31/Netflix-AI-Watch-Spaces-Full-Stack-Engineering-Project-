import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  api,
  clearTokens,
  getTokens,
  setTokens,
  setUnauthorizedHandler,
} from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const signOut = useCallback(async ({ notifyServer = true } = {}) => {
    const refreshToken = getTokens()?.refreshToken;
    if (notifyServer && refreshToken) {
      await api('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => {});
    }
    clearTokens();
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearTokens();
      setUser(null);
    });
    if (!getTokens()?.accessToken) {
      setReady(true);
      return;
    }
    api('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => clearTokens())
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    setTokens(data);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async ({ email, password, displayName, accountType }) => {
    const data = await api('/auth/register', {
      method: 'POST',
      body: { email, password, displayName, accountType },
      auth: false,
    });
    setTokens(data);
    setUser(data.user);
    return data.user;
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, register, signOut, setUser }),
    [user, ready, login, register, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
