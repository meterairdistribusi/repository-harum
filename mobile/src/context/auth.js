import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setToken, setUnauthorizedHandler } from '../lib/api';

const KEY = 'harum.auth';
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const save = useCallback(async (token, u) => {
    setToken(token);
    setUser(u);
    if (token) await AsyncStorage.setItem(KEY, JSON.stringify({ token, user: u }));
    else await AsyncStorage.removeItem(KEY);
  }, []);

  const logout = useCallback(() => save(null, null), [save]);

  useEffect(() => {
    setUnauthorizedHandler(() => logout());
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const { token, user: u } = JSON.parse(raw);
          setToken(token);
          setUser(u);
          // Perbarui data user di latar belakang
          api('/auth/me')
            .then((r) => save(token, r.user))
            .catch(() => {});
        }
      } finally {
        setReady(true);
      }
    })();
  }, [logout, save]);

  const value = useMemo(
    () => ({
      user,
      ready,
      async login(login, password) {
        const r = await api('/auth/login', { method: 'POST', body: { login, password } });
        await save(r.token, r.user);
        return r.user;
      },
      async register(data) {
        const r = await api('/auth/register', { method: 'POST', body: data });
        await save(r.token, r.user);
        return r.user;
      },
      async updateProfile(data) {
        const r = await api('/auth/me', { method: 'PUT', body: data });
        const raw = JSON.parse((await AsyncStorage.getItem(KEY)) || '{}');
        await save(raw.token, r.user);
        return r.user;
      },
      logout,
    }),
    [user, ready, save, logout]
  );

  // Tunggu sesi tersimpan termuat agar request pertama sudah membawa token
  return <AuthContext.Provider value={value}>{ready ? children : null}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
