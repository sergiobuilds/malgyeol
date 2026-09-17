import { verifyTwilioSignature } from './twilioSignature.ts';
import type { CareRequestService } from '../care-support/service.ts';
import { CarePhoneCoordinator } from '../care-support/phone.ts';

interface VoiceRequest {
  signature: string;
  params: Record<string, string>;
  url: string;
  verificationParams: Record<string, string>;
}

export function createCareVoiceHandlers(input: {
  authToken: string; baseUrl: string; service: CareRequestService; now?: () => Date;
  onConfirmed?: (caseId: string) => Promise<unknown>;
}) {
  const phone = new CarePhoneCoordinator(input.service, () => input.now?.().getTime() ?? Date.now());
  const valid = (r: VoiceRequest) => verifyTwilioSignature(input.authToken, r.signature, r.url, r.verificationParams);
  const forbidden = () => ({ status: 403, headers: {}, body: 'Forbidden' });
  return {
    incoming(request: VoiceRequest) {
      if (!valid(request)) return forbidden();
      if (!request.params.CallSid) return xml('<Say>통화 식별이 없어 접수하지 않습니다.</Say>');
      phone.begin(request.params.CallSid);
      return xml(`<Gather input="speech dtmf" action="${escapeXml(input.baseUrl)}/voice/request" method="POST" numDigits="1" speechTimeout="auto" language="ko-KR"><Say language="ko-KR">말결입니다. 연습용 요청으로 실제 배송은 되지 않습니다. 쌀은 1번, 생필품은 2번, 식사는 3번입니다.</Say></Gather>`);
    },
    async request(request: VoiceRequest) {
      if (!valid(request)) return forbidden();
      const callId = request.params.CallSid;
      if (!callId) return xml('<Say>통화 식별이 없어 접수하지 않습니다.</Say>');
      phone.begin(callId);
      const result = phone.select(callId, request.params.SpeechResult ?? '', request.params.Digits);
      if (result.state !== 'PENDING') return xml(`<Say language="ko-KR">${escapeXml(result.message)}</Say><Hangup/>`);
      const action = `${input.baseUrl}/voice/confirm?pending=${encodeURIComponent(result.token!)}`;
      return xml(`<Gather input="dtmf" action="${escapeXml(action)}" method="POST" numDigits="1" timeout="10"><Say language="ko-KR">요청하실 내용은 ${escapeXml(result.selection!.readback)}입니다. ${escapeXml(result.message)}</Say></Gather><Hangup/>`);
    },
    async confirm(request: VoiceRequest) {
      if (!valid(request)) return forbidden();
      const result = await phone.confirm(request.params.CallSid ?? '', request.params.pending ?? '', request.params.Digits ?? '');
      if (result.state === 'CONFIRMED' && result.caseId) await input.onConfirmed?.(result.caseId);
      return xml(`<Say language="ko-KR">${escapeXml(result.message)}</Say><Hangup/>`);
    }
  };
}

function xml(content: string) {
  return { status: 200, headers: { 'content-type': 'text/xml; charset=utf-8' }, body: `<?xml version="1.0" encoding="UTF-8"?><Response>${content}</Response>` };
}
function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
