import { createHash } from 'node:crypto';
import type {
  CanonicalActor,
  CanonicalEventType,
  CanonicalLedgerCommand,
  CanonicalSource,
  SafeEventData,
  SafeEventScalar
} from './types.ts';

export const GENESIS_EVENT_HASH = sha256('benefit-settlement-rail:canonical-case-ledger:v1');

const ALLOWED_KEYS: Record<CanonicalEventType, readonly string[]> = {
  PHONE_CONNECTED: ['callIdHash', 'recordingMode', 'disclosureVersion', 'evidenceClass'],
  INTENT_INTERPRETED: ['intentHash', 'intent', 'model', 'responseIdHash'],
  POLICY_EVALUATED: ['policySnapshotHash', 'conditionHash', 'goodsNoHash', 'amountKrw', 'shippingFeeKrw', 'inStock', 'domestic'],
  USER_CONFIRMED: ['confirmationHash', 'confirmationMethod'],
  INSTITUTION_APPROVED: ['approvalRevision', 'approvalValidUntil', 'conditionHash'],
  PAYMENT_AUTHORIZED: ['approvalRevision', 'conditionHash', 'authorizationHash', 'amountKrw', 'currency', 'expiresAt'],
  PAYMENT_RECORDED: ['approvalRevision', 'conditionHash', 'authorizationHash', 'providerReference', 'amountKrw', 'recordedAt', 'providerError'],
  SUPPLIER_ORDER_SUBMITTED: ['approvalRevision', 'conditionHash', 'supplierRequestHash'],
  SUPPLIER_CONFIRMED: ['externalOrderId', 'externalOrderNoHash', 'supplierState'],
  SHIPPED: ['carrierCode', 'trackingNumberHash'],
  DELIVERED: ['carrierCode', 'trackingNumberHash', 'carrierDeliveredAt'],
  RECIPIENT_CONFIRMED: ['receiptConfirmationHash', 'confirmationMethod'],
  STEP_FAILED: ['reasonCode', 'targetState', 'component', 'retryable', 'attempt'],
  RETRY_SCHEDULED: ['reasonCode', 'targetState', 'component', 'retryable', 'attempt'],
  APPROVAL_INVALIDATED: ['reasonCode', 'targetState', 'component', 'retryable', 'attempt'],
  POLICY_REEVALUATED: ['policySnapshotHash', 'conditionHash', 'goodsNoHash', 'amountKrw', 'shippingFeeKrw', 'inStock', 'domestic'],
  USER_RECONFIRMED: ['confirmationHash', 'confirmationMethod'],
  INSTITUTION_REAPPROVED: ['approvalRevision', 'approvalValidUntil', 'conditionHash'],
  PAYMENT_REAUTHORIZED: ['approvalRevision', 'conditionHash', 'authorizationHash', 'amountKrw', 'currency', 'expiresAt'],
  PAYMENT_RERECORDED: ['approvalRevision', 'conditionHash', 'authorizationHash', 'providerReference', 'amountKrw', 'recordedAt', 'providerError']
};

