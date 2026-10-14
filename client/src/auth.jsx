import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, hasSession, setSession, setUnauthorizedHandler } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(hasSession());

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    if (!hasSession()) return;
    api('/me')
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api('/login', { method: 'POST', body: { email, password } });
    setSession(data);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    setUser(null);
  }, []);

  /** After a password change the server issues a new token (old sessions stop working). */
  const replaceSession = useCallback((data) => {
    setSession(data);
    if (data.user) setUser(data.user);
  }, []);

  const value = useMemo(
    () => ({ user, setUser, loading, login, logout, replaceSession, isSuperAdmin: user?.role === 'super_admin' }),
    [user, loading, login, logout, replaceSession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
