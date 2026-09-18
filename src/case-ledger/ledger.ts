import {
  acceptedEventId,
  assertSafeEventData,
  computeEventHash,
  eventAuthorityIsValid,
  GENESIS_EVENT_HASH,
  hashOpaqueIdempotencyKey,
  safeFailureEventId,
  semanticCommandHash,
  UnsafeLedgerDataError
} from './canonicalHash.ts';
import type { CanonicalCaseRepository, CanonicalLedgerTransaction } from './repository.ts';
import {
  AUXILIARY_EVENT_TYPES,
  CANONICAL_CASE_STATES,
  type AuxiliaryEventType,
  type CanonicalCaseAggregate,
  type CanonicalCaseEvent,
  type CanonicalCaseState,
  type CanonicalIdempotencyRecord,
  type CanonicalLedgerCommand,
  type CanonicalLedgerResult,
  type LedgerFailureReason,
  type SafeEventData
} from './types.ts';

const NORMAL_INDEX = new Map<CanonicalCaseState, number>(CANONICAL_CASE_STATES.map((state, index) => [state, index]));
const AUXILIARY = new Set<string>(AUXILIARY_EVENT_TYPES);

export class CanonicalCaseLedger {
  constructor(private readonly repository: CanonicalCaseRepository) {}

  openCase(command: CanonicalLedgerCommand): Promise<CanonicalLedgerResult> {
    if (command.type !== 'PHONE_CONNECTED') throw new Error('A canonical case must open with PHONE_CONNECTED');
    return this.execute(command);
  }

  advance(command: CanonicalLedgerCommand): Promise<CanonicalLedgerResult> {
    if (!NORMAL_INDEX.has(command.type as CanonicalCaseState) || command.type === 'PHONE_CONNECTED') {
      throw new Error('advance requires a non-initial canonical state');
    }
    return this.execute(command);
  }

  appendAuxiliary(command: CanonicalLedgerCommand): Promise<CanonicalLedgerResult> {
    if (!AUXILIARY.has(command.type) || command.type === 'STEP_FAILED') throw new Error('Unsupported public auxiliary event');
    return this.execute(command);
  }

  async getAggregate(caseId: string): Promise<CanonicalCaseAggregate | undefined> {
    return this.repository.getAggregate(caseId);
  }

  async events(caseId: string): Promise<CanonicalCaseEvent[]> {
    return this.repository.events(caseId);
  }

