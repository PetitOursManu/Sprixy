import { getDb, parseJson } from '../db/index.js';
import { encryptSecret, decryptSecret, newId } from '../lib/crypto.js';
import { getProvider, PROVIDERS } from '../providers/registry.js';
import type { ProviderId } from '../providers/types.js';
import { HttpError } from '../lib/errors.js';

interface KeyRow {
  id: string;
  provider: string;
  label: string;
  secret_enc: string;
  last4: string;
  status: string;
  info_json: string | null;
  created_at: number;
  validated_at: number | null;
}

/** Public view of a stored key — the secret itself never leaves the server. */
export function keyDto(r: KeyRow) {
  return {
    id: r.id,
    provider: r.provider,
    label: r.label,
    hint: `••••${r.last4}`,
    status: r.status,
    info: parseJson<Record<string, unknown>>(r.info_json, {}),
    createdAt: r.created_at,
    validatedAt: r.validated_at,
  };
}

export function listKeys(userId: string) {
  return getDb().all<KeyRow>('SELECT * FROM provider_keys WHERE user_id = ? ORDER BY provider', userId).map(keyDto);
}

export async function saveKey(userId: string, provider: ProviderId, secret: string, label = 'default', skipValidation = false) {
  const adapter = getProvider(provider);
  const trimmed = secret.trim();
  if (trimmed.length < 8) throw new HttpError(400, 'INVALID_KEY', 'Key looks too short');
  let status = 'unchecked', info: Record<string, unknown> = {}, validatedAt: number | null = null;
  if (!skipValidation) {
    const check = await adapter.validateKey(trimmed).catch((e: Error) => ({ ok: false, message: e.message, info: undefined }));
    if (!check.ok) throw new HttpError(400, 'INVALID_KEY', check.message);
    status = 'valid';
    info = check.info ?? {};
    validatedAt = Date.now();
  }
  const db = getDb();
  const existing = db.get<{ id: string }>('SELECT id FROM provider_keys WHERE user_id = ? AND provider = ?', userId, provider);
  const enc = encryptSecret(trimmed);
  if (existing) {
    db.run('UPDATE provider_keys SET label=?, secret_enc=?, last4=?, status=?, info_json=?, validated_at=? WHERE id=?', label, enc, trimmed.slice(-4), status, JSON.stringify(info), validatedAt, existing.id);
  } else {
    db.run(
      'INSERT INTO provider_keys (id,user_id,provider,label,secret_enc,last4,status,info_json,created_at,validated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      newId('key_'), userId, provider, label, enc, trimmed.slice(-4), status, JSON.stringify(info), Date.now(), validatedAt,
    );
  }
  balanceCache.delete(`${userId}:${provider}`);
  return listKeys(userId).find((k) => k.provider === provider)!;
}

export async function revalidateKey(userId: string, provider: ProviderId) {
  const secret = getSecret(userId, provider);
  const check = await getProvider(provider).validateKey(secret).catch((e: Error) => ({ ok: false, message: e.message, info: undefined }));
  getDb().run('UPDATE provider_keys SET status=?, info_json=?, validated_at=? WHERE user_id=? AND provider=?', check.ok ? 'valid' : 'invalid', JSON.stringify(check.info ?? {}), Date.now(), userId, provider);
  return { ...check, key: listKeys(userId).find((k) => k.provider === provider) };
}

export function deleteKey(userId: string, provider: string) {
  balanceCache.delete(`${userId}:${provider}`);
  getDb().run('DELETE FROM provider_keys WHERE user_id = ? AND provider = ?', userId, provider);
}

/**
 * Whose key pays for this user's calls to a provider: the user's own key, otherwise — when an administrator allowed it
 * (shared keys) — the key of the admin who created the account, or of the oldest admin that has one.
 */
export function keyOwner(userId: string, provider: string): string | null {
  const db = getDb();
  if (db.get('SELECT 1 FROM provider_keys WHERE user_id = ? AND provider = ?', userId, provider)) return userId;
  const shared = db.get<{ shared_keys: number; created_by: string | null }>(
    'SELECT s.shared_keys, u.created_by FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?', userId,
  );
  if (!shared?.shared_keys) return null;
  const admin = db.get<{ id: string }>(
    `SELECT u.id FROM users u JOIN provider_keys k ON k.user_id = u.id AND k.provider = ?
     WHERE u.role = 'admin' AND u.disabled_at IS NULL ORDER BY (u.id = ?) DESC, u.created_at LIMIT 1`, provider, shared.created_by ?? '',
  );
  return admin?.id ?? null;
}

/** Decrypt a key for server-side use only. */
export function getSecret(userId: string, provider: string): string {
  const owner = keyOwner(userId, provider);
  const row = owner ? getDb().get<KeyRow>('SELECT * FROM provider_keys WHERE user_id = ? AND provider = ?', owner, provider) : undefined;
  if (!row) throw new HttpError(400, 'MISSING_API_KEY', `No ${provider} API key configured. Add one in Settings → Provider keys.`);
  return decryptSecret(row.secret_enc);
}

