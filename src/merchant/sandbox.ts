import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MerchantTrackingState } from '../e2e/merchantAdapter.ts';
import {
  InMemoryMerchantSandboxStore,
  type MerchantSandboxStore,
  type SandboxOrderInput,
  type StoredSandboxOrder
} from './store.ts';

export const MERCHANT_SANDBOX_ID = 'BENEFIT_RAIL_SELF_OWNED_SANDBOX' as const;
export const MERCHANT_SANDBOX_SKUS = Object.freeze(['ASSISTIVE_STAND_AID_01'] as const);

export class MerchantSandbox {
  constructor(private readonly store: MerchantSandboxStore = new InMemoryMerchantSandboxStore()) {}

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/sandbox/identity') {
      return json(200, { sandbox: true, provider: MERCHANT_SANDBOX_ID });
    }
    if (request.method === 'POST' && url.pathname === '/sandbox/orders') {
      return this.createOrder(request);
    }
    const match = url.pathname.match(/^\/sandbox\/orders\/([^/]+)\/tracking$/);
    if (match && request.method === 'GET') return this.getTracking(decodeURIComponent(match[1]!));
    if (match && request.method === 'POST') return this.advanceTracking(decodeURIComponent(match[1]!), request);
    return json(404, { sandbox: true, error: 'NOT_FOUND' });
  }

  private async createOrder(request: Request): Promise<Response> {
    let value: unknown;
    try { value = await request.json(); } catch { return json(400, { sandbox: true, error: 'INVALID_JSON' }); }
    let input: SandboxOrderInput;
    try { input = parseOrder(value); } catch (error) {
      return json(400, { sandbox: true, error: 'INVALID_ORDER', detail: error instanceof Error ? error.message : 'Invalid order' });
    }
    const key = `${input.caseId}:${input.paymentIntentId}`;
    const fingerprint = hash(canonical(input));
    const providerOrderId = `SANDBOX-${hash(key).slice(0, 16).toUpperCase()}`;
    const order: StoredSandboxOrder = { input, fingerprint, providerOrderId, state: 'ORDERED' };
    const result = await this.store.create(order);
    if (result.outcome === 'conflict') return json(409, { sandbox: true, error: 'IDEMPOTENCY_CONFLICT' });
    return json(result.outcome === 'created' ? 201 : 200, publicOrder(result.order, result.outcome === 'replayed'));
  }

  private async getTracking(providerOrderId: string): Promise<Response> {
    const order = await this.store.get(providerOrderId);
    return order ? json(200, tracking(order)) : json(404, { sandbox: true, error: 'ORDER_NOT_FOUND' });
  }

  private async advanceTracking(providerOrderId: string, request: Request): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); } catch { return json(400, { sandbox: true, error: 'INVALID_JSON' }); }
    if (!isExactRecord(body, ['state']) || !isTrackingState(body.state)) return json(400, { sandbox: true, error: 'INVALID_TRACKING_STATE' });
    const result = await this.store.advance(providerOrderId, body.state);
    if (result.outcome === 'not_found') return json(404, { sandbox: true, error: 'ORDER_NOT_FOUND' });
    if (result.outcome === 'invalid_transition') return json(409, { sandbox: true, error: 'INVALID_TRACKING_TRANSITION', state: result.state });
    return json(200, tracking(result.order));
  }
}

export function createMerchantSandboxNodeHandler(sandbox = new MerchantSandbox(), writeSecret?: string) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (writeSecret && request.method === 'POST' && !authorized(request.headers.authorization, writeSecret)) {
      response.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ sandbox: true, error: 'UNAUTHORIZED' }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const origin = `http://${request.headers.host ?? 'merchant-sandbox.local'}`;
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const webRequest = new Request(new URL(request.url ?? '/', origin), { method: request.method, headers: request.headers as HeadersInit, ...(body ? { body } : {}), duplex: 'half' } as RequestInit);
    const result = await sandbox.handle(webRequest);
    response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
    response.end(Buffer.from(await result.arrayBuffer()));
  };
}

function authorized(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function parseOrder(value: unknown): SandboxOrderInput {
  const keys = ['caseId', 'sku', 'quantity', 'merchantId', 'programAmountKrw', 'paymentIntentId'];
  if (!isExactRecord(value, keys)) throw new Error('Unexpected or missing fields');
  if (!safeId(value.caseId, /^case_[A-Za-z0-9_-]{1,120}$/)) throw new Error('Invalid caseId');
  if (!MERCHANT_SANDBOX_SKUS.includes(value.sku as typeof MERCHANT_SANDBOX_SKUS[number])) throw new Error('SKU is not allowlisted');
  if (value.merchantId !== 'DEMO_ACCESS_STORE') throw new Error('Invalid merchantId');
  if (!Number.isSafeInteger(value.quantity) || (value.quantity as number) < 1 || (value.quantity as number) > 10) throw new Error('Invalid quantity');
  if (!Number.isSafeInteger(value.programAmountKrw) || (value.programAmountKrw as number) < 1 || (value.programAmountKrw as number) > 10_000_000) throw new Error('Invalid programAmountKrw');
  if (!safeId(value.paymentIntentId, /^[A-Za-z0-9_-]{1,128}$/)) throw new Error('Invalid paymentIntentId');
  return value as unknown as SandboxOrderInput;
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}
function safeId(value: unknown, pattern: RegExp): value is string { return typeof value === 'string' && pattern.test(value); }
function isTrackingState(value: unknown): value is MerchantTrackingState { return value === 'ORDERED' || value === 'PACKED' || value === 'SHIPPED' || value === 'DELIVERED'; }
function canonical(input: SandboxOrderInput): string { return JSON.stringify([input.caseId, input.paymentIntentId, input.sku, input.quantity, input.merchantId, input.programAmountKrw]); }
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function publicOrder(order: StoredSandboxOrder, replayed: boolean) { return { sandbox: true, provider: MERCHANT_SANDBOX_ID, providerOrderId: order.providerOrderId, state: order.state, replayed }; }
function tracking(order: StoredSandboxOrder) { return { sandbox: true, provider: MERCHANT_SANDBOX_ID, providerOrderId: order.providerOrderId, state: order.state }; }
function json(status: number, body: unknown): Response { return Response.json(body, { status, headers: { 'cache-control': 'no-store' } }); }