  private async execute(command: CanonicalLedgerCommand): Promise<CanonicalLedgerResult> {
    validateCommandEnvelope(command);
    const idempotencyKeyHash = hashOpaqueIdempotencyKey(command.idempotencyKey);
    let safeData: SafeEventData;
    try {
      safeData = assertSafeEventData(command.type, command.data);
    } catch (error) {
      if (!(error instanceof UnsafeLedgerDataError)) throw error;
      return this.rejectUnhashable(command, idempotencyKeyHash, error.reason);
    }
    const commandHash = semanticCommandHash(command, safeData);
    const eventId = acceptedEventId(command.caseId, idempotencyKeyHash, commandHash);
    const authorityRejection: LedgerFailureReason | undefined = eventAuthorityIsValid(command.type, command.actor, command.source, safeData)
      ? undefined
      : 'INVALID_AUTHORITY';

    return this.repository.runTransaction(command.caseId, async transaction => {
      const aggregate = await transaction.getAggregate();
      const idempotency = await transaction.getIdempotency(idempotencyKeyHash);
      if (idempotency) {
        if (idempotency.semanticCommandHash === commandHash) {
          const event = await requiredEvent(transaction, idempotency.eventId);
          return { status: 'REPLAYED', ...(aggregate ? { aggregate } : {}), event };
        }
        return this.appendFailure(transaction, aggregate, command, idempotencyKeyHash, 'IDEMPOTENCY_CONFLICT', {
          semanticCommandHash: commandHash,
          eventId: safeFailureEventId(command.caseId, idempotencyKeyHash, 'IDEMPOTENCY_CONFLICT', command.type, 1, commandHash),
          createIdempotency: false
        });
      }

      const rejection = authorityRejection ?? transitionRejection(aggregate, command);
      if (rejection) {
        return this.appendFailure(transaction, aggregate, command, idempotencyKeyHash, rejection, {
          semanticCommandHash: commandHash,
          eventId: safeFailureEventId(command.caseId, idempotencyKeyHash, rejection, command.type, 1),
          createIdempotency: true
        });
      }

      const previousHash = aggregate?.lastEventHash ?? GENESIS_EVENT_HASH;
      const sequence = (aggregate?.sequence ?? 0) + 1;
      const state = NORMAL_INDEX.has(command.type as CanonicalCaseState)
        ? command.type as CanonicalCaseState
        : requiredAggregate(aggregate).currentState;
      const withoutHash: Omit<CanonicalCaseEvent, 'eventHash'> = {
        caseId: command.caseId,
        eventId,
        sequence,
        type: command.type,
        state,
        at: command.at,
        actor: command.actor,
        source: command.source,
        idempotencyKeyHash,
        semanticCommandHash: commandHash,
        previousHash,
        data: safeData
      };
      const event: CanonicalCaseEvent = { ...withoutHash, eventHash: computeEventHash(withoutHash) };
      const updated = applyAcceptedEvent(aggregate, event);
      transaction.setAggregate(updated, !aggregate);
      transaction.createEvent(event);
      transaction.createIdempotency({ idempotencyKeyHash, semanticCommandHash: commandHash, eventId, result: 'ACCEPTED' });
      return { status: 'ACCEPTED', aggregate: updated, event };
    });
  }

  private async rejectUnhashable(
    command: CanonicalLedgerCommand,
    idempotencyKeyHash: string,
    reason: 'PII_OR_SECRET_REJECTED' | 'INVALID_EVENT_SCHEMA'
  ): Promise<CanonicalLedgerResult> {
    const eventId = safeFailureEventId(command.caseId, idempotencyKeyHash, reason, command.type, 1);
    return this.repository.runTransaction(command.caseId, async transaction => {
      const aggregate = await transaction.getAggregate();
      const idempotency = await transaction.getIdempotency(idempotencyKeyHash);
      const existingFailure = await transaction.getEvent(eventId);
      if (existingFailure) return { status: 'REPLAYED', ...(aggregate ? { aggregate } : {}), event: existingFailure, reasonCode: reason };
      return this.appendFailure(transaction, aggregate, command, idempotencyKeyHash, reason, {
        semanticCommandHash: `safe:${reason}`, eventId, createIdempotency: !idempotency, existingChecked: true
      });
    });
  }

  private async appendFailure(
    transaction: CanonicalLedgerTransaction,
    aggregate: CanonicalCaseAggregate | undefined,
    command: CanonicalLedgerCommand,
    idempotencyKeyHash: string,
    reasonCode: LedgerFailureReason,
    input: { semanticCommandHash: string; eventId: string; createIdempotency: boolean; existingChecked?: boolean }
  ): Promise<CanonicalLedgerResult> {
    if (!aggregate) return { status: 'REJECTED', reasonCode };
    if (!input.existingChecked) {
      const existing = await transaction.getEvent(input.eventId);
      if (existing) return { status: 'REPLAYED', aggregate, event: existing, reasonCode };
    }
    const data = assertSafeEventData('STEP_FAILED', {
      reasonCode,
      targetState: command.type,
      component: componentFor(command.type),
      retryable: isRetryable(reasonCode),
      attempt: 1
    });
    const withoutHash: Omit<CanonicalCaseEvent, 'eventHash'> = {
      caseId: command.caseId,
      eventId: input.eventId,
      sequence: aggregate.sequence + 1,
      type: 'STEP_FAILED',
      state: aggregate.currentState,
      at: command.at,
      actor: 'SYSTEM',
      source: 'SYSTEM',
      idempotencyKeyHash,
      semanticCommandHash: input.semanticCommandHash,
      previousHash: aggregate.lastEventHash,
      data
    };
    const event: CanonicalCaseEvent = { ...withoutHash, eventHash: computeEventHash(withoutHash) };
    const updated: CanonicalCaseAggregate = {
      ...aggregate,
      sequence: event.sequence,
      lastEventHash: event.eventHash,
      updatedAt: event.at
    };
    transaction.setAggregate(updated, false);
    transaction.createEvent(event);
    if (input.createIdempotency) {
      const record: CanonicalIdempotencyRecord = {
        idempotencyKeyHash,
        semanticCommandHash: input.semanticCommandHash,
        eventId: event.eventId,
        result: 'REJECTED'
      };
      transaction.createIdempotency(record);
    }
    return { status: 'REJECTED', aggregate: updated, event, reasonCode };
  }
}

