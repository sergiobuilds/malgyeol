import { confirmationTwiml, incomingTwiml } from './twiml.ts';
import { verifyTwilioSignature } from './twilioSignature.ts';
import type { BenefitCase } from '../e2e/types.ts';

interface HandlerRequest {
  signature: string;
  params: Record<string, string>;
  url?: string;
  verificationParams?: Record<string, string>;
}

interface HandlerResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface VoiceDependencies {
  authToken: string;
  baseUrl: string;
  capture(callSid: string, recordingUrl: string): Promise<BenefitCase>;
  confirm(caseId: string, digit: string): Promise<BenefitCase>;
}

const xmlHeaders = { 'content-type': 'text/xml; charset=utf-8' };

export function createVoiceHandlers(dependencies: VoiceDependencies) {
  function authenticated(path: string, request: HandlerRequest): boolean {
    return verifyTwilioSignature(
      dependencies.authToken,
      request.signature,
      request.url ?? `${dependencies.baseUrl}${path}`,
      request.verificationParams ?? request.params
    );
  }
  return {
    async incoming(request: HandlerRequest): Promise<HandlerResponse> {
      if (!authenticated('/voice/incoming', request)) return { status: 403, headers: {}, body: 'Forbidden' };
      return { status: 200, headers: xmlHeaders, body: incomingTwiml(`${dependencies.baseUrl}/voice/recorded`) };
    },
    async recorded(request: HandlerRequest): Promise<HandlerResponse> {
      if (!authenticated('/voice/recorded', request)) return { status: 403, headers: {}, body: 'Forbidden' };
      const value = await dependencies.capture(request.params.CallSid ?? '', request.params.RecordingUrl ?? '');
      if (value.state === 'POLICY_BLOCKED') {
        return { status: 200, headers: xmlHeaders, body: '<Response><Say language="ko-KR">이 항목은 승인된 이용계획으로 구매할 수 없습니다.</Say><Hangup/></Response>' };
      }
      if (value.state !== 'AWAITING_CONFIRMATION' || !value.candidate) {
        return { status: 200, headers: xmlHeaders, body: '<Response><Say language="ko-KR">주문 내용을 다시 말씀해주세요.</Say><Hangup/></Response>' };
      }
      const url = `${dependencies.baseUrl}/voice/confirm?caseId=${encodeURIComponent(value.caseId)}`;
      return { status: 200, headers: xmlHeaders, body: confirmationTwiml(value.candidate.readbackSentence, url) };
    },
    async confirm(request: HandlerRequest): Promise<HandlerResponse> {
      if (!authenticated('/voice/confirm', request)) return { status: 403, headers: {}, body: 'Forbidden' };
      const value = await dependencies.confirm(request.params.caseId ?? '', request.params.Digits ?? '');
      const message = value.state === 'ORDERED'
        ? `주문이 완료되었습니다. 주문번호는 ${value.providerOrderId ?? ''}입니다.`
        : '주문이 취소되었거나 처리되지 않았습니다.';
      return { status: 200, headers: xmlHeaders, body: `<Response><Say language="ko-KR">${message}</Say><Hangup/></Response>` };
    }
  };
}
