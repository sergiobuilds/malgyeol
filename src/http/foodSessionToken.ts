import { createHmac, timingSafeEqual } from 'node:crypto';

export class FoodSessionTokenService {
  constructor(private readonly secret: string, private readonly now: () => number = Date.now) {
    if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('Food session token secret must be at least 32 bytes');
  }

  issue(caseId: string, sessionId: string, ttlMs = 30 * 60_000): { token: string; expiresAt: number } {
    validateIdentifier(caseId, 'caseId'); validateIdentifier(sessionId, 'sessionId');
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 60 * 60_000) throw new Error('Invalid food session TTL');
    const expiresAt = this.now() + ttlMs;
    const encoded = Buffer.from(JSON.stringify({ version: 'food-session-v1', caseId, sessionId, expiresAt })).toString('base64url');
    return { token: `${encoded}.${this.signature(encoded)}`, expiresAt };
  }

  verify(caseId: string, token: string | undefined): boolean {
    if (!token) return false;
    const [encoded, suppliedHex, extra] = token.split('.');
    if (!encoded || !suppliedHex || extra || !/^[a-f0-9]{64}$/.test(suppliedHex)) return false;
    const supplied = Buffer.from(suppliedHex, 'hex');
    const expected = Buffer.from(this.signature(encoded), 'hex');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
    try {
      const claim = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>;
      return claim.version === 'food-session-v1' && claim.caseId === caseId
        && typeof claim.sessionId === 'string' && Number.isSafeInteger(claim.expiresAt)
        && Number(claim.expiresAt) >= this.now();
    } catch { return false; }
  }

  private signature(encoded: string): string {
    return createHmac('sha256', this.secret).update(encoded).digest('hex');
  }
}

function validateIdentifier(value: string, name: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`Invalid ${name}`);
}
