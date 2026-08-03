import { createHmac, timingSafeEqual } from 'node:crypto';

export class ContinuationTokenService {
  constructor(private readonly secret: string, private readonly now: () => number = Date.now) {
    if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('Continuation token secret must be at least 32 bytes');
  }

  issue(caseId: string, ttlMs = 15 * 60_000): { token: string; expiresAt: number } {
    validateCaseId(caseId);
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 60 * 60_000) throw new Error('Invalid continuation TTL');
    const expiresAt = this.now() + ttlMs;
    return { token: `${expiresAt}.${this.signature(caseId, expiresAt)}`, expiresAt };
  }

  verify(caseId: string, token: string | undefined): boolean {
    if (!token || !/^\d+\.[a-f0-9]{64}$/.test(token)) return false;
    try { validateCaseId(caseId); } catch { return false; }
    const [rawExpiry, suppliedHex] = token.split('.');
    const expiresAt = Number(rawExpiry);
    if (!Number.isSafeInteger(expiresAt) || expiresAt < this.now()) return false;
    const supplied = Buffer.from(suppliedHex!, 'hex');
    const expected = Buffer.from(this.signature(caseId, expiresAt), 'hex');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  private signature(caseId: string, expiresAt: number): string {
    return createHmac('sha256', this.secret)
      .update(JSON.stringify({ version: 'phone-web-continuation-v1', caseId, expiresAt }))
      .digest('hex');
  }
}

function validateCaseId(caseId: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(caseId)) throw new Error('Invalid caseId');
}
