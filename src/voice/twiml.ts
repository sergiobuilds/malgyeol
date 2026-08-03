function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export function incomingTwiml(recordedUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="ko-KR">승인된 개인예산으로 주문할 내용을 말씀해주세요.</Say><Record action="${escapeXml(recordedUrl)}" method="POST" maxLength="30" playBeep="true" trim="trim-silence"/><Say language="ko-KR">녹음이 확인되지 않았습니다.</Say></Response>`;
}

export function confirmationTwiml(readback: string, confirmUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="dtmf" numDigits="1" timeout="10" action="${escapeXml(confirmUrl)}" method="POST"><Say language="ko-KR">${escapeXml(readback)} 맞으면 1번, 취소는 2번을 눌러주세요.</Say></Gather><Say language="ko-KR">입력이 없어 주문을 종료합니다.</Say></Response>`;
}

export function finalTwiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="ko-KR">${escapeXml(message)}</Say><Hangup/></Response>`;
}