function transitionRejection(aggregate: CanonicalCaseAggregate | undefined, command: CanonicalLedgerCommand): LedgerFailureReason | undefined {
  if (command.type === 'PHONE_CONNECTED') return aggregate ? 'CASE_ALREADY_EXISTS' : undefined;
  if (!aggregate) return 'CASE_NOT_FOUND';
  if (command.expectedPreviousHash !== aggregate.lastEventHash) return 'STALE_TAIL';
  if (NORMAL_INDEX.has(command.type as CanonicalCaseState)) {
    const expected = (NORMAL_INDEX.get(aggregate.currentState) ?? -1) + 1;
    if (NORMAL_INDEX.get(command.type as CanonicalCaseState) !== expected) return 'INVALID_TRANSITION';
    if (command.type === 'USER_CONFIRMED' && !aggregate.policySnapshotHash) return 'APPROVAL_BINDING_MISMATCH';
    if (command.type === 'INSTITUTION_APPROVED' && !approvalDataMatches(aggregate, command.data, command.at, true)) return 'APPROVAL_BINDING_MISMATCH';
    if (command.type === 'PAYMENT_AUTHORIZED') return activeApprovalRejection(aggregate, command.data, command.at);
    if (command.type === 'PAYMENT_RECORDED' && !paymentRecordMatches(aggregate, command.data, command.at)) return 'APPROVAL_BINDING_MISMATCH';
    if (command.type === 'SUPPLIER_ORDER_SUBMITTED') return supplierBindingRejection(aggregate, command.data, command.at);
    return undefined;
  }
  return auxiliaryRejection(aggregate, command.type as AuxiliaryEventType, command.data, command.at);
}

function auxiliaryRejection(
  aggregate: CanonicalCaseAggregate,
  type: AuxiliaryEventType,
  data: SafeEventData,
  at: number
): LedgerFailureReason | undefined {
  const index = NORMAL_INDEX.get(aggregate.currentState) ?? -1;
  if (type === 'APPROVAL_INVALIDATED') {
    return index >= 4 && index < 7 ? undefined : 'INVALID_TRANSITION';
  }
  if (type === 'POLICY_REEVALUATED') return aggregate.revalidationStage === 'INVALIDATED' ? undefined : 'INVALID_TRANSITION';
  if (type === 'USER_RECONFIRMED') return aggregate.revalidationStage === 'POLICY' ? undefined : 'INVALID_TRANSITION';
  if (type === 'INSTITUTION_REAPPROVED') {
    if (aggregate.revalidationStage !== 'USER') return 'INVALID_TRANSITION';
    return approvalDataMatches(aggregate, data, at, false) ? undefined : 'APPROVAL_BINDING_MISMATCH';
  }
  if (type === 'PAYMENT_REAUTHORIZED') {
    return aggregate.revalidationStage === 'INSTITUTION' && approvalReferenceMatches(aggregate, data) ? undefined : 'APPROVAL_BINDING_MISMATCH';
  }
  if (type === 'PAYMENT_RERECORDED') {
    return aggregate.revalidationStage === 'PAYMENT' && paymentRecordMatches(aggregate, data, at) ? undefined : 'APPROVAL_BINDING_MISMATCH';
  }
  if (type === 'RETRY_SCHEDULED') return undefined;
  return 'INVALID_TRANSITION';
}

