import { randomUUID } from 'node:crypto';
import { appendEvent, type CareLedger, type CareRequestRepository } from './repository.ts';
import type {
  CareCatalogItem,
  CarePlanEnrollment,
  CareRequest,
  CareRequestStatus,
  CareServiceCode
} from './types.ts';

export const SYNTHETIC_CARE_CATALOG: readonly CareCatalogItem[] = Object.freeze([
  { itemCode: 'RICE_4KG', serviceCode: 'FOOD_PACKAGE', name: '쌀 4kg', unit: '포', providerName: '찾아가는 푸드마켓', availability: 'AVAILABLE' },
  { itemCode: 'NOODLE_SET', serviceCode: 'FOOD_PACKAGE', name: '라면·통조림 꾸러미', unit: '꾸러미', providerName: '찾아가는 푸드마켓', availability: 'AVAILABLE' },
  { itemCode: 'HYGIENE_SET', serviceCode: 'DAILY_NECESSITIES', name: '비누·샴푸 생활용품', unit: '꾸러미', providerName: '찾아가는 푸드마켓', availability: 'LIMITED' },
  { itemCode: 'MEAL_REGULAR', serviceCode: 'MEAL_DELIVERY', name: '일반식 도시락', unit: '식', providerName: '돌봄SOS 협약 수행기관', availability: 'AVAILABLE' },
  { itemCode: 'MEAL_SOFT', serviceCode: 'MEAL_DELIVERY', name: '부드러운 식사', unit: '식', providerName: '돌봄SOS 협약 수행기관', availability: 'AVAILABLE' }
]);

export const SYNTHETIC_ENROLLMENT: CarePlanEnrollment = Object.freeze({
  beneficiaryRef: 'demo-senior-01',
  displayName: '김말순 어르신',
  allowedServices: ['FOOD_PACKAGE', 'DAILY_NECESSITIES', 'MEAL_DELIVERY'] as CareServiceCode[],
  remainingOccurrences: { FOOD_PACKAGE: 2, DAILY_NECESSITIES: 1, MEAL_DELIVERY: 10 },
  activeUntil: '2026-12-31'
});

export class CareRequestError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export interface CreateCareRequestInput {
  beneficiaryRef: string;
  serviceCode: CareServiceCode;
  itemCode: string;
  quantity: number;
  preferredDate: string;
  confirmed: boolean;
  idempotencyKey?: string;
  caseId?: string;
}

type CareAction = 'PROVIDER_ACCEPT' | 'MARK_PROVIDED' | 'CONFIRM_RECEIPT' | 'RAISE_EXCEPTION';

export class CareRequestService {
  constructor(
    readonly repository: CareRequestRepository,
    private readonly now: () => number = Date.now
  ) {}

  catalog(): { enrollment: CarePlanEnrollment; items: readonly CareCatalogItem[] } {
    return { enrollment: SYNTHETIC_ENROLLMENT, items: SYNTHETIC_CARE_CATALOG };
  }

  async create(input: CreateCareRequestInput): Promise<CareRequest> {
    return this.repository.transaction(ledger => this.createInLedger(ledger, input));
  }

