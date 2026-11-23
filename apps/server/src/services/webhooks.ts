import { createHmac } from 'node:crypto';
import { getDb, parseJson } from '../db/index.js';
import { randomToken } from '../lib/crypto.js';

/** Per-user signing secret for job webhooks (created on first use). */
export function getWebhookSecret(userId: string, rotate = false): string {
  const db = getDb();
  const row = db.get<{ webhook_secret: string | null }>('SELECT webhook_secret FROM user_settings WHERE user_id = ?', userId);
  if (row?.webhook_secret && !rotate) return row.webhook_secret;
  const secret = `whsec_${randomToken(24)}`;
  db.run(
    `INSERT INTO user_settings (user_id, webhook_secret) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET webhook_secret = excluded.webhook_secret`,
    userId, secret,
  );
  return secret;
}

export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * POST the finished generation to the job's webhook URL.
 * Headers: X-Sprixy-Event, X-Sprixy-Timestamp, X-Sprixy-Signature: sha256=HMAC_SHA256(secret, `${timestamp}.${body}`).
 * Retries 3 times with backoff on network errors / non-2xx. The delivery result is stored on the generation.
 */
export async function deliverWebhook(userId: string, generationId: string, url: string, payload: unknown): Promise<void> {
  const secret = getWebhookSecret(userId);
  const body = JSON.stringify({ event: 'generation.finished', data: payload });
  let last = '';
  let attempt = 0;
  for (; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1000 * 4 ** (attempt - 1)));
    const ts = Math.floor(Date.now() / 1000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Sprixy-Webhook/1',
          'X-Sprixy-Event': 'generation.finished',
          'X-Sprixy-Timestamp': String(ts),
          'X-Sprixy-Signature': `sha256=${signPayload(secret, ts, body)}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      last = `HTTP ${res.status}`;
      if (res.ok) break;
    } catch (e) {
      last = (e as Error).message;
    }
  }
  const db = getDb();
  const prev = parseJson<Record<string, unknown>>(db.get<{ result_json: string }>('SELECT result_json FROM generations WHERE id = ?', generationId)?.result_json, {});
  db.run('UPDATE generations SET result_json = ? WHERE id = ?', JSON.stringify({ ...prev, webhook: { url, attempts: Math.min(attempt + 1, 4), result: last, at: Date.now() } }), generationId);
}
