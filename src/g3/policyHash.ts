import { createHash } from 'node:crypto';
import type { PolicyMandate } from './types.ts';

export function hashMandate(mandate: PolicyMandate): string {
  const payload = JSON.stringify({
    mandateId: mandate.mandateId,
    revision: mandate.revision,
    fundId: mandate.fundId,
    approvedSku: mandate.approvedSku,
    merchantId: mandate.merchantId,
    mint: mandate.mint,
    escrowDestination: mandate.escrowDestination,
    exactAmount: mandate.exactAmount.toString(),
    validFrom: mandate.validFrom,
    validUntil: mandate.validUntil
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