function applyAcceptedEvent(aggregate: CanonicalCaseAggregate | undefined, event: CanonicalCaseEvent): CanonicalCaseAggregate {
  if (!aggregate) {
    return {
      caseId: event.caseId,
      currentState: 'PHONE_CONNECTED',
      sequence: event.sequence,
      lastEventHash: event.eventHash,
      createdAt: event.at,
      updatedAt: event.at,
      approvalInvalidated: false,
      revalidationStage: 'NONE',
      evidenceClass: evidenceClassField(event.data)
    };
  }
  const updated: CanonicalCaseAggregate = {
    ...aggregate,
    currentState: NORMAL_INDEX.has(event.type as CanonicalCaseState) ? event.type as CanonicalCaseState : aggregate.currentState,
    sequence: event.sequence,
    lastEventHash: event.eventHash,
    updatedAt: event.at
  };
  const data = event.data;
  if (event.type === 'POLICY_EVALUATED' || event.type === 'POLICY_REEVALUATED') {
    updated.policySnapshotHash = stringField(data, 'policySnapshotHash');
    updated.conditionHash = stringField(data, 'conditionHash');
    if (event.type === 'POLICY_REEVALUATED') updated.revalidationStage = 'POLICY';
  }
  if (event.type === 'USER_CONFIRMED' || event.type === 'USER_RECONFIRMED') {
    updated.userConfirmationHash = stringField(data, 'confirmationHash');
    if (event.type === 'USER_RECONFIRMED') updated.revalidationStage = 'USER';
  }
  if (event.type === 'INSTITUTION_APPROVED' || event.type === 'INSTITUTION_REAPPROVED') {
    updated.approvalRevision = numberField(data, 'approvalRevision');
    updated.approvalValidUntil = numberField(data, 'approvalValidUntil');
    updated.conditionHash = stringField(data, 'conditionHash');
    updated.approvalInvalidated = false;
    updated.revalidationStage = event.type === 'INSTITUTION_REAPPROVED' ? 'INSTITUTION' : 'NONE';
  }
  if (event.type === 'APPROVAL_INVALIDATED') {
    updated.approvalInvalidated = true;
    updated.revalidationStage = 'INVALIDATED';
  }
  if (event.type === 'PAYMENT_AUTHORIZED' || event.type === 'PAYMENT_REAUTHORIZED') {
    updated.paymentApprovalRevision = numberField(data, 'approvalRevision');
    updated.paymentConditionHash = stringField(data, 'conditionHash');
    updated.paymentAuthorizationHash = stringField(data, 'authorizationHash');
    updated.paymentAuthorizedAmountKrw = numberField(data, 'amountKrw');
    updated.paymentAuthorizationExpiresAt = numberField(data, 'expiresAt');
    if (event.type === 'PAYMENT_REAUTHORIZED') updated.revalidationStage = 'PAYMENT';
  }
  if (event.type === 'PAYMENT_RECORDED' || event.type === 'PAYMENT_RERECORDED') {
    updated.paymentRecordApprovalRevision = numberField(data, 'approvalRevision');
    updated.paymentRecordConditionHash = stringField(data, 'conditionHash');
    if (event.type === 'PAYMENT_RERECORDED') updated.revalidationStage = 'NONE';
  }
  if (event.type === 'SUPPLIER_CONFIRMED') updated.supplierOrderId = stringField(data, 'externalOrderId');
  return updated;
}

function approvalDataMatches(aggregate: CanonicalCaseAggregate, data: SafeEventData, at: number, first: boolean): boolean {
  const revision = data.approvalRevision;
  const validUntil = data.approvalValidUntil;
  const condition = data.conditionHash;
  const expectedRevision = first ? 1 : (aggregate.approvalRevision ?? 0) + 1;
  return revision === expectedRevision && typeof validUntil === 'number' && validUntil > at
    && typeof condition === 'string' && condition === aggregate.conditionHash && Boolean(aggregate.userConfirmationHash);
}

