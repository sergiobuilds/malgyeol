import { createHash } from 'node:crypto';
import type { PaymentExecutor } from './caseCoordinator.ts';

export class InMemoryPaymentExecutor implements PaymentExecutor {
  private readonly receipts = new Map<string, Awaited<ReturnType<PaymentExecutor['authorize']>>>();
  public authorizationCount = 0;

  async authorize(input: Parameters<PaymentExecutor['authorize']>[0]) {
    const existing = this.receipts.get(input.caseId);
    if (existing) return existing;
    this.authorizationCount += 1;
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const receipt = Object.freeze({
      paymentAuthorizationId: `demo_auth_${fingerprint.slice(0, 16)}`,
      paymentReference: `SIMULATED_PAYMENT_${fingerprint.slice(0, 16)}`,
      authorizedAmountKrw: input.amountKrw
    });
    this.receipts.set(input.caseId, receipt);
    return receipt;
  }
}
