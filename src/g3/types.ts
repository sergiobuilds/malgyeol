export type AuthorizationState = 'RESERVED' | 'SIGNED' | 'SIGN_FAILED';

export interface OrderRequest {
  mandateId: string;
  fundId: string;
  sku: string;
  merchantId: string;
  mint: string;
  destinationAccount: string;
  amount: bigint;
  consentCommitment: string;
  orderNonce: string;
}

export interface PolicyMandate {
  mandateId: string;
  revision: number;
  fundId: string;
  approvedSku: string;
  merchantId: string;
  mint: string;
  escrowDestination: string;
  exactAmount: bigint;
  validFrom: number;
  validUntil: number;
  remainingBalance: bigint;
  revoked: boolean;
}

export interface SigningEnvelope {
  mandateId: string;
  fundId: string;
  merchantId: string;
  mint: string;
  destinationAccount: string;
  amount: bigint;
  consentCommitment: string;
  orderNonce: string;
  mandateHash: string;
}

export interface RepositoryOperationResult {
  success: boolean;
  reason?: string;
  mandate?: PolicyMandate;
}

export interface MandateRepository {
  getMandate(mandateId: string): Promise<PolicyMandate | undefined>;
  reserve(mandateId: string, revision: number, expectedMandateHash: string, amount: bigint, nonce: string): Promise<RepositoryOperationResult>;
  markTerminalState(nonce: string, state: 'SIGNED' | 'SIGN_FAILED'): Promise<void>;
  createOrUpdateMandate(mandate: PolicyMandate): Promise<void>;
  revokeMandate(mandateId: string, revision: number): Promise<void>;
}

export interface Signer {
  sign(envelope: SigningEnvelope): Promise<{ signature: string }>;
}

export interface Clock {
  now(): number;
}
