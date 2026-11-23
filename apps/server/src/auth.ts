import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getDb } from './db/index.js';
import { config } from './config.js';
import { hashPassword, verifyPassword, randomToken, sha256, newId } from './lib/crypto.js';
import { HttpError, unauthorized, forbidden } from './lib/errors.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    authKind?: 'session' | 'token';
    /** 'full' for sessions and regular tokens; 'catalog' for read-only tokens given to connected apps. */
    tokenScope?: TokenScope;
  }
}

export const SESSION_COOKIE = 'sprixy_session';
export const TOKEN_SCOPES = ['full', 'catalog'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** What a catalog token may call: the shared-assets catalog, and who it belongs to. */
export function allowedForScope(scope: TokenScope | undefined, method: string, url: string): boolean {
  if (scope !== 'catalog') return true;
  const path = url.split('?')[0]!;
  return method === 'GET' && (path === '/api/v1/catalog' || path.startsWith('/api/v1/catalog/') || path === '/api/v1/auth/me' || path === '/api/health');
}
export const TOKEN_PREFIX = 'spx_';

/** An active (not disabled) account. */
function userById(id: string): AuthUser | undefined {
  return getDb().get<AuthUser>('SELECT id, email, name, role FROM users WHERE id = ? AND disabled_at IS NULL', id);
}

/** Resolve the user from a Bearer API token or the session cookie. */
export function resolveUser(req: FastifyRequest): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    const row = getDb().get<{ id: string; user_id: string; scope: TokenScope }>('SELECT id, user_id, scope FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL', sha256(token));
    if (row) {
      req.user = userById(row.user_id);
      req.authKind = 'token';
      req.tokenScope = row.scope;
      getDb().run('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', Date.now(), row.id);
    }
    return;
  }
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid) {
    const s = getDb().get<{ user_id: string; expires_at: number }>('SELECT user_id, expires_at FROM sessions WHERE id_hash = ?', sha256(sid));
    if (s && s.expires_at > Date.now()) {
      req.user = userById(s.user_id);
      req.authKind = 'session';
      req.tokenScope = 'full';
    }
  }
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireAdmin(req: FastifyRequest): AuthUser {
  const u = requireUser(req);
  if (u.role !== 'admin') throw forbidden('Administrator only');
  return u;
}

function startSession(reply: FastifyReply, userId: string) {
  const token = randomToken();
  const now = Date.now();
  getDb().run('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)', sha256(token), userId, now, now + config.sessionDays * 86400_000);
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: config.sessionDays * 86400,
  });
}

export function createApiToken(userId: string, name: string, scope: TokenScope = 'full') {
  const token = TOKEN_PREFIX + randomToken(24);
  const id = newId('tok_');
  getDb().run('INSERT INTO api_tokens (id,user_id,name,token_hash,prefix,created_at,scope) VALUES (?,?,?,?,?,?,?)', id, userId, name, sha256(token), token.slice(0, 10), Date.now(), scope);
  return { id, name, token, prefix: token.slice(0, 10), scope };
}

const credentials = z.object({ email: z.string().email().max(200), password: z.string().min(8).max(200) });

export async function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/api/v1/auth/status', { schema: { tags: ['auth'], summary: 'Instance status (setup required, signup allowed, current user)' } }, async (req) => {
    const users = getDb().get<{ n: number }>('SELECT COUNT(*) n FROM users')!.n;
    return { setupRequired: users === 0, allowSignup: config.allowSignup || users === 0, user: req.user ?? null, version: '0.1.0' };
  });

  r.post('/api/v1/auth/register', {
    schema: { tags: ['auth'], summary: 'Create an account (first account becomes admin)', body: credentials.extend({ name: z.string().min(1).max(80) }) },
  }, async (req, reply) => {
    const users = getDb().get<{ n: number }>('SELECT COUNT(*) n FROM users')!.n;
    if (users > 0 && !config.allowSignup) throw forbidden('Sign-ups are disabled on this instance (SPRIXY_ALLOW_SIGNUP=false)');
    if (getDb().get('SELECT 1 FROM users WHERE email = ?', req.body.email)) throw new HttpError(409, 'EMAIL_TAKEN', 'An account already exists for this email');
    const id = newId('usr_');
    getDb().run('INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)', id, req.body.email, req.body.name, await hashPassword(req.body.password), users === 0 ? 'admin' : 'user', Date.now());
    startSession(reply, id);
    return { user: userById(id) };
  });

  r.post('/api/v1/auth/login', { schema: { tags: ['auth'], summary: 'Sign in (sets a session cookie)', body: credentials } }, async (req, reply) => {
    const row = getDb().get<{ id: string; password_hash: string; disabled_at: number | null }>('SELECT id, password_hash, disabled_at FROM users WHERE email = ?', req.body.email);
    if (!row || !(await verifyPassword(req.body.password, row.password_hash))) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    if (row.disabled_at) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account has been disabled by an administrator');
    startSession(reply, row.id);
    return { user: userById(row.id) };
  });

  r.post('/api/v1/auth/logout', { schema: { tags: ['auth'], summary: 'Sign out' } }, async (req, reply) => {
    const sid = req.cookies?.[SESSION_COOKIE];
    if (sid) getDb().run('DELETE FROM sessions WHERE id_hash = ?', sha256(sid));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  r.get('/api/v1/auth/me', { schema: { tags: ['auth'], summary: 'Current user' } }, async (req) => ({ user: requireUser(req) }));

  r.post('/api/v1/auth/password', {
    schema: { tags: ['auth'], summary: 'Change password', body: z.object({ currentPassword: z.string(), newPassword: z.string().min(8).max(200) }) },
  }, async (req) => {
    const u = requireUser(req);
    const row = getDb().get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', u.id)!;
    if (!(await verifyPassword(req.body.currentPassword, row.password_hash))) throw new HttpError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    getDb().run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(req.body.newPassword), u.id);
    return { ok: true };
  });

  // API tokens (for the MCP server, Mocky, Muse, scripts…)
  r.get('/api/v1/tokens', { schema: { tags: ['auth'], summary: 'List API tokens' } }, async (req) => {
    const u = requireUser(req);
    return {
      items: getDb().all<{ id: string; name: string; prefix: string; scope: TokenScope; created_at: number; last_used_at: number | null }>(
        'SELECT id, name, prefix, scope, created_at, last_used_at FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC', u.id,
      ).map((t) => ({ id: t.id, name: t.name, prefix: t.prefix, scope: t.scope, createdAt: t.created_at, lastUsedAt: t.last_used_at })),
    };
  });

  r.post('/api/v1/tokens', {
    schema: {
      tags: ['auth'], summary: 'Create an API token (shown once)',
      description: '`scope: "full"` acts as you (generate, edit, spend). `scope: "catalog"` is read-only and sees only the assets of the projects you share with connected apps: the one to give Mocky.',
      body: z.object({ name: z.string().min(1).max(80), scope: z.enum(TOKEN_SCOPES).default('full') }),
    },
  }, async (req) => {
    const u = requireUser(req);
    if (req.authKind !== 'session') throw forbidden('API tokens can only be created from a signed-in browser session');
    return createApiToken(u.id, req.body.name, req.body.scope);
  });

  r.delete('/api/v1/tokens/:id', { schema: { tags: ['auth'], summary: 'Revoke an API token', params: z.object({ id: z.string() }) } }, async (req) => {
    const u = requireUser(req);
    getDb().run('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ?', Date.now(), req.params.id, u.id);
    return { ok: true };
  });
}
