import { createHash } from 'node:crypto';
import type { MerchantAdapter, MerchantOrderResult } from './merchantAdapter.ts';

export class DemoMerchantAdapter implements MerchantAdapter {
  private readonly orders = new Map<string, MerchantOrderResult>();

  async submit(input: Parameters<MerchantAdapter['submit']>[0]): Promise<MerchantOrderResult> {
    const idempotencyKey = `${input.caseId}:${input.paymentAuthorizationId}`;
    const existing = this.orders.get(idempotencyKey);
    if (existing) return existing;
    const suffix = createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 12).toUpperCase();
    const order = Object.freeze({ providerOrderId: `DEMO-${suffix}` });
    this.orders.set(idempotencyKey, order);
    return order;
  }
}
