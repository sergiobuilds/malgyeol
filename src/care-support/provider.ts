import { appendEvent, type CareRequestRepository } from './repository.ts';
import { CareRequestError } from './service.ts';
import type { CareRequest } from './types.ts';

export interface ProviderReceipt {
  caseId: string;
  providerRequestId: string;
  itemCode: string;
  quantity: number;
  status: 'ACCEPTED' | 'PROVIDED';
  evidenceClass: 'SANDBOX';
}

export interface CareProviderAdapter {
  readonly evidenceClass: 'SANDBOX';
  readonly providerName: string;
  submit(request: CareRequest, idempotencyKey: string): Promise<ProviderReceipt>;
  readback(caseId: string): Promise<ProviderReceipt | undefined>;
}

/** Explicit sandbox. An approved live institution must implement a separate adapter. */
export class SandboxCareProvider implements CareProviderAdapter {
  readonly evidenceClass = 'SANDBOX' as const;
  private readonly receipts = new Map<string, ProviderReceipt>();
  constructor(readonly providerName: string, private readonly repository?: CareRequestRepository) {}
  async submit(request: CareRequest, idempotencyKey: string): Promise<ProviderReceipt> {
    if (request.providerName !== this.providerName || idempotencyKey !== request.caseId) throw new Error('PROVIDER_SCOPE_MISMATCH');
    const existing = await this.readback(request.caseId);
    if (existing) return structuredClone(existing);
    const receipt: ProviderReceipt = { caseId: request.caseId, providerRequestId: `sandbox:${request.caseId}`,
      itemCode: request.itemCode, quantity: request.quantity, status: 'ACCEPTED', evidenceClass: 'SANDBOX' };
    this.receipts.set(request.caseId, receipt);
    this.repository?.transaction(ledger => { (ledger.providerReceipts ??= {})[request.caseId] = receipt; });
    return structuredClone(receipt);
  }
  async readback(caseId: string) { return this.repository ? this.repository.transaction(ledger => ledger.providerReceipts?.[caseId]) : structuredClone(this.receipts.get(caseId)); }
}

export class CareProviderDispatcher {
  constructor(private readonly repository: CareRequestRepository, private readonly adapter: CareProviderAdapter, private readonly now = Date.now, private readonly timeoutMs = 10_000) {}

  async submit(caseId: string) {
    const reservation = this.repository.transaction(ledger => {
      const request = ledger.requests[caseId];
      if (!request) throw new CareRequestError('REQUEST_NOT_FOUND', '요청을 찾을 수 없습니다.');
      if (request.providerName !== this.adapter.providerName) throw new CareRequestError('PROVIDER_NOT_APPROVED', '승인된 수행기관이 아닙니다.');
      if (request.dispatch) return { send: false, request };
      if (request.status !== 'REQUESTED') throw new CareRequestError('INVALID_TRANSITION', '전달할 수 없는 상태입니다.');
      request.dispatch = 'SENDING';
      request.status = 'PROVIDER_SUBMITTED';
      request.updatedAt = this.now();
      appendEvent(ledger, request, { caseId, type: 'PROVIDER_SUBMITTED', actor: 'SYSTEM', at: request.updatedAt, detail: 'SANDBOX 수행기관 전달 예약. 결과 불명 시 재전송 금지.' });
      return { send: true, request };
    });
    if (!reservation.send) return reservation.request;
    try {
      const receipt = await withDeadline(this.adapter.submit(reservation.request, caseId), this.timeoutMs);
      return this.accept(caseId, receipt);
    } catch {
      return this.repository.transaction(ledger => {
        const request = ledger.requests[caseId]!;
        if (request.dispatch === 'ACKNOWLEDGED') return request;
        if (request.status === 'EXCEPTION' && request.exceptionOrigin !== 'SYSTEM') return request;
        request.dispatch = 'UNKNOWN'; request.status = 'EXCEPTION';
        request.exceptionReason = 'PROVIDER_RESULT_UNKNOWN'; request.exceptionOrigin = 'SYSTEM'; request.updatedAt = this.now();
        appendEvent(ledger, request, { caseId, type: 'EXCEPTION', actor: 'SYSTEM', at: request.updatedAt, detail: '결과 불명. 재전송하지 않고 조회 또는 담당자 확인 필요.' });
        return request;
      });
    }
  }

  async readback(caseId: string) {
    const request = await this.repository.get(caseId);
    if (!request || request.providerName !== this.adapter.providerName || !request.dispatch) throw new CareRequestError('READBACK_NOT_ALLOWED', '조회할 전달 기록이 없습니다.');
    const receipt = await withDeadline(this.adapter.readback(caseId), this.timeoutMs);
    return receipt ? this.accept(caseId, receipt) : request;
  }

  private accept(caseId: string, receipt: ProviderReceipt) {
    return this.repository.transaction(ledger => {
      const request = ledger.requests[caseId]!;
      if (request.status === 'EXCEPTION' && request.exceptionOrigin !== 'SYSTEM') return request;
      if (receipt.evidenceClass !== 'SANDBOX' || receipt.caseId !== caseId || receipt.itemCode !== request.itemCode || receipt.quantity !== request.quantity || !receipt.providerRequestId) throw new Error('READBACK_MISMATCH');
      if (!['ACCEPTED', 'PROVIDED'].includes(receipt.status)) throw new Error('INVALID_PROVIDER_STATUS');
      if (request.dispatch === 'ACKNOWLEDGED') {
        if (receipt.providerRequestId !== request.providerRequestId) throw new Error('PROVIDER_ID_MISMATCH');
        if (receipt.status === 'PROVIDED' && request.status === 'PROVIDER_ACCEPTED') {
          request.status = 'PROVIDED'; request.updatedAt = this.now();
          appendEvent(ledger, request, { caseId, type: 'PROVIDED', actor: 'PROVIDER', at: request.updatedAt, detail: 'SANDBOX 제공 완료 readback. 실제 배송 증거 아님.' });
        }
        return request;
      }
      if (request.dispatch !== 'SENDING' && request.dispatch !== 'UNKNOWN') throw new Error('NOT_DISPATCHED');
      request.dispatch = 'ACKNOWLEDGED'; request.providerRequestId = receipt.providerRequestId;
      request.status = 'PROVIDER_ACCEPTED'; request.updatedAt = this.now();
      delete request.exceptionReason;
      delete request.exceptionOrigin;
      appendEvent(ledger, request, { caseId, type: 'PROVIDER_ACCEPTED', actor: 'PROVIDER', at: request.updatedAt, detail: 'SANDBOX 기관 응답·품목·수량 일치. 실제 제공 증거 아님.' });
      if (receipt.status === 'PROVIDED') {
        request.status = 'PROVIDED';
        appendEvent(ledger, request, { caseId, type: 'PROVIDED', actor: 'PROVIDER', at: request.updatedAt, detail: 'SANDBOX 제공 완료 응답. 실제 배송 증거 아님.' });
      }
      return request;
    });
  }
}

async function withDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('PROVIDER_TIMEOUT')), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