  createInLedger(ledger: CareLedger, input: CreateCareRequestInput): CareRequest {
    if (input.caseId && (!/^CARE-[a-zA-Z0-9-]+$/.test(input.caseId) || Object.hasOwn(ledger.requests, input.caseId))) throw new CareRequestError('CASE_ID_CONFLICT', '사건 식별자가 유효하지 않거나 이미 존재합니다.');
    if (input.idempotencyKey) {
      const previous = Object.values(ledger.requests).find(r => r.idempotencyKey === input.idempotencyKey);
      if (previous) {
        if (!input.confirmed || previous.beneficiaryRef !== input.beneficiaryRef || previous.itemCode !== input.itemCode || previous.serviceCode !== input.serviceCode || previous.quantity !== input.quantity || previous.preferredDate !== input.preferredDate) throw new CareRequestError('IDEMPOTENCY_CONFLICT', '이미 접수된 요청과 내용이 다릅니다.');
        return previous;
      }
    }
    if (input.beneficiaryRef !== SYNTHETIC_ENROLLMENT.beneficiaryRef) throw new CareRequestError('ENROLLMENT_REQUIRED', '등록된 개인별지원계획을 확인할 수 없습니다.');
    if (!input.confirmed) throw new CareRequestError('RECIPIENT_CONFIRMATION_REQUIRED', '이용자 확인이 필요합니다.');
    if (!SYNTHETIC_ENROLLMENT.allowedServices.includes(input.serviceCode)) throw new CareRequestError('SERVICE_NOT_IN_PLAN', '개인별지원계획에 없는 서비스입니다.');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(this.now()));
    if (today > SYNTHETIC_ENROLLMENT.activeUntil) throw new CareRequestError('PLAN_EXPIRED', '계획 기간이 종료되었습니다.');
    const used = Object.values(ledger.requests).filter(r => r.beneficiaryRef === input.beneficiaryRef && r.serviceCode === input.serviceCode).reduce((sum, r) => sum + r.quantity, 0);
    const remaining = SYNTHETIC_ENROLLMENT.remainingOccurrences[input.serviceCode] - used;
    if (remaining < 1) throw new CareRequestError('PLAN_LIMIT_EXCEEDED', '승인된 이용 횟수를 모두 사용했습니다.');
    const item = SYNTHETIC_CARE_CATALOG.find(value => value.itemCode === input.itemCode && value.serviceCode === input.serviceCode);
    if (!item || item.availability === 'UNAVAILABLE') throw new CareRequestError('ITEM_UNAVAILABLE', '현재 제공할 수 없는 품목입니다.');
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > Math.min(5, remaining)) throw new CareRequestError('INVALID_QUANTITY', '승인 범위 안의 수량을 선택해 주세요.');
    const date = new Date(`${input.preferredDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.preferredDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.preferredDate || input.preferredDate < today || input.preferredDate > SYNTHETIC_ENROLLMENT.activeUntil) throw new CareRequestError('INVALID_PREFERRED_DATE', '제공 희망일을 확인해 주세요.');

    const at = this.now();
    const request: CareRequest = {
      caseId: input.caseId ?? `CARE-${randomUUID()}`,
      evidenceClass: 'SYNTHETIC_DEMO',
      beneficiaryRef: input.beneficiaryRef,
      beneficiaryDisplayName: SYNTHETIC_ENROLLMENT.displayName,
      serviceCode: input.serviceCode,
      itemCode: item.itemCode,
      itemName: item.name,
      quantity: input.quantity,
      preferredDate: input.preferredDate,
      providerName: item.providerName,
      status: 'REQUESTED',
      createdAt: at,
      updatedAt: at
      ,...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
    };
    appendEvent(ledger, request, {
      caseId: request.caseId,
      type: 'REQUESTED',
      actor: 'RECIPIENT',
      at,
      detail: '이용자가 품목·수량·제공일을 듣고 요청을 확인함'
    });
    appendEvent(ledger, request, { caseId: request.caseId, type: 'CONFIRMED', actor: 'RECIPIENT', at, detail: '명시 확인 후 실행 권한 확정' });
    return request;
  }

  async act(caseId: string, action: CareAction, reason?: string, role?: 'PROVIDER' | 'RECIPIENT' | 'OPERATOR'): Promise<CareRequest> {
    if (!/^CARE-[a-zA-Z0-9-]+$/.test(caseId)) throw new CareRequestError('REQUEST_NOT_FOUND', '요청을 찾을 수 없습니다.');
    return this.repository.transaction(ledger => {
    if (role && !(role === 'PROVIDER' && ['PROVIDER_ACCEPT', 'MARK_PROVIDED'].includes(action) || role === 'RECIPIENT' && action === 'CONFIRM_RECEIPT' || role === 'OPERATOR' && action === 'RAISE_EXCEPTION')) throw new CareRequestError('ROLE_FORBIDDEN', '이 역할에는 실행 권한이 없습니다.');
    const current = ledger.requests[caseId];
    if (!current) throw new CareRequestError('REQUEST_NOT_FOUND', '요청을 찾을 수 없습니다.');

    const transition = transitionFor(current.status, action);
    const at = this.now();
    const updated: CareRequest = {
      ...current,
      status: transition.status,
      updatedAt: at,
      ...(transition.status === 'EXCEPTION' ? { exceptionReason: cleanReason(reason), exceptionOrigin: 'OPERATOR' as const } : {})
    };
    appendEvent(ledger, updated, {
      caseId,
      type: transition.status,
      actor: transition.actor,
      at,
      detail: transition.status === 'EXCEPTION' ? updated.exceptionReason! : transition.detail
    });
    return updated;
    });
  }

  get(caseId: string) { return /^CARE-[a-zA-Z0-9-]+$/.test(caseId) ? this.repository.get(caseId) : Promise.resolve(undefined); }
  list() { return this.repository.list(); }
  events(caseId: string) { return /^CARE-[a-zA-Z0-9-]+$/.test(caseId) ? this.repository.events(caseId) : Promise.resolve([]); }
}

function transitionFor(status: CareRequestStatus, action: CareAction): { status: CareRequestStatus; actor: 'PROVIDER' | 'RECIPIENT' | 'OPERATOR'; detail: string } {
  if (action === 'RAISE_EXCEPTION' && status !== 'RECIPIENT_CONFIRMED') return { status: 'EXCEPTION', actor: 'OPERATOR', detail: '사람의 확인이 필요한 예외로 이관함' };
  if (status === 'REQUESTED' && action === 'PROVIDER_ACCEPT') return { status: 'PROVIDER_ACCEPTED', actor: 'PROVIDER', detail: '수행기관이 제공 요청을 수락함' };
  if (status === 'PROVIDER_ACCEPTED' && action === 'MARK_PROVIDED') return { status: 'PROVIDED', actor: 'PROVIDER', detail: '수행기관이 물품 또는 서비스를 제공함' };
  if (status === 'PROVIDED' && action === 'CONFIRM_RECEIPT') return { status: 'RECIPIENT_CONFIRMED', actor: 'RECIPIENT', detail: '이용자가 실제 수령을 확인함' };
  throw new CareRequestError('INVALID_TRANSITION', '현재 상태에서 처리할 수 없는 작업입니다.');
}

function cleanReason(value: string | undefined): string {
  const normalized = value?.trim().slice(0, 200);
  return normalized || '담당자 확인 필요';
}
