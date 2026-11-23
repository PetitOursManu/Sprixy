import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmtUsd, get, put } from '../api';
import { Field, Segmented, useToast } from '../components/ui';

interface Budget { monthlyBudgetUsd: number | null; dailyBudgetUsd: number | null; maxCostPerJobUsd: number | null; dailyJobLimit: number | null }
interface Limits { monthlyCapUsd: number | null; dailyCapUsd: number | null; sharedKeys: boolean }
interface Usage {
  days: number; today: number; month: number; jobsToday: number; budget: Budget; limits: Limits;
  byDay: { day: string; cost: number; jobs: number }[];
  byProvider: { provider: string; cost: number; jobs: number }[];
  byModel: { modelId: string; cost: number; jobs: number }[];
  byTask: { task: string; cost: number; jobs: number }[];
}

function fillDays(rows: Usage['byDay'], days: number) {
  const map = new Map(rows.map((r) => [r.day, r]));
  const out: Usage['byDay'] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push(map.get(key) ?? { day: key, cost: 0, jobs: 0 });
  }
  return out;
}

export function UsagePage() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['usage', days], queryFn: () => get<Usage>(`/api/v1/usage?days=${days}`) });
  const u = q.data;
  const series = u ? fillDays(u.byDay, days) : [];
  const max = Math.max(0.0001, ...series.map((s) => s.cost));
  const total = series.reduce((s, x) => s + x.cost, 0);
  const pct = (v: number, b: number | null) => (b ? Math.min(100, (v / b) * 100) : 0);
  const lower = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));
  const dayCap = u ? lower(u.budget.dailyBudgetUsd, u.limits.dailyCapUsd) : null;
  const monthCap = u ? lower(u.budget.monthlyBudgetUsd, u.limits.monthlyCapUsd) : null;
  return (
    <>
      <div className="topbar"><div className="crumbs"><strong>Usage & budget</strong></div></div>
      <div className="page">
        <div className="page-head">
          <div><h1>Usage & budget</h1><p>Costs are billed by your providers on your own keys. Sprixy tracks them per job and enforces your limits.</p></div>
          <Segmented value={String(days)} onChange={(v) => setDays(Number(v))} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
        </div>
        {u && (
          <>
            {(u.limits.monthlyCapUsd !== null || u.limits.dailyCapUsd !== null || u.limits.sharedKeys) && (
              <div className="notice">
                <strong>Set by your administrator: </strong>
                {[
                  u.limits.monthlyCapUsd !== null && `${fmtUsd(u.limits.monthlyCapUsd, 2)} per month (${fmtUsd(Math.max(0, u.limits.monthlyCapUsd - u.month), 2)} left)`,
                  u.limits.dailyCapUsd !== null && `${fmtUsd(u.limits.dailyCapUsd, 2)} per day`,
                  u.limits.sharedKeys && 'jobs run on the instance’s provider keys when you have none of your own',
                ].filter(Boolean).join(' · ')}. You can set lower limits below, not higher ones.
              </div>
            )}
            <div className="grid-4">
              <div className="panel"><div className="panel-body"><div className="stat"><span className="k">Today</span><span className="v cost">{fmtUsd(u.today, 3)}</span></div>
                {dayCap !== null && <Gauge pct={pct(u.today, dayCap)} label={`of ${fmtUsd(dayCap, 2)}`} />}</div></div>
              <div className="panel"><div className="panel-body"><div className="stat"><span className="k">This month</span><span className="v cost">{fmtUsd(u.month, 3)}</span></div>
                {monthCap !== null && <Gauge pct={pct(u.month, monthCap)} label={`of ${fmtUsd(monthCap, 2)}`} />}</div></div>
              <div className="panel"><div className="panel-body"><div className="stat"><span className="k">Jobs today</span><span className="v">{u.jobsToday}{u.budget.dailyJobLimit !== null && <span className="muted" style={{ fontSize: 14 }}> / {u.budget.dailyJobLimit}</span>}</span></div></div></div>
              <div className="panel"><div className="panel-body"><div className="stat"><span className="k">Last {days} days</span><span className="v cost">{fmtUsd(total, 3)}</span></div></div></div>
            </div>
            <div className="panel">
              <div className="panel-head"><h2>Daily spend</h2><span className="mono small muted">max {fmtUsd(max, 3)}/day</span></div>
              <div className="panel-body">
                <div className="bar-chart">
                  {series.map((s) => <div key={s.day} className="bar" style={{ height: `${(s.cost / max) * 100}%` }} title={`${s.day}: ${fmtUsd(s.cost)} · ${s.jobs} jobs`} />)}
                </div>
                <div className="row between mono small muted"><span>{series[0]?.day}</span><span>{series[series.length - 1]?.day}</span></div>
              </div>
            </div>
            <div className="grid-3" style={{ alignItems: 'start' }}>
              <Breakdown title="By provider" rows={u.byProvider.map((r) => ({ k: r.provider, cost: r.cost, jobs: r.jobs }))} />
              <Breakdown title="By model" rows={u.byModel.map((r) => ({ k: r.modelId, cost: r.cost, jobs: r.jobs }))} />
              <Breakdown title="By task" rows={u.byTask.map((r) => ({ k: r.task, cost: r.cost, jobs: r.jobs }))} />
            </div>
            <BudgetForm budget={u.budget} />
          </>
        )}
      </div>
    </>
  );
}

