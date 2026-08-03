import { createHash } from 'node:crypto';
import type { ProofPaymentAdapter } from './caseCoordinator.ts';

export class DemoProofPaymentAdapter implements ProofPaymentAdapter {
  private readonly receipts = new Map<string, Awaited<ReturnType<ProofPaymentAdapter['pay']>>>();
  public paymentCount = 0;

  async pay(input: Parameters<ProofPaymentAdapter['pay']>[0]) {
    const existing = this.receipts.get(input.caseId);
    if (existing) return existing;
    this.paymentCount += 1;
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const receipt = Object.freeze({
      paymentIntentId: `demo_pay_${fingerprint.slice(0, 16)}`,
      settlementTransaction: `SIMULATED_NO_DEVNET_CREDENTIALS_${fingerprint.slice(0, 16)}`,
      settlementProofBaseUnits: input.settlementProofBaseUnits
    });
    this.receipts.set(input.caseId, receipt);
    return receipt;
  }
}
