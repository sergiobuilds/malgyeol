import { createHash } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import type { ProductRole } from '../http/roleAccess.ts';

export type RoleAccessLevel = 'read' | 'act';

export type CaregiverAction =
  | 'REQUEST_COAPPROVAL' | 'APPROVE_COAPPROVAL' | 'REQUEST_CHANGE'
  | 'REPORT_DELIVERY_ISSUE' | 'REQUEST_CANCELLATION';
export type OpsAction = 'REVIEW_POLICY' | 'RECORD_CONSENT' | 'QUEUE_EXCEPTION' | 'RESOLVE_EXCEPTION';
export type MerchantAction =
  | 'ACKNOWLEDGE_ORDER' | 'MARK_OUT_OF_STOCK' | 'MARK_PREPARING'
  | 'REGISTER_SHIPMENT' | 'PROPOSE_SUBSTITUTION' | 'ACCEPT_CANCELLATION' | 'MARK_REFUNDED';
export type RoleWorkflowAction = CaregiverAction | OpsAction | MerchantAction;

export interface RoleWorkflowEvent {
  sequence: number;
  role: ProductRole;
  actorHash: string;
  action: RoleWorkflowAction;
  at: number;
  data: Record<string, string | string[]>;
}

export interface RoleWorkflow {
  caseId: string;
  revision: number;
  consent: {
    status: 'NONE' | 'RECORDED' | 'INVALIDATED';
    fingerprint?: string;
    recordedAt?: number;
    invalidatedAt?: number;
    invalidatedBy?: RoleWorkflowAction;
  };
  caregiver: {
    coApproval: 'NONE' | 'REQUESTED' | 'APPROVED';
    requestedByActorHash?: string;
    approvedByActorHash?: string;
    deliveryIssue?: string;
    cancellationRequested: boolean;
  };
  ops: {
    policyReview: 'PENDING' | 'REVIEWED';
    exception: 'NONE' | 'OPEN' | 'RESOLVED';
    exceptionReason?: string;
    resolution?: string;
  };
  merchant: {
    fulfillment: 'NEW' | 'ACKNOWLEDGED' | 'OUT_OF_STOCK' | 'PREPARING' | 'SHIPPED' | 'CANCELLED' | 'REFUNDED';
    carrierCode?: string;
    trackingNumber?: string;
    substitutionGoodsNo?: string;
    substitutionReason?: string;
  };
  externalReadbackImmutable: true;
  events: RoleWorkflowEvent[];
  updatedAt: number;
}

export interface RoleActionInput {
  caseId: string;
  role: ProductRole;
  action: RoleWorkflowAction;
  data?: Record<string, unknown>;
  expectedRevision: number;
  subjectId: string;
}

export interface RoleWorkflowRepository {
  get(caseId: string): Promise<RoleWorkflow | undefined>;
  apply(input: RoleActionInput): Promise<RoleWorkflow>;
}

export class InMemoryRoleWorkflowRepository implements RoleWorkflowRepository {
  private readonly values = new Map<string, RoleWorkflow>();
  constructor(private readonly now: () => number = Date.now) {}

  async get(caseId: string): Promise<RoleWorkflow | undefined> {
    const value = this.values.get(caseId);
    return value ? structuredClone(value) : undefined;
  }

  async apply(input: RoleActionInput): Promise<RoleWorkflow> {
    const current = this.values.get(input.caseId) ?? emptyWorkflow(input.caseId, this.now());
    const updated = applyRoleAction(current, input, this.now());
    this.values.set(input.caseId, structuredClone(updated));
    return structuredClone(updated);
  }
}

export class FirestoreRoleWorkflowRepository implements RoleWorkflowRepository {
  constructor(private readonly db = new Firestore(), private readonly now: () => number = Date.now) {}

  async get(caseId: string): Promise<RoleWorkflow | undefined> {
    const snapshot = await this.db.collection('roleWorkflows').doc(caseId).get();
    return snapshot.exists ? snapshot.data() as RoleWorkflow : undefined;
  }

