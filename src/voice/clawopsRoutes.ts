import { confirmationTwiml } from './twiml.ts';
import { verifyClawOpsSignature } from './clawopsSignature.ts';
import type { BenefitCase } from '../e2e/types.ts';

interface HandlerRequest {
  signature: string;
  params: Record<string, string>;
  url: string;
}

interface HandlerResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface VoiceDependencies {
  signingKey: string;
  baseUrl: string;
  capture(callId: string, recordingUrl: string): Promise<BenefitCase>;
  confirm(caseId: string, digit: string): Promise<BenefitCase>;
}

const xmlHeaders = { 'content-type': 'application/xml; charset=utf-8' };

export function createClawOpsVoiceHandlers(dependencies: VoiceDependencies) {
  function authenticated(request: HandlerRequest): boolean {
    return verifyClawOpsSignature(
      dependencies.signingKey,
      request.signature,
      request.url,
      request.params
    );
  }

  return {
    async incoming(request: HandlerRequest): Promise<HandlerResponse> {
      if (!authenticated(request)) return { status: 403, headers: {}, body: 'Forbidden' };
      const action = `${dependencies.baseUrl}/clawops/voice/recorded`;
      return {
        status: 200,
        headers: xmlHeaders,
        body: `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="ko-KR">승인된 개인예산으로 주문할 내용을 말씀하시고 우물정자를 눌러주세요.</Say><Record action="${escapeXml(action)}" maxLength="30" finishOnKey="#" playBeep="true"/><Say language="ko-KR">녹음이 확인되지 않았습니다.</Say></Response>`
      };
    },

    async recorded(request: HandlerRequest): Promise<HandlerResponse> {
      if (!authenticated(request)) return { status: 403, headers: {}, body: 'Forbidden' };
      const value = await dependencies.capture(request.params.CallId ?? '', request.params.RecordingUrl ?? '');
      if (value.state === 'POLICY_BLOCKED') {
        return { status: 200, headers: xmlHeaders, body: '<Response><Say language="ko-KR">이 항목은 승인된 이용계획으로 구매할 수 없습니다.</Say><Hangup/></Response>' };
      }
      if (value.state !== 'AWAITING_CONFIRMATION' || !value.candidate) {
        return { status: 200, headers: xmlHeaders, body: '<Response><Say language="ko-KR">주문 내용을 다시 말씀해주세요.</Say><Hangup/></Response>' };
      }
      const action = `${dependencies.baseUrl}/clawops/voice/confirm?caseId=${encodeURIComponent(value.caseId)}`;
      return { status: 200, headers: xmlHeaders, body: confirmationTwiml(value.candidate.readbackSentence, action) };
    },

    async confirm(request: HandlerRequest): Promise<HandlerResponse> {
      if (!authenticated(request)) return { status: 403, headers: {}, body: 'Forbidden' };
      const value = await dependencies.confirm(request.params.caseId ?? '', request.params.Digits ?? '');
      const message = value.state === 'ORDERED'
        ? `주문이 완료되었습니다. 주문번호는 ${value.providerOrderId ?? ''}입니다.`
        : '주문이 취소되었거나 처리되지 않았습니다.';
      return { status: 200, headers: xmlHeaders, body: `<Response><Say language="ko-KR">${escapeXml(message)}</Say><Hangup/></Response>` };
    }
  };
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