function activeApprovalRejection(aggregate: CanonicalCaseAggregate, data: SafeEventData, at: number): LedgerFailureReason | undefined {
  if (aggregate.approvalInvalidated || aggregate.approvalValidUntil === undefined || aggregate.approvalValidUntil <= at) return 'APPROVAL_EXPIRED';
  return approvalReferenceMatches(aggregate, data) ? undefined : 'APPROVAL_BINDING_MISMATCH';
}

function approvalReferenceMatches(aggregate: CanonicalCaseAggregate, data: SafeEventData): boolean {
  return data.approvalRevision === aggregate.approvalRevision && data.conditionHash === aggregate.conditionHash;
}

function paymentRecordMatches(aggregate: CanonicalCaseAggregate, data: SafeEventData, at: number): boolean {
  return data.approvalRevision === aggregate.paymentApprovalRevision
    && data.conditionHash === aggregate.paymentConditionHash
    && data.authorizationHash === aggregate.paymentAuthorizationHash
    && data.amountKrw === aggregate.paymentAuthorizedAmountKrw
    && aggregate.paymentAuthorizationExpiresAt !== undefined
    && at <= aggregate.paymentAuthorizationExpiresAt;
}

function supplierBindingRejection(aggregate: CanonicalCaseAggregate, data: SafeEventData, at: number): LedgerFailureReason | undefined {
  const approval = activeApprovalRejection(aggregate, data, at);
  if (approval) return approval;
  return aggregate.paymentRecordApprovalRevision === aggregate.approvalRevision
    && aggregate.paymentRecordConditionHash === aggregate.conditionHash ? undefined : 'APPROVAL_BINDING_MISMATCH';
}

function componentFor(type: CanonicalLedgerCommand['type']): string {
  if (['PHONE_CONNECTED', 'INTENT_INTERPRETED', 'USER_CONFIRMED'].includes(type)) return 'PHONE_FLOW';
  if (type.includes('POLICY') || type.includes('APPROV')) return 'POLICY_APPROVAL';
  if (type.includes('PAYMENT')) return 'PAYMENT_RECORD';
  if (type.includes('SUPPLIER')) return 'SUPPLIER';
  return 'CASE_LEDGER';
}

function isRetryable(reason: LedgerFailureReason): boolean {
  return ['STALE_TAIL', 'APPROVAL_EXPIRED', 'APPROVAL_BINDING_MISMATCH'].includes(reason);
}

function evidenceClassField(data: SafeEventData): CanonicalCaseAggregate['evidenceClass'] {
  const value = data.evidenceClass;
  if (value === 'MEASURED' || value === 'SYNTHETIC_DEMO' || value === 'PENDING') return value;
  throw new Error('PHONE_CONNECTED missing evidenceClass');
}

function validateCommandEnvelope(command: CanonicalLedgerCommand): void {
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(command.caseId)) throw new Error('Invalid canonical caseId');
  if (!Number.isSafeInteger(command.at) || command.at < 0) throw new Error('Invalid canonical timestamp');
}

function requiredAggregate(value: CanonicalCaseAggregate | undefined): CanonicalCaseAggregate {
  if (!value) throw new Error('Canonical aggregate missing');
  return value;
}

async function requiredEvent(transaction: CanonicalLedgerTransaction, eventId: string): Promise<CanonicalCaseEvent> {
  const event = await transaction.getEvent(eventId);
  if (!event) throw new Error('Canonical idempotency event missing');
  return event;
}

function stringField(data: SafeEventData, key: string): string {
  const value = data[key];
  if (typeof value !== 'string') throw new Error(`Canonical event missing ${key}`);
  return value;
}

function numberField(data: SafeEventData, key: string): number {
  const value = data[key];
  if (typeof value !== 'number') throw new Error(`Canonical event missing ${key}`);
  return value;
}
