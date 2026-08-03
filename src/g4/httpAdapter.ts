import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CoreResponse } from './serverCore.ts';
import type { RawRequest } from './types.ts';

const MAX_BODY_BYTES = 65_536;

export async function readRawRequest(request: IncomingMessage): Promise<RawRequest> {
  const method = request.method ?? 'GET';
  const pathname = new URL(request.url ?? '/', 'http://merchant.local').pathname;
  const idempotencyHeader = request.headers['idempotency-key'];
  const idempotencyKey = Array.isArray(idempotencyHeader) ? idempotencyHeader[0] ?? '' : idempotencyHeader ?? '';
  const paymentValue = request.headers['payment-signature'] ?? request.headers['x-payment'];
  const paymentHeader = Array.isArray(paymentValue) ? paymentValue[0] : paymentValue;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_BODY_BYTES) throw new Error('Request body exceeds 64 KiB');
    chunks.push(bytes);
  }
  return {
    method,
    pathname,
    bodyBytes: Buffer.concat(chunks),
    idempotencyKey,
    ...(paymentHeader ? { paymentHeader } : {})
  };
}

export function writeCoreResponse(response: ServerResponse, result: CoreResponse): void {
  response.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
  response.end(result.body);
}