const FORBIDDEN_KEY = /(address|cellphone|telephone|phoneNumber|rawAudio|audioBytes|transcript|beneficiaryName|recipientName|identity|secret|credential|apiKey|privateKey)/i;
const PHONE_OR_ID_VALUE = /(?:^|\D)(?:\+?82[-. ]?)?0?1[016789][-. ]?\d{3,4}[-. ]?\d{4}(?:\D|$)|(?:^|\D)\d{6}[-. ]?[1-4]\d{6}(?:\D|$)/;
const SECRET_VALUE = /(?:^|[^A-Za-z0-9])(?:sk-(?:proj-)?[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|ya29\.[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{12,}|npm_[A-Za-z0-9]{20,}|pypi-[A-Za-z0-9_-]{20,}|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{12,}|Bearer[ ._-][A-Za-z0-9._-]{12,}|-----BEGIN[A-Z ]*PRIVATE KEY-----)(?:$|[^A-Za-z0-9])/i;
const HASH_KEY = /(Hash|hash)$/;
const TECHNICAL_STRING = /^[A-Za-z0-9_.:+\-/]{1,180}$/;

const REQUIRED_KEYS: Record<CanonicalEventType, readonly string[]> = {
  PHONE_CONNECTED: ['callIdHash', 'recordingMode', 'disclosureVersion', 'evidenceClass'],
  INTENT_INTERPRETED: ['intentHash', 'intent', 'model'],
  POLICY_EVALUATED: ['policySnapshotHash', 'conditionHash', 'goodsNoHash', 'amountKrw', 'shippingFeeKrw', 'inStock', 'domestic'],
  USER_CONFIRMED: ['confirmationHash', 'confirmationMethod'],
  INSTITUTION_APPROVED: ['approvalRevision', 'approvalValidUntil', 'conditionHash'],
  PAYMENT_AUTHORIZED: ['approvalRevision', 'conditionHash', 'authorizationHash', 'amountKrw', 'currency', 'expiresAt'],
  PAYMENT_RECORDED: ['approvalRevision', 'conditionHash', 'authorizationHash', 'providerReference', 'amountKrw', 'recordedAt', 'providerError'],
  SUPPLIER_ORDER_SUBMITTED: ['approvalRevision', 'conditionHash', 'supplierRequestHash'],
  SUPPLIER_CONFIRMED: ['externalOrderId', 'externalOrderNoHash', 'supplierState'],
  SHIPPED: ['carrierCode', 'trackingNumberHash'],
  DELIVERED: ['carrierCode', 'trackingNumberHash', 'carrierDeliveredAt'],
  RECIPIENT_CONFIRMED: ['receiptConfirmationHash', 'confirmationMethod'],
  STEP_FAILED: ['reasonCode', 'targetState', 'component', 'retryable', 'attempt'],
  RETRY_SCHEDULED: ['reasonCode', 'targetState', 'component', 'retryable', 'attempt'],
  APPROVAL_INVALIDATED: ['reasonCode', 'targetState', 'component', 'retryable', 'attempt'],
  POLICY_REEVALUATED: ['policySnapshotHash', 'conditionHash', 'goodsNoHash', 'amountKrw', 'shippingFeeKrw', 'inStock', 'domestic'],
  USER_RECONFIRMED: ['confirmationHash', 'confirmationMethod'],
  INSTITUTION_REAPPROVED: ['approvalRevision', 'approvalValidUntil', 'conditionHash'],
  PAYMENT_REAUTHORIZED: ['approvalRevision', 'conditionHash', 'authorizationHash', 'amountKrw', 'currency', 'expiresAt'],
  PAYMENT_RERECORDED: ['approvalRevision', 'conditionHash', 'authorizationHash', 'providerReference', 'amountKrw', 'recordedAt', 'providerError']
};

const AUTHORITY: Record<CanonicalEventType, readonly [CanonicalActor, CanonicalSource][]> = {
  PHONE_CONNECTED: [['PHONE_PROVIDER', 'CLAWOPS']],
  INTENT_INTERPRETED: [['AI_INTERPRETER', 'AI_PROVIDER'], ['SYSTEM', 'SYSTEM']],
  POLICY_EVALUATED: [['POLICY_ENGINE', 'DETERMINISTIC_POLICY']],
  USER_CONFIRMED: [['RECIPIENT', 'DTMF'], ['RECIPIENT', 'VOICE_CONFIRMATION']],
  INSTITUTION_APPROVED: [['INSTITUTION', 'INSTITUTION_WORKFLOW']],
  PAYMENT_AUTHORIZED: [['PAYMENT_AUTHORIZER', 'PAYMENT_POLICY']],
  PAYMENT_RECORDED: [['PAYMENT_EXECUTOR', 'PAYMENT_PROVIDER']],
  SUPPLIER_ORDER_SUBMITTED: [['SUPPLIER', 'SPECIAL_OFFER']],
  SUPPLIER_CONFIRMED: [['SUPPLIER', 'SPECIAL_OFFER']],
  SHIPPED: [['CARRIER', 'CARRIER_READBACK']],
  DELIVERED: [['CARRIER', 'CARRIER_READBACK']],
  RECIPIENT_CONFIRMED: [['RECIPIENT', 'RECIPIENT_PORTAL']],
  STEP_FAILED: [['SYSTEM', 'SYSTEM']],
  RETRY_SCHEDULED: [['SYSTEM', 'SYSTEM']],
  APPROVAL_INVALIDATED: [['SYSTEM', 'SYSTEM'], ['INSTITUTION', 'INSTITUTION_WORKFLOW']],
  POLICY_REEVALUATED: [['POLICY_ENGINE', 'DETERMINISTIC_POLICY']],
  USER_RECONFIRMED: [['RECIPIENT', 'DTMF'], ['RECIPIENT', 'VOICE_CONFIRMATION']],
  INSTITUTION_REAPPROVED: [['INSTITUTION', 'INSTITUTION_WORKFLOW']],
  PAYMENT_REAUTHORIZED: [['PAYMENT_AUTHORIZER', 'PAYMENT_POLICY']],
  PAYMENT_RERECORDED: [['PAYMENT_EXECUTOR', 'PAYMENT_PROVIDER']]
};

export class UnsafeLedgerDataError extends Error {
  constructor(message: string, public readonly reason: 'PII_OR_SECRET_REJECTED' | 'INVALID_EVENT_SCHEMA') {
    super(message);
  }
}

export function assertSafeEventData(type: CanonicalEventType, value: SafeEventData): SafeEventData {
  if (!isPlainObject(value)) throw new UnsafeLedgerDataError('Event data must be a plain object', 'INVALID_EVENT_SCHEMA');
  const allowed = new Set(ALLOWED_KEYS[type]);
  const output: Record<string, SafeEventScalar> = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) throw new UnsafeLedgerDataError('PII or secret field rejected', 'PII_OR_SECRET_REJECTED');
    if (!allowed.has(key)) throw new UnsafeLedgerDataError('Event field is not allowlisted', 'INVALID_EVENT_SCHEMA');
    if (!isSafeScalar(item)) throw new UnsafeLedgerDataError('Event value is not a safe scalar', 'INVALID_EVENT_SCHEMA');
    validateScalar(key, item);
    output[key] = item;
  }
  for (const key of REQUIRED_KEYS[type]) {
    if (!(key in output)) throw new UnsafeLedgerDataError(`Event field ${key} is required`, 'INVALID_EVENT_SCHEMA');
  }
  validateEventSemantics(type, output);
  return Object.freeze(output);
}

