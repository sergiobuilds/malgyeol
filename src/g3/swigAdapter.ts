import type { PolicyMandate } from './types.ts';

export interface SwigTokenDestinationLimit {
  mint: string;
  destinationTokenAccount: string;
  cumulativeAmount: bigint;
}

export class SwigInputBuilder {
  static buildLimitFromMandate(mandate: PolicyMandate): SwigTokenDestinationLimit {
    return {
      mint: mandate.mint,
      destinationTokenAccount: mandate.escrowDestination,
      cumulativeAmount: mandate.exactAmount
    };
  }
}
