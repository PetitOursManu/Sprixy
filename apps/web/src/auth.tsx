import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, type User } from './api';

interface Status { setupRequired: boolean; allowSignup: boolean; user: User | null; version: string }

const AuthCtx = createContext<{ status: Status | undefined; refresh: () => Promise<void>; logout: () => Promise<void> }>({
  status: undefined,
  refresh: async () => undefined,
  logout: async () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['auth-status'], queryFn: () => get<Status>('/api/v1/auth/status'), staleTime: 60_000 });
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ['auth-status'] }); };
  const logout = async () => {
    await post('/api/v1/auth/logout');
    qc.clear();
    await refresh();
  };
  return <AuthCtx.Provider value={{ status: q.data, refresh, logout }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
