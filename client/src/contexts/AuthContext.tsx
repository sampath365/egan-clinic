import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, tokenStore } from '@/lib/api';
import type { AuthUser, Clinic } from '@/types';

interface AuthState {
  user: AuthUser | null;
  clinics: Clinic[];
  activeClinic: Clinic | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setActiveClinicId: (id: string) => void;
  can: (permission: string) => boolean;
  hasRole: (...roles: string[]) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const CLINIC_KEY = 'egan.clinic.activeClinicId';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [activeClinicId, setActiveClinicIdState] = useState<string | null>(localStorage.getItem(CLINIC_KEY));
  const [loading, setLoading] = useState(true);

  const loadSession = useCallback(async () => {
    const token = tokenStore.get();
    if (!token) {
      setUser(null);
      setClinics([]);
      setLoading(false);
      return;
    }
    try {
      const [{ user: me }, { clinics: list }] = await Promise.all([
        api.get<{ user: AuthUser }>('/auth/me'),
        api.get<{ clinics: Clinic[] }>('/clinics'),
      ]);
      setUser(me);
      setClinics(list);
      const stored = localStorage.getItem(CLINIC_KEY);
      const valid = list.find((c) => c.id === stored) ?? list[0] ?? null;
      if (valid) {
        setActiveClinicIdState(valid.id);
        localStorage.setItem(CLINIC_KEY, valid.id);
      }
    } catch {
      tokenStore.clear();
      setUser(null);
      setClinics([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: AuthUser }>('/auth/login', { email, password });
    tokenStore.set(res.token);
    setUser(res.user);
    const { clinics: list } = await api.get<{ clinics: Clinic[] }>('/clinics');
    setClinics(list);
    const first = list[0] ?? null;
    if (first) {
      setActiveClinicIdState(first.id);
      localStorage.setItem(CLINIC_KEY, first.id);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore network errors on logout */
    }
    tokenStore.clear();
    localStorage.removeItem(CLINIC_KEY);
    setUser(null);
    setClinics([]);
    setActiveClinicIdState(null);
  }, []);

  const setActiveClinicId = useCallback((id: string) => {
    setActiveClinicIdState(id);
    localStorage.setItem(CLINIC_KEY, id);
  }, []);

  const can = useCallback((permission: string) => Boolean(user?.permissions.includes(permission)), [user]);
  const hasRole = useCallback((...roles: string[]) => Boolean(user?.roles.some((r) => roles.includes(r))), [user]);

  const activeClinic = useMemo(() => clinics.find((c) => c.id === activeClinicId) ?? clinics[0] ?? null, [clinics, activeClinicId]);

  const value = useMemo<AuthState>(
    () => ({ user, clinics, activeClinic, loading, login, logout, setActiveClinicId, can, hasRole, refresh: loadSession }),
    [user, clinics, activeClinic, loading, login, logout, setActiveClinicId, can, hasRole, loadSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