export function eventAuthorityIsValid(type: CanonicalEventType, actor: CanonicalActor, source: CanonicalSource, data: SafeEventData): boolean {
  if (!AUTHORITY[type].some(([expectedActor, expectedSource]) => actor === expectedActor && source === expectedSource)) return false;
  if (type === 'INTENT_INTERPRETED' && actor === 'AI_INTERPRETER') return typeof data.responseIdHash === 'string';
  if (type === 'INTENT_INTERPRETED' && actor === 'SYSTEM') return data.model === 'DETERMINISTIC_PHONE_BRIDGE';
  return true;
}

export function hashOpaqueIdempotencyKey(value: string): string {
  if (!/^[A-Za-z0-9_.:-]{8,256}$/.test(value)) throw new UnsafeLedgerDataError('Invalid opaque idempotency token', 'INVALID_EVENT_SCHEMA');
  return sha256(`idempotency:${value}`);
}

export function semanticCommandHash(command: Omit<CanonicalLedgerCommand, 'at' | 'idempotencyKey'>, safeData: SafeEventData): string {
  return sha256(canonicalJson({
    caseId: command.caseId,
    type: command.type,
    actor: command.actor,
    source: command.source,
    data: safeData,
    expectedPreviousHash: command.expectedPreviousHash ?? null
  }));
}

export function acceptedEventId(caseId: string, idempotencyKeyHash: string, commandHash: string): string {
  return `evt_${hex(`${caseId}:${idempotencyKeyHash}:${commandHash}`).slice(0, 40)}`;
}

export function safeFailureEventId(
  caseId: string,
  idempotencyKeyHash: string,
  reasonCode: string,
  targetState: string,
  attempt: number,
  mutationCommandHash?: string
): string {
  const suffix = mutationCommandHash ? `:${mutationCommandHash}` : '';
  return `evt_${hex(`${caseId}:${idempotencyKeyHash}:${reasonCode}:${targetState}:${attempt}${suffix}`).slice(0, 40)}`;
}

