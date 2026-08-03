export type IntentState = 'CREATED' | '402_ISSUED' | 'PAID' | 'REJECTED';
export type OutboxState = 'PENDING' | 'DONE';

export const FIXED_SKU = 'DEMO_MEAL_01';
export const FIXED_AMOUNT = 1_000_000;
export const FIXED_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

export interface PaymentIntent {
  eventId: string;
  paymentIntentId: string;
  state: IntentState;
  orderId: string;
  fingerprint: string;
  paymentRequiredHeaderHash?: string;
  paymentResponseHash?: string;
  paymentResponseHeader?: string;
  settlementTransaction?: string;
  paidBodyHex?: string;
}

export interface Receipt {
  eventId: string;
  orderId: string;
  paymentIntentId: string;
  fingerprint: string;
  mint: string;
  baseUnits: number;
  merchant: string;
  transaction: string;
  paymentResponseHash: string;
}

export interface PaidJournal {
  eventId: string;
  receipt: Receipt;
  paymentResponseHeader: string;
  paidBodyHex: string;
  settlementTransaction: string;
  fulfillmentKey: string;
  outboxState: OutboxState;
}

export interface RawRequest {
  method: string;
  pathname: string;
  bodyBytes: Buffer;
  idempotencyKey: string;
  paymentHeader?: string;
}

export interface GatewayChallenge {
  kind: 'challenge';
  response: Buffer | string;
  exactPaymentRequiredHeader: string;
}

export interface GatewayPaid {
  kind: 'paid';
  settlementTransaction: string;
  paymentResponseHeader: string;
  paymentCredentialHash: string;
}

export interface GatewayRejected {
  kind: 'rejected';
  reason: string;
}

export type GatewayResult = GatewayChallenge | GatewayPaid | GatewayRejected;

export interface Gateway {
  process(req: RawRequest, intent: Readonly<PaymentIntent>): Promise<GatewayResult>;
}
