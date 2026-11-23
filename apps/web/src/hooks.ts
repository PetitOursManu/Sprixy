import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { get, qs, type Meta, type Model, type Project, type Generation, type Lora, type Capability } from './api';

export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: () => get<Meta>('/api/v1/meta'), staleTime: Infinity });
}

export function useModels(capability?: Capability) {
  return useQuery({
    queryKey: ['models', capability ?? 'all'],
    queryFn: () => get<{ items: Model[]; defaults: Record<Capability, string> }>(`/api/v1/models${qs({ capability })}`),
    staleTime: 5 * 60_000,
  });
}

export function useProject(id: string | undefined) {
  return useQuery({ queryKey: ['project', id], queryFn: () => get<Project>(`/api/v1/projects/${id}`), enabled: !!id });
}

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: () => get<{ items: Project[] }>('/api/v1/projects') });
}

export interface UsageSummary {
  days: number; today: number; month: number; jobsToday: number;
  budget: { monthlyBudgetUsd: number | null; dailyBudgetUsd: number | null; maxCostPerJobUsd: number | null; dailyJobLimit: number | null };
}

/** Month / day spend and budgets (shared with the Usage page cache). */
export function useUsageSummary() {
  return useQuery({ queryKey: ['usage', 30], queryFn: () => get<UsageSummary>('/api/v1/usage?days=30'), staleTime: 30_000 });
}

export interface Balance {
  provider: string; name: string; configured: boolean;
  status: 'ok' | 'needs_billing_key' | 'unavailable' | 'not_supported' | 'not_configured';
  balanceUsd: number | null; detail?: string; message?: string; billingKey: string | null; checkedAt: number;
}

/** Remaining prepaid balance per provider (server caches 60 s; refreshed after jobs finish). */
export function useBalances() {
  return useQuery({ queryKey: ['balance'], queryFn: () => get<{ items: Balance[] }>('/api/v1/providers/balance'), staleTime: 60_000, refetchInterval: 120_000 });
}

export function useLoras(projectId?: string) {
  return useQuery({ queryKey: ['loras', projectId ?? 'all'], queryFn: () => get<{ items: Lora[] }>(`/api/v1/loras${qs({ projectId })}`) });
}

/**
 * Polls active jobs; when a job finishes, invalidates asset/generation queries so the UI refreshes.
 */
export function useActiveJobs(projectId?: string) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['generations', 'active', projectId ?? 'all'],
    queryFn: () => get<{ items: Generation[] }>(`/api/v1/generations${qs({ status: 'active', projectId, limit: 50 })}`),
    refetchInterval: (query) => ((query.state.data?.items.length ?? 0) > 0 ? 1500 : 6000),
  });
  const prev = useRef<Set<string>>(new Set());
  useEffect(() => {
    const now = new Set((q.data?.items ?? []).map((g) => g.id));
    let finished = false;
    for (const id of prev.current) if (!now.has(id)) finished = true;
    prev.current = now;
    if (finished) {
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['asset'] });
      void qc.invalidateQueries({ queryKey: ['generations'] });
      void qc.invalidateQueries({ queryKey: ['usage'] });
      void qc.invalidateQueries({ queryKey: ['balance'] });
      void qc.invalidateQueries({ queryKey: ['loras'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    }
  }, [q.data, qc]);
  return q;
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
