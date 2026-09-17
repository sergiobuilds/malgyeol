import { randomUUID } from 'node:crypto';
import type { CareRequestService } from './service.ts';
import type { CareServiceCode } from './types.ts';
import { appendEvent } from './repository.ts';

export interface CareCall {
  callId: string;
  token: string;
  expiresAt: number;
  state: 'OPEN' | 'PENDING' | 'CANCELLED' | 'EXCEPTION' | 'CONFIRMED';
  selection?: { serviceCode: CareServiceCode; itemCode: string; readback: string };
  caseId: string;
  preferredDate?: string;
  reason?: string;
}

const blockedSpeech = /죽|자살|자해|학대|폭행|숨|아프|쓰러|응급|주소|이사|자격|계획변경|술|담배|현금|상품권|취소|필요없|말고/;

export function classifyCareSpeech(text: string, digit = ''): CareCall['selection'] {
  if (text.length > 512) return undefined;
  const normalized = text.replaceAll(/\s/g, '');
  if (blockedSpeech.test(normalized)) return undefined;
  if (digit === '1' || /쌀|곡물|식료품/.test(normalized)) return { serviceCode: 'FOOD_PACKAGE', itemCode: 'RICE_4KG', readback: '쌀 4킬로그램 한 포' };
  if (digit === '2' || /생필품|비누|샴푸|생활용품/.test(normalized)) return { serviceCode: 'DAILY_NECESSITIES', itemCode: 'HYGIENE_SET', readback: '생활용품 한 꾸러미' };
  if (digit === '3' || /밥|식사|도시락|먹을/.test(normalized)) return { serviceCode: 'MEAL_DELIVERY', itemCode: 'MEAL_REGULAR', readback: '식사 지원 한 회' };
  return undefined;
}

export class CarePhoneCoordinator {
  constructor(private readonly service: CareRequestService, private readonly now = Date.now) {}

