import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;

/** Encrypt a secret with AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.masterKey, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(blob: string): string {
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', config.masterKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

const SCRYPT = { N: 16384, r: 8, p: 1 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const hash = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { ...SCRYPT, N: Number(n) });
  return timingSafeEqual(hash, expected);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function newId(prefix = ''): string {
  // Sortable-ish id: time component + randomness
  const t = Date.now().toString(36).padStart(9, '0');
  return prefix + t + randomBytes(6).toString('hex');
}