  async apply(input: RoleActionInput): Promise<RoleWorkflow> {
    const ref = this.db.collection('roleWorkflows').doc(input.caseId);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.exists ? snapshot.data() as RoleWorkflow : emptyWorkflow(input.caseId, this.now());
      const updated = applyRoleAction(current, input, this.now());
      transaction.set(ref, updated);
      return updated;
    });
  }
}

export function emptyWorkflow(caseId: string, at: number): RoleWorkflow {
  return {
    caseId, revision: 0,
    consent: { status: 'NONE' },
    caregiver: { coApproval: 'NONE', cancellationRequested: false },
    ops: { policyReview: 'PENDING', exception: 'NONE' },
    merchant: { fulfillment: 'NEW' },
    externalReadbackImmutable: true,
    events: [], updatedAt: at
  };
}

export function applyRoleAction(current: RoleWorkflow, input: RoleActionInput, at: number): RoleWorkflow {
  validateCaseId(input.caseId);
  if (current.caseId !== input.caseId) throw new RoleWorkflowInputError('caseId conflict');
  if (input.expectedRevision !== current.revision) throw new RoleWorkflowConflictError('Workflow revision conflict');
  const data = validateAction(input.role, input.action, input.data ?? {});
  const actorHash = hashSubject(input.subjectId);
  const next = structuredClone(current);

  if (input.role === 'caregiver') applyCaregiver(next, input.action as CaregiverAction, data, at, actorHash);
  else if (input.role === 'ops') applyOps(next, input.action as OpsAction, data, at);
  else applyMerchant(next, input.action as MerchantAction, data, at);

  next.revision += 1;
  next.updatedAt = at;
  next.events.push({ sequence: next.revision, role: input.role, actorHash, action: input.action, at, data });
  return next;
}

export class RoleWorkflowInputError extends Error {}
export class RoleWorkflowConflictError extends Error {}

function applyCaregiver(value: RoleWorkflow, action: CaregiverAction, data: Record<string, string | string[]>, at: number, actorHash: string) {
  const terminal = ['SHIPPED', 'CANCELLED', 'REFUNDED'].includes(value.merchant.fulfillment);
  if (terminal && ['REQUEST_COAPPROVAL', 'APPROVE_COAPPROVAL', 'REQUEST_CHANGE'].includes(action)) {
    throw new RoleWorkflowConflictError('Order terms can no longer be changed');
  }
  if (['SHIPPED', 'CANCELLED', 'REFUNDED'].includes(value.merchant.fulfillment) && action === 'REQUEST_CANCELLATION') {
    throw new RoleWorkflowConflictError('Order can no longer be cancelled');
  }
  if (action === 'REQUEST_COAPPROVAL') {
    value.caregiver.coApproval = 'REQUESTED';
    value.caregiver.requestedByActorHash = actorHash;
    delete value.caregiver.approvedByActorHash;
  }
  if (action === 'APPROVE_COAPPROVAL') {
    if (value.caregiver.coApproval !== 'REQUESTED') throw new RoleWorkflowConflictError('Coapproval was not requested');
    if (value.caregiver.requestedByActorHash === actorHash) throw new RoleWorkflowConflictError('Coapproval requires another caregiver');
    value.caregiver.coApproval = 'APPROVED';
    value.caregiver.approvedByActorHash = actorHash;
  }
  if (action === 'REQUEST_CHANGE') invalidateTerms(value, action, at);
  if (action === 'REPORT_DELIVERY_ISSUE') value.caregiver.deliveryIssue = data.reasonCode as string;
  if (action === 'REQUEST_CANCELLATION') value.caregiver.cancellationRequested = true;
}

