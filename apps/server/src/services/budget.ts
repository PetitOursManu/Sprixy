import { getDb } from '../db/index.js';
import { HttpError } from '../lib/errors.js';

export interface BudgetSettings {
  monthlyBudgetUsd: number | null;
  dailyBudgetUsd: number | null;
  maxCostPerJobUsd: number | null;
  dailyJobLimit: number | null;
}

export function getBudget(userId: string): BudgetSettings {
  const r = getDb().get<{ monthly_budget_usd: number | null; daily_budget_usd: number | null; max_cost_per_job_usd: number | null; daily_job_limit: number | null }>(
    'SELECT * FROM user_settings WHERE user_id = ?', userId,
  );
  return {
    monthlyBudgetUsd: r?.monthly_budget_usd ?? null,
    dailyBudgetUsd: r?.daily_budget_usd ?? null,
    maxCostPerJobUsd: r?.max_cost_per_job_usd ?? null,
    dailyJobLimit: r?.daily_job_limit ?? null,
  };
}

export function setBudget(userId: string, b: BudgetSettings): BudgetSettings {
  getDb().run(
    `INSERT INTO user_settings (user_id, monthly_budget_usd, daily_budget_usd, max_cost_per_job_usd, daily_job_limit) VALUES (?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET monthly_budget_usd=excluded.monthly_budget_usd, daily_budget_usd=excluded.daily_budget_usd,
     max_cost_per_job_usd=excluded.max_cost_per_job_usd, daily_job_limit=excluded.daily_job_limit`,
    userId, b.monthlyBudgetUsd, b.dailyBudgetUsd, b.maxCostPerJobUsd, b.dailyJobLimit,
  );
  return getBudget(userId);
}

/** Limits an administrator sets on an account. The user cannot raise them. */
export interface AdminLimits {
  monthlyCapUsd: number | null;
  dailyCapUsd: number | null;
  /** The account may use the administrators' provider keys when it has none of its own. */
  sharedKeys: boolean;
}

export function getLimits(userId: string): AdminLimits {
  const r = getDb().get<{ cap_monthly_usd: number | null; cap_daily_usd: number | null; shared_keys: number }>(
    'SELECT cap_monthly_usd, cap_daily_usd, shared_keys FROM user_settings WHERE user_id = ?', userId,
  );
  return { monthlyCapUsd: r?.cap_monthly_usd ?? null, dailyCapUsd: r?.cap_daily_usd ?? null, sharedKeys: !!r?.shared_keys };
}

export function setLimits(userId: string, l: AdminLimits): AdminLimits {
  getDb().run(
    `INSERT INTO user_settings (user_id, cap_monthly_usd, cap_daily_usd, shared_keys) VALUES (?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET cap_monthly_usd=excluded.cap_monthly_usd, cap_daily_usd=excluded.cap_daily_usd, shared_keys=excluded.shared_keys`,
    userId, l.monthlyCapUsd, l.dailyCapUsd, l.sharedKeys ? 1 : 0,
  );
  return getLimits(userId);
}

export function startOfDay(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
export function startOfMonth(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

const COST = `COALESCE(actual_cost, CASE WHEN status IN ('queued','running') THEN estimated_cost ELSE 0 END, 0)`;

export function spentSince(userId: string, since: number): number {
  const r = getDb().get<{ s: number | null }>(`SELECT SUM(${COST}) s FROM generations WHERE user_id = ? AND created_at >= ? AND status != 'canceled'`, userId, since);
  return r?.s ?? 0;
}

export function jobsSince(userId: string, since: number): number {
  return getDb().get<{ n: number }>(`SELECT COUNT(*) n FROM generations WHERE user_id = ? AND created_at >= ?`, userId, since)?.n ?? 0;
}

/** Throws a 402 error if a job with this estimated cost would exceed the user's limits. */
export function assertWithinBudget(userId: string, estimateUsd: number | null): void {
  const b = getBudget(userId);
  const est = estimateUsd ?? 0;
  if (b.maxCostPerJobUsd !== null && est > b.maxCostPerJobUsd) {
    throw new HttpError(402, 'BUDGET_EXCEEDED', `Estimated cost $${est.toFixed(4)} exceeds your per-job limit of $${b.maxCostPerJobUsd}`);
  }
  if (b.dailyJobLimit !== null && jobsSince(userId, startOfDay()) >= b.dailyJobLimit) {
    throw new HttpError(402, 'BUDGET_EXCEEDED', `Daily generation limit reached (${b.dailyJobLimit})`);
  }
  if (b.dailyBudgetUsd !== null && spentSince(userId, startOfDay()) + est > b.dailyBudgetUsd) {
    throw new HttpError(402, 'BUDGET_EXCEEDED', `Daily budget of $${b.dailyBudgetUsd} would be exceeded`);
  }
  if (b.monthlyBudgetUsd !== null && spentSince(userId, startOfMonth()) + est > b.monthlyBudgetUsd) {
    throw new HttpError(402, 'BUDGET_EXCEEDED', `Monthly budget of $${b.monthlyBudgetUsd} would be exceeded`);
  }
  const l = getLimits(userId);
  if (l.dailyCapUsd !== null && spentSince(userId, startOfDay()) + est > l.dailyCapUsd) {
    throw new HttpError(402, 'BUDGET_EXCEEDED', `Daily allowance of $${l.dailyCapUsd} set by your administrator would be exceeded`);
  }
  if (l.monthlyCapUsd !== null && spentSince(userId, startOfMonth()) + est > l.monthlyCapUsd) {
    throw new HttpError(402, 'BUDGET_EXCEEDED', `Monthly allowance of $${l.monthlyCapUsd} set by your administrator would be exceeded`);
  }
}

export function usageSummary(userId: string, days = 30) {
  const db = getDb();
  const since = Date.now() - days * 86400_000;
  const byDay = db.all<{ day: string; cost: number; jobs: number }>(
    `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') day, SUM(${COST}) cost, COUNT(*) jobs
     FROM generations WHERE user_id = ? AND created_at >= ? AND status != 'canceled' GROUP BY day ORDER BY day`, userId, since,
  );
  const byProvider = db.all<{ provider: string; cost: number; jobs: number }>(
    `SELECT provider, SUM(${COST}) cost, COUNT(*) jobs FROM generations WHERE user_id = ? AND created_at >= ? AND status != 'canceled' GROUP BY provider`, userId, since,
  );
  const byModel = db.all<{ model_id: string; cost: number; jobs: number }>(
    `SELECT model_id, SUM(${COST}) cost, COUNT(*) jobs FROM generations WHERE user_id = ? AND created_at >= ? AND status != 'canceled' GROUP BY model_id ORDER BY cost DESC`, userId, since,
  );
  const byTask = db.all<{ task: string; cost: number; jobs: number }>(
    `SELECT task, SUM(${COST}) cost, COUNT(*) jobs FROM generations WHERE user_id = ? AND created_at >= ? AND status != 'canceled' GROUP BY task`, userId, since,
  );
  return {
    days,
    today: spentSince(userId, startOfDay()),
    month: spentSince(userId, startOfMonth()),
    jobsToday: jobsSince(userId, startOfDay()),
    budget: getBudget(userId),
    limits: getLimits(userId),
    byDay,
    byProvider,
    byModel: byModel.map((m) => ({ modelId: m.model_id, cost: m.cost, jobs: m.jobs })),
    byTask,
  };
}