// ── Balance (remaining prepaid credit) ──

export interface BalanceDto {
  provider: string;
  name: string;
  configured: boolean;
  /** 'ok' | 'needs_billing_key' (key not allowed to read billing) | 'unavailable' | 'not_supported' | 'not_configured' | 'shared' (uses an admin's key) */
  status: string;
  balanceUsd: number | null;
  detail?: string;
  message?: string;
  billingKey: string | null;
  checkedAt: number;
}

const balanceCache = new Map<string, { at: number; dto: BalanceDto }>();
const BALANCE_TTL = 60_000;

function billingSecret(userId: string, provider: string): string | null {
  const row = getDb().get<{ billing_secret_enc: string | null }>('SELECT billing_secret_enc FROM provider_keys WHERE user_id = ? AND provider = ?', userId, provider);
  return row?.billing_secret_enc ? decryptSecret(row.billing_secret_enc) : null;
}

/** Forget cached balances (after a job spent credit). */
export function invalidateBalances(userId: string): void {
  const owners = new Set([userId]);
  // A job paid with a shared key spent the admin's credit.
  for (const p of Object.keys(PROVIDERS)) { const o = keyOwner(userId, p); if (o) owners.add(o); }
  for (const key of balanceCache.keys()) if (owners.has(key.split(':')[0]!)) balanceCache.delete(key);
}

/** Remaining balance per provider. The optional billing key is tried first (fal.ai only shows billing to ADMIN keys). */
export async function getBalances(userId: string, opts: { fresh?: boolean } = {}): Promise<BalanceDto[]> {
  const out: BalanceDto[] = [];
  for (const p of Object.values(PROVIDERS)) {
    const cacheKey = `${userId}:${p.id}`;
    const hit = balanceCache.get(cacheKey);
    if (!opts.fresh && hit && Date.now() - hit.at < BALANCE_TTL) { out.push(hit.dto); continue; }
    const row = getDb().get<{ billing_last4: string | null }>('SELECT billing_last4 FROM provider_keys WHERE user_id = ? AND provider = ?', userId, p.id);
    const base = { provider: p.id, name: p.name, configured: !!row, billingKey: row?.billing_last4 ? `••••${row.billing_last4}` : null, checkedAt: Date.now() };
    let dto: BalanceDto;
    // The administrators' credit is not shown to accounts that only borrow their keys: they see their allowance instead.
    if (!row && keyOwner(userId, p.id)) dto = { ...base, status: 'shared', balanceUsd: null };
    else if (!row) dto = { ...base, status: 'not_configured', balanceUsd: null };
    else if (!p.getBalance) dto = { ...base, status: 'not_supported', balanceUsd: null };
    else {
      const keys = [billingSecret(userId, p.id), getSecret(userId, p.id)].filter((k): k is string => !!k);
      let res = await p.getBalance(keys[0]);
      if (!res.ok && keys.length > 1 && res.reason === 'forbidden') res = await p.getBalance(keys[1]);
      dto = res.ok
        ? { ...base, status: 'ok', balanceUsd: Math.round(res.usd * 100) / 100, detail: res.detail }
        : { ...base, status: res.reason === 'forbidden' ? 'needs_billing_key' : 'unavailable', balanceUsd: null, message: res.message };
    }
    balanceCache.set(cacheKey, { at: Date.now(), dto });
    out.push(dto);
  }
  return out;
}

/** Store (after checking it can read the balance) or remove the read-only billing key of a provider. */
export async function setBillingKey(userId: string, provider: ProviderId, secret: string | null) {
  if (keyOwner(userId, provider) !== userId) throw new HttpError(400, 'MISSING_API_KEY', `Add your ${provider} API key first.`);
  if (secret === null) {
    getDb().run('UPDATE provider_keys SET billing_secret_enc = NULL, billing_last4 = NULL WHERE user_id = ? AND provider = ?', userId, provider);
  } else {
    const adapter = getProvider(provider);
    if (!adapter.getBalance) throw new HttpError(400, 'NOT_SUPPORTED', `${adapter.name} does not expose a balance.`);
    const trimmed = secret.trim();
    const res = await adapter.getBalance(trimmed);
    if (!res.ok) throw new HttpError(400, 'INVALID_KEY', res.message);
    getDb().run('UPDATE provider_keys SET billing_secret_enc = ?, billing_last4 = ? WHERE user_id = ? AND provider = ?', encryptSecret(trimmed), trimmed.slice(-4), userId, provider);
  }
  balanceCache.delete(`${userId}:${provider}`);
  return (await getBalances(userId)).find((b) => b.provider === provider)!;
}

/** True when the user can call this provider, with their own key or a shared one. */
export function hasKey(userId: string, provider: string): boolean {
  return keyOwner(userId, provider) !== null;
}