function applyOps(value: RoleWorkflow, action: OpsAction, data: Record<string, string | string[]>, at: number) {
  if (['SHIPPED', 'CANCELLED', 'REFUNDED'].includes(value.merchant.fulfillment) && action === 'RECORD_CONSENT') {
    throw new RoleWorkflowConflictError('Consent cannot be recorded for a terminal fulfillment');
  }
  if (action === 'REVIEW_POLICY') value.ops.policyReview = 'REVIEWED';
  if (action === 'RECORD_CONSENT') {
    value.consent = { status: 'RECORDED', fingerprint: data.fingerprint as string, recordedAt: at };
  }
  if (action === 'QUEUE_EXCEPTION') {
    value.ops.exception = 'OPEN'; value.ops.exceptionReason = data.reasonCode as string; delete value.ops.resolution;
  }
  if (action === 'RESOLVE_EXCEPTION') {
    if (value.ops.exception !== 'OPEN') throw new RoleWorkflowConflictError('Exception is not open');
    value.ops.exception = 'RESOLVED'; value.ops.resolution = data.resolutionCode as string;
  }
}

function applyMerchant(value: RoleWorkflow, action: MerchantAction, data: Record<string, string | string[]>, at: number) {
  const state = value.merchant.fulfillment;
  if (action === 'ACKNOWLEDGE_ORDER') {
    if (state !== 'NEW') throw new RoleWorkflowConflictError('Order is not new');
    value.merchant.fulfillment = 'ACKNOWLEDGED';
  }
  if (action === 'MARK_OUT_OF_STOCK') {
    if (!['NEW', 'ACKNOWLEDGED'].includes(state)) throw new RoleWorkflowConflictError('Order cannot be marked out of stock');
    value.merchant.fulfillment = 'OUT_OF_STOCK';
  }
  if (action === 'MARK_PREPARING') {
    if (state !== 'ACKNOWLEDGED') throw new RoleWorkflowConflictError('Order was not acknowledged');
    requireApprovedTerms(value);
    value.merchant.fulfillment = 'PREPARING';
  }
  if (action === 'REGISTER_SHIPMENT') {
    if (state !== 'PREPARING') throw new RoleWorkflowConflictError('Order is not preparing');
    requireApprovedTerms(value);
    value.merchant.fulfillment = 'SHIPPED';
    value.merchant.carrierCode = data.carrierCode as string;
    value.merchant.trackingNumber = data.trackingNumber as string;
  }
  if (action === 'PROPOSE_SUBSTITUTION') {
    if (!['NEW', 'ACKNOWLEDGED', 'OUT_OF_STOCK'].includes(state)) throw new RoleWorkflowConflictError('Substitution is no longer available');
    value.merchant.substitutionGoodsNo = data.goodsNo as string;
    value.merchant.substitutionReason = data.reasonCode as string;
    invalidateTerms(value, action, at);
  }
  if (action === 'ACCEPT_CANCELLATION') {
    if (!value.caregiver.cancellationRequested) throw new RoleWorkflowConflictError('Cancellation was not requested');
    if (!['NEW', 'ACKNOWLEDGED', 'OUT_OF_STOCK', 'PREPARING'].includes(state)) throw new RoleWorkflowConflictError('Order cannot be cancelled');
    value.merchant.fulfillment = 'CANCELLED';
  }
  if (action === 'MARK_REFUNDED') {
    if (state !== 'CANCELLED') throw new RoleWorkflowConflictError('Order was not cancelled');
    value.merchant.fulfillment = 'REFUNDED';
  }
}

function invalidateConsent(value: RoleWorkflow, action: RoleWorkflowAction, at: number) {
  if (value.consent.status === 'RECORDED') {
    value.consent = { ...value.consent, status: 'INVALIDATED', invalidatedAt: at, invalidatedBy: action };
  }
}

function invalidateTerms(value: RoleWorkflow, action: RoleWorkflowAction, at: number) {
  invalidateConsent(value, action, at);
  value.ops.policyReview = 'PENDING';
  value.caregiver.coApproval = 'NONE';
  delete value.caregiver.requestedByActorHash;
  delete value.caregiver.approvedByActorHash;
}

function requireApprovedTerms(value: RoleWorkflow) {
  if (value.ops.policyReview !== 'REVIEWED') throw new RoleWorkflowConflictError('Policy review is required');
  if (value.consent.status !== 'RECORDED') throw new RoleWorkflowConflictError('Valid consent is required');
  if (value.caregiver.coApproval !== 'APPROVED'
    || !value.caregiver.requestedByActorHash || !value.caregiver.approvedByActorHash
    || value.caregiver.requestedByActorHash === value.caregiver.approvedByActorHash) {
    throw new RoleWorkflowConflictError('Independent caregiver coapproval is required');
  }
}

