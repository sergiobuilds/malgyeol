import type { MerchantAdapter, MerchantOrderResult, MerchantTrackingResult } from '../e2e/merchantAdapter.ts';

export class HttpMerchantSandboxAdapter implements MerchantAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly writeSecret?: string
  ) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Merchant sandbox URL must use HTTP(S)');
  }

  async submit(input: Parameters<MerchantAdapter['submit']>[0]): Promise<MerchantOrderResult> {
    const response = await this.fetcher(new URL('/sandbox/orders', this.baseUrl), {
      method: 'POST', headers: {
        'content-type': 'application/json',
        ...(this.writeSecret ? { authorization: `Bearer ${this.writeSecret}` } : {})
      }, body: JSON.stringify(input)
    });
    const body = await parseResponse(response);
    if (!response.ok) throw new Error(`Merchant sandbox order failed (${response.status}): ${errorCode(body)}`);
    if (body.sandbox !== true || typeof body.providerOrderId !== 'string') throw new Error('Invalid merchant sandbox order response');
    return { providerOrderId: body.providerOrderId };
  }

  async track(providerOrderId: string): Promise<MerchantTrackingResult> {
    if (!/^SANDBOX-[A-F0-9]{16}$/.test(providerOrderId)) throw new Error('Invalid sandbox providerOrderId');
    const response = await this.fetcher(new URL(`/sandbox/orders/${encodeURIComponent(providerOrderId)}/tracking`, this.baseUrl));
    const body = await parseResponse(response);
    if (!response.ok) throw new Error(`Merchant sandbox tracking failed (${response.status}): ${errorCode(body)}`);
    if (body.sandbox !== true || body.providerOrderId !== providerOrderId || !isState(body.state)) throw new Error('Invalid merchant sandbox tracking response');
    return { sandbox: true, providerOrderId, state: body.state };
  }
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid merchant sandbox JSON response');
  return value as Record<string, unknown>;
}
function errorCode(body: Record<string, unknown>): string { return typeof body.error === 'string' ? body.error : 'UNKNOWN_ERROR'; }
function isState(value: unknown): value is MerchantTrackingResult['state'] { return value === 'ORDERED' || value === 'PACKED' || value === 'SHIPPED' || value === 'DELIVERED'; }
