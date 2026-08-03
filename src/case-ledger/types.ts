export const CANONICAL_CASE_STATES = [
  'PHONE_CONNECTED',
  'INTENT_INTERPRETED',
  'POLICY_EVALUATED',
  'USER_CONFIRMED',
  'INSTITUTION_APPROVED',
  'X402_REQUIRED',
  'DEVNET_PROOF_FINALIZED',
  'SUPPLIER_ORDER_SUBMITTED',
  'SUPPLIER_CONFIRMED',
  'SHIPPED',
  'DELIVERED',
  'RECIPIENT_CONFIRMED'
] as const;

export type CanonicalCaseState = (typeof CANONICAL_CASE_STATES)[number];

export const AUXILIARY_EVENT_TYPES = [
  'STEP_FAILED',
  'RETRY_SCHEDULED',
  'APPROVAL_INVALIDATED',
  'POLICY_REEVALUATED',
  'USER_RECONFIRMED',
  'INSTITUTION_REAPPROVED',
  'X402_REBOUND',
  'DEVNET_PROOF_REFINALIZED'
] as const;

export type AuxiliaryEventType = (typeof AUXILIARY_EVENT_TYPES)[number];
export type CanonicalEventType = CanonicalCaseState | AuxiliaryEventType;

export type CanonicalActor =
  | 'PHONE_PROVIDER'
  | 'GEMINI'
  | 'POLICY_ENGINE'
  | 'RECIPIENT'
  | 'INSTITUTION'
  | 'X402_FACILITATOR'
  | 'SOLANA_RPC'
  | 'SUPPLIER'
  | 'CARRIER'
  | 'SYSTEM';

export type CanonicalSource =
  | 'CLAWOPS'
  | 'VERTEX_GEMINI'
  | 'DETERMINISTIC_POLICY'
  | 'DTMF'
  | 'VOICE_CONFIRMATION'
  | 'INSTITUTION_WORKFLOW'
  | 'X402'
  | 'SOLANA_DEVNET'
  | 'SPECIAL_OFFER'
  | 'CARRIER_READBACK'
  | 'RECIPIENT_PORTAL'
  | 'SYSTEM';

export type SafeEventScalar = string | number | boolean | null;
export type SafeEventData = Readonly<Record<string, SafeEventScalar>>;
export type EvidenceClass = 'MEASURED' | 'SYNTHETIC_DEMO' | 'PENDING';

export interface CanonicalCaseEvent {
  caseId: string;
  eventId: string;
  sequence: number;
  type: CanonicalEventType;
  state: CanonicalCaseState;
  at: number;
  actor: CanonicalActor;
  source: CanonicalSource;
  idempotencyKeyHash: string;
  semanticCommandHash: string;
  previousHash: string;
  eventHash: string;
  data: SafeEventData;
}

export type RevalidationStage = 'NONE' | 'INVALIDATED' | 'POLICY' | 'USER' | 'INSTITUTION' | 'X402';

export interface CanonicalCaseAggregate {
  caseId: string;
  currentState: CanonicalCaseState;
  sequence: number;
  lastEventHash: string;
  createdAt: number;
  updatedAt: number;
  policySnapshotHash?: string;
  conditionHash?: string;
  userConfirmationHash?: string;
  approvalRevision?: number;
  approvalValidUntil?: number;
  approvalInvalidated: boolean;
  revalidationStage: RevalidationStage;
  evidenceClass: EvidenceClass;
  x402ApprovalRevision?: number;
  x402ConditionHash?: string;
  devnetApprovalRevision?: number;
  devnetConditionHash?: string;
  supplierOrderId?: string;
}

export interface CanonicalLedgerCommand {
  caseId: string;
  type: CanonicalEventType;
  at: number;
  actor: CanonicalActor;
  source: CanonicalSource;
  idempotencyKey: string;
  data: SafeEventData;
  expectedPreviousHash?: string;
}

export interface CanonicalIdempotencyRecord {
  idempotencyKeyHash: string;
  semanticCommandHash: string;
  eventId: string;
  result: 'ACCEPTED' | 'REJECTED';
}

export type LedgerFailureReason =
  | 'CASE_ALREADY_EXISTS'
  | 'CASE_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'STALE_TAIL'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_BINDING_MISMATCH'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PII_OR_SECRET_REJECTED'
  | 'INVALID_EVENT_SCHEMA'
  | 'INVALID_AUTHORITY';

export interface CanonicalLedgerResult {
  status: 'ACCEPTED' | 'REPLAYED' | 'REJECTED';
  aggregate?: CanonicalCaseAggregate;
  event?: CanonicalCaseEvent;
  reasonCode?: LedgerFailureReason;
}

export interface CaseProjectionEnvelope<T> {
  role: 'recipient' | 'institution' | 'supplier' | 'judge' | 'chain';
  caseId: string;
  currentState: CanonicalCaseState;
  sequence: number;
  data: T;
}
