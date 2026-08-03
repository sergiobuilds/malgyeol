import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyClawOpsSignature(
  signingKey: string,
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  if (!signingKey || !signature) return false;
  const payload = url + Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}${value}`)
    .join('');
  const expected = createHmac('sha256', signingKey).update(payload).digest('base64');
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