export function computeEventHash(value: Omit<import('./types.ts').CanonicalCaseEvent, 'eventHash'>): string {
  return sha256(canonicalJson(value));
}

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new UnsafeLedgerDataError('Non-finite number', 'INVALID_EVENT_SCHEMA');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  throw new UnsafeLedgerDataError('Unsupported canonical value', 'INVALID_EVENT_SCHEMA');
}

function validateScalar(key: string, value: SafeEventScalar): void {
  if (value === null) {
    if (key !== 'providerError') throw new UnsafeLedgerDataError('Null is not allowed for this field', 'INVALID_EVENT_SCHEMA');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new UnsafeLedgerDataError('Numeric value must be a non-negative safe integer', 'INVALID_EVENT_SCHEMA');
    return;
  }
  if (typeof value === 'boolean') return;
  if (HASH_KEY.test(key)) {
    if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(value)) throw new UnsafeLedgerDataError('Hash field is invalid', 'INVALID_EVENT_SCHEMA');
    return;
  }
  if (PHONE_OR_ID_VALUE.test(value) || SECRET_VALUE.test(value)) {
    throw new UnsafeLedgerDataError('PII or secret-shaped value rejected', 'PII_OR_SECRET_REJECTED');
  }
  if (!TECHNICAL_STRING.test(value)) throw new UnsafeLedgerDataError('String field is not a technical identifier', 'INVALID_EVENT_SCHEMA');
  validateEnumValue(key, value);
}

function validateEventSemantics(type: CanonicalEventType, data: Record<string, SafeEventScalar>): void {
  if (type === 'PAYMENT_AUTHORIZED' || type === 'PAYMENT_REAUTHORIZED') {
    if (!positiveInteger(data.amountKrw)) throw new UnsafeLedgerDataError('Payment authorization amount must be positive', 'INVALID_EVENT_SCHEMA');
    if (data.currency !== 'KRW' || !positiveInteger(data.expiresAt)) throw new UnsafeLedgerDataError('Payment authorization is invalid', 'INVALID_EVENT_SCHEMA');
  }
  if (type === 'PAYMENT_RECORDED' || type === 'PAYMENT_RERECORDED') {
    if (data.providerError !== null) throw new UnsafeLedgerDataError('Successful payment record must not contain a provider error', 'INVALID_EVENT_SCHEMA');
    if (!positiveInteger(data.amountKrw) || !positiveInteger(data.recordedAt)) throw new UnsafeLedgerDataError('Payment record coordinates are invalid', 'INVALID_EVENT_SCHEMA');
    if (typeof data.providerReference !== 'string' || !/^[A-Za-z0-9_.:-]{8,180}$/.test(data.providerReference)) throw new UnsafeLedgerDataError('Payment provider reference is invalid', 'INVALID_EVENT_SCHEMA');
  }
}

function positiveInteger(value: SafeEventScalar | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function validateEnumValue(key: string, value: string): void {
  const enums: Record<string, readonly string[]> = {
    recordingMode: ['OFF', 'ON'],
    evidenceClass: ['MEASURED', 'SYNTHETIC_DEMO', 'PENDING'],
    intent: ['DISCOVER_PRODUCTS', 'COMPARE_PRODUCTS', 'PURCHASE'],
    confirmationMethod: ['DTMF', 'VOICE', 'PORTAL'],
    supplierState: ['ORDER_ACCEPTED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED']
  };
  const allowed = enums[key];
  if (allowed && !allowed.includes(value)) throw new UnsafeLedgerDataError(`${key} value is invalid`, 'INVALID_EVENT_SCHEMA');
  if (key === 'model' && value !== 'DETERMINISTIC_PHONE_BRIDGE' && !/^[A-Za-z0-9_.:-]{1,64}$/.test(value)) {
    throw new UnsafeLedgerDataError('model value is invalid', 'INVALID_EVENT_SCHEMA');
  }
}

function isSafeScalar(value: unknown): value is SafeEventScalar {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