  begin(callId: string) {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(callId)) throw new Error('INVALID_CALL_ID');
    return this.service.repository.transaction(ledger => {
      const key = `call:${callId}`;
      ledger.calls[key] ??= { callId, caseId: `CARE-${randomUUID()}`, token: randomUUID(), expiresAt: this.now() + 300_000, state: 'OPEN' };
      return this.result(ledger.calls[key]);
    });
  }

  select(callId: string, text: string, digit = '') {
    return this.service.repository.transaction(ledger => {
      const call = ledger.calls[`call:${callId}`];
      if (call?.state === 'CONFIRMED' && (text.length > 512 || blockedSpeech.test(text.replaceAll(/\s/g, '')))) {
        call.state = 'EXCEPTION'; call.reason = 'POST_CONFIRMATION_SAFETY_HOLD';
        const request = ledger.requests[call.caseId];
        if (request && request.status !== 'RECIPIENT_CONFIRMED') {
          request.status = 'EXCEPTION'; request.exceptionOrigin = 'RECIPIENT'; request.exceptionReason = call.reason; request.updatedAt = this.now();
          appendEvent(ledger, request, { caseId: request.caseId, type: 'EXCEPTION', actor: 'SYSTEM', at: request.updatedAt, detail: '접수 후 위험·취소 발화. 담당자 확인 전 자동 상태 전이 금지.' });
        }
        return this.result(call);
      }
      if (!call || ['CONFIRMED', 'CANCELLED', 'EXCEPTION'].includes(call.state)) return this.result(call);
      // Small talk is not a request, rejection, or approval. Only exact harmless
      // turns preserve state; mixed risk/out-of-plan content still fails closed.
      if (!digit && text.length <= 512 && /^(안녕하세요|안녕하십니까|여보세요|네|예|응|알겠습니다|고맙습니다|감사합니다)[.!?。！？]*$/.test(text.replaceAll(/\s/g, ''))) {
        return this.result(call);
      }
      const selection = classifyCareSpeech(text, digit);
      if (!selection) {
        call.state = 'EXCEPTION'; call.reason = 'RISK_OR_OUTSIDE_PLAN'; delete call.selection;
      } else {
        if (call.state === 'PENDING' && call.selection?.itemCode === selection.itemCode) return this.result(call);
        call.selection = selection; call.state = 'PENDING';
        call.token = randomUUID(); call.expiresAt = this.now() + 300_000;
        call.preferredDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(this.now() + 86_400_000));
      }
      return this.result(call);
    });
  }

  async confirm(callId: string, token: string, digit: string) {
    return this.service.repository.transaction(ledger => {
      const call = ledger.calls[`call:${callId}`];
      if (!call || call.token !== token) return this.result(undefined);
      if (call.state === 'CONFIRMED' && digit === '2') {
        call.state = 'EXCEPTION'; call.reason = 'POST_CONFIRMATION_CANCEL_REQUEST';
        const request = ledger.requests[call.caseId];
        if (request && request.status !== 'RECIPIENT_CONFIRMED') {
          request.status = 'EXCEPTION'; request.exceptionOrigin = 'RECIPIENT'; request.exceptionReason = call.reason; request.updatedAt = this.now();
          appendEvent(ledger, request, { caseId: request.caseId, type: 'EXCEPTION', actor: 'RECIPIENT', at: request.updatedAt, detail: '접수 후 숫자키 취소. 제공 취소 여부는 담당자가 확인해야 함.' });
        }
        return this.result(call);
      }
      if (['CONFIRMED', 'CANCELLED', 'EXCEPTION'].includes(call.state)) return this.result(call);
      if (call.state !== 'PENDING' || !call.selection || call.expiresAt <= this.now()) {
        call.state = 'EXCEPTION'; call.reason = 'CONFIRMATION_EXPIRED'; return this.result(call);
      }
      if (digit !== '1') { call.state = 'CANCELLED'; return this.result(call); }
      try {
        this.service.createInLedger(ledger, { beneficiaryRef: 'demo-senior-01', ...call.selection,
          quantity: 1, preferredDate: call.preferredDate!,
          confirmed: true, idempotencyKey: `voice:${callId}`, caseId: call.caseId });
        call.state = 'CONFIRMED'; delete call.reason;
      } catch { call.state = 'EXCEPTION'; call.reason = 'PLAN_OR_STORAGE_REJECTED'; }
      return this.result(call);
    });
  }

  end(callId: string) {
    return this.service.repository.transaction(ledger => {
      const call = ledger.calls[`call:${callId}`];
      if (call && ['OPEN', 'PENDING'].includes(call.state)) call.state = 'CANCELLED';
      return this.result(call);
    });
  }

  status(callId: string) { return this.service.repository.transaction(ledger => this.result(ledger.calls[`call:${callId}`])); }

  private result(call: CareCall | undefined): Partial<CareCall> & { state: CareCall['state']; message: string; synthetic: boolean } {
    const message = call?.state === 'CONFIRMED' ? '연습용 요청이 한 번 접수되었습니다. 실제 수행기관 전달이나 배송은 아직 이루어지지 않았습니다.'
      : call?.state === 'OPEN' ? '말결 연습 전화입니다. 필요한 식품이나 생필품, 식사 지원을 말씀해 주세요. 말로 답하셔도 접수되지 않으며 내용을 확인한 뒤 숫자키로 승인합니다.'
      : call?.state === 'PENDING' ? `연습용 요청입니다. ${call.preferredDate}에 ${call.selection!.readback} 지원을 요청할까요? 맞으면 1번, 취소는 2번을 눌러 주세요.`
      : call?.state === 'CANCELLED' ? '요청을 취소했습니다.'
      : call?.reason?.startsWith('POST_CONFIRMATION_') ? '이미 접수된 요청을 담당자 확인 대상으로 보류했습니다. 실제 취소나 제공 중단 여부는 아직 확인되지 않았습니다.'
      : '자동 접수하지 않았습니다. 담당자 확인이 필요합니다. 긴급한 건강 위험은 119에 연락해 주세요.';
    return { ...(call ? structuredClone(call) : { state: 'EXCEPTION' as const }), message, synthetic: true };
  }
}
