export type CaseState =
  | 'CALL_CONNECTED' | 'AUDIO_CAPTURED' | 'INTERPRETED' | 'NEEDS_CLARIFICATION'
  | 'POLICY_CHECKING' | 'POLICY_BLOCKED' | 'AWAITING_CONFIRMATION' | 'USER_REJECTED'
  | 'CONFIRMATION_EXPIRED' | 'CONFIRMED' | 'PAYMENT_AUTHORIZING' | 'AUTHORIZATION_FAILED'
  | 'PAYMENT_REQUIRED' | 'PAYMENT_FAILED' | 'PAID' | 'ORDER_SUBMITTING'
  | 'ORDER_REVIEW_REQUIRED' | 'ORDERED';

export interface ProgramTemplate {
  programId: string;
  version: number;
  officialName: string;
  sourceUrls: string[];
  currency: 'KRW';
  eligibilityOwnedBy: 'LEGACY_INSTITUTION';
  prohibitedCategories: string[];
  validFrom: number;
  validUntil: number;
}

export interface Enrollment {
  beneficiaryRef: string;
  programId: string;
  planId: string;
  planRevision: number;
  active: boolean;
  monthlyLimitKrw: number;
  remainingKrw: number;
  approvedCategories: string[];
  approvedSkus: string[];
  approvedMerchants: string[];
  maximumPurchaseKrw: number;
  validFrom: number;
  validUntil: number;
}

export interface CatalogItem {
  sku: string;
  category: string;
  merchantId: string;
  productName: string;
  unitPriceKrw: number;
  deliveryAvailable: boolean;
}

export interface PurchaseCandidate {
  caseId: string;
  sku: string;
  category: string;
  quantity: number;
  merchantId: string;
  unitPriceKrw: number;
  totalPriceKrw: number;
  programAmountKrw: number;
  substitutionsAllowed: boolean;
  confidence: number;
  ambiguityReasons: string[];
  readbackSentence: string;
}

export interface PolicyCheck { rule: string; pass: boolean; }
export interface PolicyDecision {
  decision: 'APPROVED' | 'BLOCKED';
  policyVersion: 'kr-disability-personal-budget-demo-v2' | 'kr-agri-food-voucher-compatible-2026-v1';
  checks: PolicyCheck[];
  policySnapshotHash: string;
}

export interface BenefitCase {
  caseId: string;
  callSidHash: string;
  beneficiaryRef: string;
  programId: string;
  planId: string;
  state: CaseState;
  candidate?: PurchaseCandidate;
  policy?: PolicyDecision;
  policySnapshotHash?: string;
  confirmationExpiresAt?: number;
  confirmationCommitment?: string;
  paymentAuthorizationId?: string;
  paymentReference?: string;
  authorizedAmountKrw?: number;
  providerOrderId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CaseEvent {
  caseId: string;
  sequence: number;
  state: CaseState;
  at: number;
  data: Record<string, unknown>;
}

export interface InterpretedPurchase {
  requestedCategory: string;
  requestedSku: string;
  quantity: number;
  substitutionsAllowed: boolean;
  referencesApprovedPlan: boolean;
  confidence: number;
  ambiguityReasons: string[];
  safeUserSummary: string;
  verbatimUserRequest?: string;
}
