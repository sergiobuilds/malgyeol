import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { createCareApp } from '../../src/careApp.ts';

test('default runtime exposes care execution and no legacy payment routes', async (t) => {
  const server = createCareApp();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/health`).then(response => response.json()) as Record<string, unknown>;
  assert.equal(health.product, 'care-plan-execution');
  assert.equal(health.payment, 'disabled');
  for (const path of ['/api/demo/run', '/api/demo/food-order-proof', '/api/food-support/program', '/sandbox/orders']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
  assert.equal((await fetch(`${base}/api/demo/care/catalog`)).status, 200);
  assert.equal((await fetch(`${base}/?v=home`)).status, 200);
  assert.equal((await fetch(`${base}/tech`)).status, 200);
  assert.equal((await fetch(`${base}/assets/story/elder-voice-hero.png`)).status, 200);
  assert.equal((await fetch(`${base}/assets/missing.png`)).status, 404);
  assert.equal((await fetch(`${base}/.secrets/care.env`)).status, 404);
});

test('Twilio voice request creates a payment-free provider request', async (t) => {
  const previousBase = process.env.PUBLIC_BASE_URL;
  const previousToken = process.env.TWILIO_AUTH_TOKEN;
  const token = 'twilio-test-auth-token';
  process.env.PUBLIC_BASE_URL = 'https://malgyeol.example';
  process.env.TWILIO_AUTH_TOKEN = token;
  const recipientToken = 'test-recipient-token-0123456789abcdef';
  const previousRecipientToken = process.env.CARE_RECIPIENT_TOKEN;
  process.env.CARE_RECIPIENT_TOKEN = recipientToken;
  const server = createCareApp();
  if (previousRecipientToken === undefined) delete process.env.CARE_RECIPIENT_TOKEN; else process.env.CARE_RECIPIENT_TOKEN = previousRecipientToken;
  if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = previousBase;
  if (previousToken === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = previousToken;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;

  const params = { Digits: '2', CallSid: 'CA_test_01' };
  const signature = twilioSignature(token, 'https://malgyeol.example/voice/request', params);
  const response = await fetch(`${base}/voice/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature },
    body: new URLSearchParams(params)
  });
  assert.equal(response.status, 200);
  const xml = await response.text();
  assert.match(xml, /요청하실 내용은 생활용품 한 꾸러미입니다/);
  assert.doesNotMatch(xml, /결제|금액|잔액|주문번호/);
  const requests = await fetch(`${base}/api/care/inbox`, { headers: { authorization: `Bearer ${recipientToken}` } }).then(value => value.json()) as { requests: Array<{ serviceCode: string; status: string }> };
  assert.deepEqual(requests.requests, []);

  const pending = xml.match(/action="https:\/\/malgyeol\.example\/voice\/confirm\?pending=([^\"]+)"/)?.[1];
  assert.ok(pending);
  const confirmUrl = `https://malgyeol.example/voice/confirm?pending=${pending}`;
  const confirmParams = { Digits: '1', CallSid: 'CA_test_01' };
  const confirmSignature = twilioSignature(token, confirmUrl, confirmParams);
  const confirmed = await fetch(`${base}/voice/confirm?pending=${pending}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': confirmSignature },
    body: new URLSearchParams(confirmParams)
  });
  assert.equal(confirmed.status, 200);
  assert.match(await confirmed.text(), /연습용 요청이 한 번 접수되었습니다/);

  const replay = await fetch(`${base}/voice/confirm?pending=${pending}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': confirmSignature },
    body: new URLSearchParams(confirmParams)
  });
  assert.equal(replay.status, 200);
  assert.match(await replay.text(), /연습용 요청이 한 번 접수되었습니다/);
  const afterConfirm = await fetch(`${base}/api/care/inbox`, { headers: { authorization: `Bearer ${recipientToken}` } }).then(value => value.json()) as { requests: Array<{ serviceCode: string; status: string }> };
  assert.deepEqual(afterConfirm.requests.map(value => [value.serviceCode, value.status]), [['DAILY_NECESSITIES', 'PROVIDER_ACCEPTED']]);

  const cancelParams = { Digits: '1', CallSid: 'CA_test_02' };
  const cancelSelectionSignature = twilioSignature(token, 'https://malgyeol.example/voice/request', cancelParams);
  const cancelSelection = await fetch(`${base}/voice/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': cancelSelectionSignature },
    body: new URLSearchParams(cancelParams)
  });
  const cancelXml = await cancelSelection.text();
  const cancelPending = cancelXml.match(/action="https:\/\/malgyeol\.example\/voice\/confirm\?pending=([^\"]+)"/)?.[1];
  assert.ok(cancelPending);
  const cancelUrl = `https://malgyeol.example/voice/confirm?pending=${cancelPending}`;
  const cancelParamsSubmitted = { Digits: '2', CallSid: 'CA_test_02' };
  const cancelSignature = twilioSignature(token, cancelUrl, cancelParamsSubmitted);
  const cancelled = await fetch(`${base}/voice/confirm?pending=${cancelPending}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': cancelSignature },
    body: new URLSearchParams(cancelParamsSubmitted)
  });
  assert.match(await cancelled.text(), /요청을 취소했습니다/);

  const outOfPlanParams = { SpeechResult: '주소를 바꿔주세요', CallSid: 'CA_test_03' };
  const outOfPlanSignature = twilioSignature(token, 'https://malgyeol.example/voice/request', outOfPlanParams);
  const outOfPlan = await fetch(`${base}/voice/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': outOfPlanSignature },
    body: new URLSearchParams(outOfPlanParams)
  });
  assert.match(await outOfPlan.text(), /담당자 확인이 필요합니다/);
  const afterFailClosed = await fetch(`${base}/api/care/inbox`, { headers: { authorization: `Bearer ${recipientToken}` } }).then(value => value.json()) as { requests: Array<{ serviceCode: string; status: string }> };
  assert.equal(afterFailClosed.requests.length, 1);
});

function twilioSignature(token: string, url: string, params: Record<string, string>): string {
  const payload = url + Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}${value}`).join('');
  return createHmac('sha1', token).update(payload).digest('base64');
}
