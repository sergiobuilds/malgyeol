import { createHash } from 'node:crypto';

export function generateFingerprint(method: string, pathname: string, bodyBytes: Buffer, idempotencyKey: string): string {
  const hash = createHash('sha256');
  hash.update(method);
  hash.update('\0');
  hash.update(pathname);
  hash.update('\0');
  hash.update(bodyBytes);
  hash.update('\0');
  hash.update(idempotencyKey);
  return hash.digest('hex');
}

export function generateIntentIds(orderId: string, fingerprint: string): { eventId: string; paymentIntentId: string } {
  const base = createHash('sha256').update(orderId).update('\0').update(fingerprint).digest('hex');
  return {
    eventId: `evt_${base.slice(0, 32)}`,
    paymentIntentId: `pi_${base.slice(32, 64)}`
  };
}

export function hashString(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}
