import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api/client';

export interface Me {
  id: string; username: string; fullName: string; email: string; role: string; roleName: string; permissions: string[]; mustChangePassword: boolean;
}

interface AuthCtx { me: Me | null; loading: boolean; can: (p: string) => boolean; refresh: () => Promise<void>; logout: () => Promise<void> }
const Ctx = createContext<AuthCtx>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { setMe(await api<Me>('/auth/me')); } catch { setMe(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (location.pathname !== '/login') void refresh(); else setLoading(false); }, [refresh]);
  const can = useCallback((p: string) => !!me?.permissions.includes(p), [me]);
  const logout = async () => { await api('/auth/logout', { method: 'POST', body: {} }).catch(() => undefined); setMe(null); location.href = '/login'; };
  return <Ctx.Provider value={{ me, loading, can, refresh, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
