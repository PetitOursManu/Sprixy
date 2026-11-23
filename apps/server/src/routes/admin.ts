import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { rm } from 'node:fs/promises';
import { getDb } from '../db/index.js';
import { requireAdmin } from '../auth.js';
import { hashPassword, newId } from '../lib/crypto.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { absPath } from '../lib/storage.js';
import { getLimits, setLimits, spentSince, jobsSince, startOfDay, startOfMonth, type AdminLimits } from '../services/budget.js';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  created_at: number;
  disabled_at: number | null;
  created_by: string | null;
}

const money = z.number().min(0).max(100_000).nullable();

function userDto(r: UserRow) {
  const db = getDb();
  const ownKeys = db.all<{ provider: string }>('SELECT provider FROM provider_keys WHERE user_id = ? ORDER BY provider', r.id).map((k) => k.provider);
  const lastJob = db.get<{ t: number | null }>('SELECT MAX(created_at) t FROM generations WHERE user_id = ?', r.id)?.t ?? null;
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    disabled: r.disabled_at !== null,
    createdAt: r.created_at,
    createdBy: r.created_by,
    limits: getLimits(r.id),
    ownKeys,
    spentToday: spentSince(r.id, startOfDay()),
    spentMonth: spentSince(r.id, startOfMonth()),
    jobsToday: jobsSince(r.id, startOfDay()),
    jobsMonth: jobsSince(r.id, startOfMonth()),
    lastJobAt: lastJob,
  };
}

function loadUser(id: string): UserRow {
  const row = getDb().get<UserRow>('SELECT id, email, name, role, created_at, disabled_at, created_by FROM users WHERE id = ?', id);
  if (!row) throw notFound('User');
  return row;
}

/** Sign a user out everywhere (after a password reset, a role change or when disabling the account). */
function endSessions(userId: string) {
  getDb().run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export async function adminRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/api/v1/admin/users', {
    schema: { tags: ['admin'], summary: 'List the accounts of this instance, with their allowance and spend (admin only)' },
  }, async (req) => {
    requireAdmin(req);
    const items = getDb().all<UserRow>('SELECT id, email, name, role, created_at, disabled_at, created_by FROM users ORDER BY created_at').map(userDto);
    return {
      items,
      totals: {
        spentToday: items.reduce((s, u) => s + u.spentToday, 0),
        spentMonth: items.reduce((s, u) => s + u.spentMonth, 0),
        allocatedMonth: items.reduce((s, u) => s + (u.limits.monthlyCapUsd ?? 0), 0),
      },
    };
  });

  r.post('/api/v1/admin/users', {
    schema: {
      tags: ['admin'],
      summary: 'Create an account (admin only)',
      description: 'The account signs in with this email and password. `monthlyCapUsd` / `dailyCapUsd` cap what it may spend (null = no cap); with `sharedKeys` it uses the administrators\' provider keys when it has none of its own.',
      body: z.object({
        email: z.string().email().max(200),
        name: z.string().min(1).max(80),
        password: z.string().min(8).max(200),
        role: z.enum(['user', 'admin']).default('user'),
        monthlyCapUsd: money.default(null),
        dailyCapUsd: money.default(null),
        sharedKeys: z.boolean().default(true),
      }),
    },
  }, async (req, reply) => {
    const admin = requireAdmin(req);
    const db = getDb();
    if (db.get('SELECT 1 FROM users WHERE email = ?', req.body.email)) throw new HttpError(409, 'EMAIL_TAKEN', 'An account already exists for this email');
    const id = newId('usr_');
    db.run('INSERT INTO users (id,email,name,password_hash,role,created_at,created_by) VALUES (?,?,?,?,?,?,?)',
      id, req.body.email, req.body.name, await hashPassword(req.body.password), req.body.role, Date.now(), admin.id);
    setLimits(id, { monthlyCapUsd: req.body.monthlyCapUsd, dailyCapUsd: req.body.dailyCapUsd, sharedKeys: req.body.sharedKeys });
    reply.code(201);
    return { user: userDto(loadUser(id)) };
  });

  r.patch('/api/v1/admin/users/:id', {
    schema: {
      tags: ['admin'],
      summary: 'Change an account: name, role, password, allowance, shared keys, disabled (admin only)',
      params: z.object({ id: z.string() }),
      body: z.object({
        name: z.string().min(1).max(80).optional(),
        role: z.enum(['user', 'admin']).optional(),
        password: z.string().min(8).max(200).optional(),
        disabled: z.boolean().optional(),
        monthlyCapUsd: money.optional(),
        dailyCapUsd: money.optional(),
        sharedKeys: z.boolean().optional(),
      }),
    },
  }, async (req) => {
    const admin = requireAdmin(req);
    const target = loadUser(req.params.id);
    const b = req.body;
    const self = target.id === admin.id;
    if (self && b.role === 'user') throw badRequest('You cannot remove your own administrator role');
    if (self && b.disabled) throw badRequest('You cannot disable your own account');
    const db = getDb();
    if (b.name !== undefined) db.run('UPDATE users SET name = ? WHERE id = ?', b.name, target.id);
    if (b.role !== undefined && b.role !== target.role) { db.run('UPDATE users SET role = ? WHERE id = ?', b.role, target.id); }
    if (b.password !== undefined) { db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(b.password), target.id); if (!self) endSessions(target.id); }
    if (b.disabled !== undefined) {
      db.run('UPDATE users SET disabled_at = ? WHERE id = ?', b.disabled ? (target.disabled_at ?? Date.now()) : null, target.id);
      if (b.disabled) endSessions(target.id);
    }
    if (b.monthlyCapUsd !== undefined || b.dailyCapUsd !== undefined || b.sharedKeys !== undefined) {
      const cur = getLimits(target.id);
      const next: AdminLimits = {
        monthlyCapUsd: b.monthlyCapUsd !== undefined ? b.monthlyCapUsd : cur.monthlyCapUsd,
        dailyCapUsd: b.dailyCapUsd !== undefined ? b.dailyCapUsd : cur.dailyCapUsd,
        sharedKeys: b.sharedKeys ?? cur.sharedKeys,
      };
      setLimits(target.id, next);
    }
    return { user: userDto(loadUser(target.id)) };
  });

  r.delete('/api/v1/admin/users/:id', {
    schema: {
      tags: ['admin'],
      summary: 'Delete an account and everything it owns — projects, assets, files, keys, tokens (admin only, cannot be undone)',
      params: z.object({ id: z.string() }),
    },
  }, async (req) => {
    const admin = requireAdmin(req);
    const target = loadUser(req.params.id);
    if (target.id === admin.id) throw badRequest('You cannot delete your own account');
    const db = getDb();
    if (db.get(`SELECT 1 FROM generations WHERE user_id = ? AND status IN ('queued','running')`, target.id)) {
      throw new HttpError(409, 'JOBS_RUNNING', 'This account has jobs in progress. Wait for them to finish, or disable the account first.');
    }
    db.run('DELETE FROM users WHERE id = ?', target.id); // cascades to every table
    await rm(absPath(target.id), { recursive: true, force: true });
    return { ok: true };
  });
}