function hashSubject(value: string): string {
  if (!/^[A-Za-z0-9_.:@-]{3,128}$/.test(value)) throw new RoleWorkflowInputError('Invalid subjectId');
  return createHash('sha256').update(`role-subject-v1:${value}`).digest('hex');
}

function validateAction(role: ProductRole, action: RoleWorkflowAction, raw: Record<string, unknown>): Record<string, string | string[]> {
  const allowed: Record<ProductRole, RoleWorkflowAction[]> = {
    caregiver: ['REQUEST_COAPPROVAL', 'APPROVE_COAPPROVAL', 'REQUEST_CHANGE', 'REPORT_DELIVERY_ISSUE', 'REQUEST_CANCELLATION'],
    ops: ['REVIEW_POLICY', 'RECORD_CONSENT', 'QUEUE_EXCEPTION', 'RESOLVE_EXCEPTION'],
    merchant: ['ACKNOWLEDGE_ORDER', 'MARK_OUT_OF_STOCK', 'MARK_PREPARING', 'REGISTER_SHIPMENT', 'PROPOSE_SUBSTITUTION', 'ACCEPT_CANCELLATION', 'MARK_REFUNDED']
  };
  if (!allowed[role].includes(action)) throw new RoleWorkflowInputError('Action is not allowed for role');
  const data: Record<string, string | string[]> = {};
  if (action === 'REQUEST_CHANGE') data.changedFields = stringList(raw.changedFields, 'changedFields', ['product', 'quantity', 'unitPrice', 'shippingFee']);
  if (action === 'REPORT_DELIVERY_ISSUE') data.reasonCode = enumValue(raw.reasonCode, 'reasonCode', ['NOT_RECEIVED', 'DAMAGED', 'WRONG_ITEM']);
  if (action === 'RECORD_CONSENT') data.fingerprint = patternValue(raw.fingerprint, 'fingerprint', /^[a-f0-9]{64}$/);
  if (action === 'QUEUE_EXCEPTION') data.reasonCode = enumValue(raw.reasonCode, 'reasonCode', ['POLICY_AMBIGUITY', 'PRICE_CHANGED', 'SUPPLIER_MISMATCH', 'DELIVERY_DISPUTE']);
  if (action === 'RESOLVE_EXCEPTION') data.resolutionCode = enumValue(raw.resolutionCode, 'resolutionCode', ['APPROVED', 'BLOCKED', 'RETRY_REQUIRED', 'REFUND_REQUIRED']);
  if (action === 'REGISTER_SHIPMENT') {
    data.carrierCode = patternValue(raw.carrierCode, 'carrierCode', /^[A-Z0-9_-]{2,32}$/);
    data.trackingNumber = patternValue(raw.trackingNumber, 'trackingNumber', /^[A-Za-z0-9-]{5,64}$/);
  }
  if (action === 'PROPOSE_SUBSTITUTION') {
    data.goodsNo = patternValue(raw.goodsNo, 'goodsNo', /^[A-Za-z0-9_-]{1,128}$/);
    data.reasonCode = enumValue(raw.reasonCode, 'reasonCode', ['OUT_OF_STOCK', 'PACK_SIZE_CHANGED', 'PRICE_CHANGED']);
  }
  return data;
}

function enumValue(value: unknown, name: string, values: string[]): string {
  if (typeof value !== 'string' || !values.includes(value)) throw new RoleWorkflowInputError(`Invalid ${name}`);
  return value;
}

function patternValue(value: unknown, name: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new RoleWorkflowInputError(`Invalid ${name}`);
  return value;
}

function stringList(value: unknown, name: string, values: string[]): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.some(item => typeof item !== 'string' || !values.includes(item))) {
    throw new RoleWorkflowInputError(`Invalid ${name}`);
  }
  return [...new Set(value as string[])].sort();
}

function validateCaseId(value: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new RoleWorkflowInputError('Invalid caseId');
}