function Gauge({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <div style={{ height: 6, background: 'var(--bg-4)', borderRadius: 2, overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: pct > 90 ? 'var(--red)' : 'var(--accent)' }} /></div>
      <span className="small muted mono">{pct.toFixed(0)}% {label}</span>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { k: string; cost: number; jobs: number }[] }) {
  return (
    <div className="panel">
      <div className="panel-head"><h3>{title}</h3></div>
      <table className="table small">
        <tbody>
          {rows.length === 0 && <tr><td className="muted">No data</td></tr>}
          {rows.map((r) => <tr key={r.k}><td className="mono" style={{ wordBreak: 'break-all' }}>{r.k}</td><td className="mono muted">{r.jobs}</td><td className="cost" style={{ textAlign: 'right' }}>{fmtUsd(r.cost)}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

function BudgetForm({ budget }: { budget: Budget }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [b, setB] = useState(budget);
  useEffect(() => setB(budget), [budget]);
  const save = useMutation({
    mutationFn: () => put('/api/v1/budget', b),
    onSuccess: () => { toast('success', 'Limits saved'); void qc.invalidateQueries({ queryKey: ['usage'] }); },
    onError: (e) => toast('error', (e as Error).message),
  });
  const num = (k: keyof Budget, label: string, hint: string, int = false) => (
    <Field label={label} hint={hint}>
      <input className="input mono" type="number" min={0} step={int ? 1 : 0.01} value={b[k] ?? ''} placeholder="unlimited"
        onChange={(e) => setB({ ...b, [k]: e.target.value === '' ? null : int ? Math.round(Number(e.target.value)) : Number(e.target.value) })} />
    </Field>
  );
  return (
    <div className="panel">
      <div className="panel-head"><h2>Budgets & limits</h2><button className="btn primary sm" onClick={() => save.mutate()}>Save</button></div>
      <div className="panel-body">
        <div className="grid-4">
          {num('monthlyBudgetUsd', 'Monthly budget (USD)', 'Jobs that would exceed it are refused')}
          {num('dailyBudgetUsd', 'Daily budget (USD)', 'Resets at local midnight')}
          {num('maxCostPerJobUsd', 'Max cost per job (USD)', 'Guards against expensive mistakes')}
          {num('dailyJobLimit', 'Daily job limit', 'Number of AI jobs per day', true)}
        </div>
      </div>
    </div>
  );
}
