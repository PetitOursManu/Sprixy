import { getDb, parseJson } from '../db/index.js';
import { encryptSecret, decryptSecret, newId } from '../lib/crypto.js';
import { getProvider } from '../providers/registry.js';
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
  return listKeys(userId).find((k) => k.provider === provider)!;
}

export async function revalidateKey(userId: string, provider: ProviderId) {
  const secret = getSecret(userId, provider);
  const check = await getProvider(provider).validateKey(secret).catch((e: Error) => ({ ok: false, message: e.message, info: undefined }));
  getDb().run('UPDATE provider_keys SET status=?, info_json=?, validated_at=? WHERE user_id=? AND provider=?', check.ok ? 'valid' : 'invalid', JSON.stringify(check.info ?? {}), Date.now(), userId, provider);
  return { ...check, key: listKeys(userId).find((k) => k.provider === provider) };
}

export function deleteKey(userId: string, provider: string) {
  getDb().run('DELETE FROM provider_keys WHERE user_id = ? AND provider = ?', userId, provider);
}

/** Decrypt a key for server-side use only. */
export function getSecret(userId: string, provider: string): string {
  const row = getDb().get<KeyRow>('SELECT * FROM provider_keys WHERE user_id = ? AND provider = ?', userId, provider);
  if (!row) throw new HttpError(400, 'MISSING_API_KEY', `No ${provider} API key configured. Add one in Settings → Provider keys.`);
  return decryptSecret(row.secret_enc);
}

export function hasKey(userId: string, provider: string): boolean {
  return !!getDb().get('SELECT 1 FROM provider_keys WHERE user_id = ? AND provider = ?', userId, provider);
}
