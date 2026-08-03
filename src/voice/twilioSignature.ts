import { createHmac, timingSafeEqual } from 'node:crypto';

export function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const payload = Object.keys(params).sort().reduce((value, key) => value + key + params[key], url);
  return createHmac('sha1', authToken).update(payload).digest('base64');
}

export function verifyTwilioSignature(authToken: string, provided: string, url: string, params: Record<string, string>): boolean {
  const expected = Buffer.from(computeTwilioSignature(authToken, url, params));
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
