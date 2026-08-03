import type {
  CanonicalCaseAggregate,
  CanonicalCaseEvent,
  CaseProjectionEnvelope,
  EvidenceClass,
  SafeEventData
} from './types.ts';

export type CaseProjection =
  | CaseProjectionEnvelope<RecipientProjection>
  | CaseProjectionEnvelope<InstitutionProjection>
  | CaseProjectionEnvelope<SupplierProjection>
  | CaseProjectionEnvelope<JudgeProjection>
  | CaseProjectionEnvelope<ChainProjection>;

interface RecipientProjection {
  nextAction: string;
  amountKrw?: number;
  supplierState?: string;
  updatedAt: number;
}

interface InstitutionProjection extends RecipientProjection {
  policySnapshotHash?: string;
  conditionHash?: string;
  approvalRevision?: number;
  approvalValidUntil?: number;
  approvalInvalidated: boolean;
  failures: Array<{ eventId: string; reasonCode: string; component: string; retryable: boolean; at: number }>;
}

interface SupplierProjection {
  externalOrderId?: string;
  supplierState?: string;
  fulfillmentState: string;
}

interface JudgeProjection {
  factClass: EvidenceClass;
  policySnapshotHash?: string;
  approvalRevision?: number;
  x402ApprovalRevision?: number;
  devnetApprovalRevision?: number;
  timeline: Array<{ eventId: string; type: string; state: string; at: number; previousHash: string; eventHash: string }>;
}

interface ChainProjection {
  policySnapshotHash?: string;
  approvalRevision?: number;
  events: Array<{ eventId: string; type: string; state: string; sequence: number; at: number; previousHash: string; eventHash: string }>;
}

export function projectCanonicalCase(
  aggregate: CanonicalCaseAggregate,
  events: CanonicalCaseEvent[],
  role: CaseProjection['role']
): CaseProjection {
  const envelope = { role, caseId: aggregate.caseId, currentState: aggregate.currentState, sequence: aggregate.sequence } as const;
  if (role === 'recipient') return { ...envelope, role, data: recipientData(aggregate, events) };
  if (role === 'institution') {
    return {
      ...envelope,
      role,
      data: {
        ...recipientData(aggregate, events),
        ...(aggregate.policySnapshotHash ? { policySnapshotHash: aggregate.policySnapshotHash } : {}),
        ...(aggregate.conditionHash ? { conditionHash: aggregate.conditionHash } : {}),
        ...(aggregate.approvalRevision === undefined ? {} : { approvalRevision: aggregate.approvalRevision }),
        ...(aggregate.approvalValidUntil === undefined ? {} : { approvalValidUntil: aggregate.approvalValidUntil }),
        approvalInvalidated: aggregate.approvalInvalidated,
        failures: events.filter(event => event.type === 'STEP_FAILED').map(event => ({
          eventId: event.eventId,
          reasonCode: stringData(event.data, 'reasonCode'),
          component: stringData(event.data, 'component'),
          retryable: event.data.retryable === true,
          at: event.at
        }))
      }
    };
  }
  if (role === 'supplier') {
    const supplier = [...events].reverse().find(event => event.type === 'SUPPLIER_CONFIRMED');
    return {
      ...envelope,
      role,
      data: {
        ...(aggregate.supplierOrderId ? { externalOrderId: aggregate.supplierOrderId } : {}),
        ...(supplier ? { supplierState: stringData(supplier.data, 'supplierState') } : {}),
        fulfillmentState: aggregate.currentState
      }
    };
  }
  if (role === 'judge') {
    return {
      ...envelope,
      role,
      data: {
        factClass: aggregate.evidenceClass,
        ...(aggregate.policySnapshotHash ? { policySnapshotHash: aggregate.policySnapshotHash } : {}),
        ...(aggregate.approvalRevision === undefined ? {} : { approvalRevision: aggregate.approvalRevision }),
        ...(aggregate.x402ApprovalRevision === undefined ? {} : { x402ApprovalRevision: aggregate.x402ApprovalRevision }),
        ...(aggregate.devnetApprovalRevision === undefined ? {} : { devnetApprovalRevision: aggregate.devnetApprovalRevision }),
        timeline: events.map(event => ({
          eventId: event.eventId, type: event.type, state: event.state, at: event.at,
          previousHash: event.previousHash, eventHash: event.eventHash
        }))
      }
    };
  }
  return {
    ...envelope,
    role: 'chain',
    data: {
      ...(aggregate.policySnapshotHash ? { policySnapshotHash: aggregate.policySnapshotHash } : {}),
      ...(aggregate.approvalRevision === undefined ? {} : { approvalRevision: aggregate.approvalRevision }),
      events: events.map(event => ({
        eventId: event.eventId, type: event.type, state: event.state, sequence: event.sequence,
        at: event.at, previousHash: event.previousHash, eventHash: event.eventHash
      }))
    }
  };
}

function recipientData(aggregate: CanonicalCaseAggregate, events: CanonicalCaseEvent[]): RecipientProjection {
  const policy = [...events].reverse().find(event => ['POLICY_EVALUATED', 'POLICY_REEVALUATED'].includes(event.type));
  const supplier = [...events].reverse().find(event => event.type === 'SUPPLIER_CONFIRMED');
  return {
    nextAction: nextAction(aggregate.currentState),
    ...(typeof policy?.data.amountKrw === 'number' ? { amountKrw: policy.data.amountKrw } : {}),
    ...(supplier ? { supplierState: stringData(supplier.data, 'supplierState') } : {}),
    updatedAt: aggregate.updatedAt
  };
}

function nextAction(state: CanonicalCaseAggregate['currentState']): string {
  if (state === 'PHONE_CONNECTED') return '요청을 말씀해 주세요';
  if (state === 'POLICY_EVALUATED') return '상품과 총액을 확인해 주세요';
  if (state === 'USER_CONFIRMED') return '기관 승인을 기다리고 있습니다';
  if (state === 'SUPPLIER_CONFIRMED') return '공급자가 주문을 준비하고 있습니다';
  if (state === 'DELIVERED') return '수령 여부를 확인해 주세요';
  if (state === 'RECIPIENT_CONFIRMED') return '수령 확인이 완료됐습니다';
  return '처리 상태를 확인해 주세요';
}

function stringData(data: SafeEventData, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}
