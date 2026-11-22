import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function bool(name: string, fallback: boolean): boolean {
  const v = env(name);
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const dataDir = path.resolve(env('SPRIXY_DATA_DIR', path.resolve(process.cwd(), 'data'))!);
mkdirSync(dataDir, { recursive: true });

/**
 * Master key used to encrypt provider API keys (AES-256-GCM).
 * Prefer SPRIXY_MASTER_KEY (32 bytes, base64 or hex). If missing, a key is generated once
 * and stored in the data directory (keep that volume private and backed up).
 */
function loadMasterKey(): { key: Buffer; source: 'env' | 'file' } {
  const raw = env('SPRIXY_MASTER_KEY');
  if (raw) {
    const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32) throw new Error('SPRIXY_MASTER_KEY must decode to exactly 32 bytes (base64 or hex)');
    return { key: buf, source: 'env' };
  }
  const file = path.join(dataDir, 'master.key');
  if (existsSync(file)) return { key: Buffer.from(readFileSync(file, 'utf8').trim(), 'base64'), source: 'file' };
  const key = randomBytes(32);
  writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  return { key, source: 'file' };
}

const master = loadMasterKey();

export const config = {
  port: Number(env('PORT', '3210')),
  host: env('HOST', '0.0.0.0')!,
  publicUrl: env('SPRIXY_PUBLIC_URL'),
  dataDir,
  dbPath: path.join(dataDir, 'sprixy.db'),
  filesDir: path.join(dataDir, 'files'),
  tmpDir: path.join(dataDir, 'tmp'),
  masterKey: master.key,
  masterKeySource: master.source,
  allowSignup: bool('SPRIXY_ALLOW_SIGNUP', false),
  secureCookies: bool('SPRIXY_SECURE_COOKIES', false),
  sessionDays: Number(env('SPRIXY_SESSION_DAYS', '30')),
  webDist: env('SPRIXY_WEB_DIST'),
  ffmpegPath: env('FFMPEG_PATH'),
  maxUploadMb: Number(env('SPRIXY_MAX_UPLOAD_MB', '50')),
  pollIntervalMs: Number(env('SPRIXY_POLL_INTERVAL_MS', '1500')),
  jobTimeoutMs: Number(env('SPRIXY_JOB_TIMEOUT_MS', String(30 * 60 * 1000))),
  logLevel: env('LOG_LEVEL', 'info')!,
};

mkdirSync(config.filesDir, { recursive: true });
mkdirSync(config.tmpDir, { recursive: true });
