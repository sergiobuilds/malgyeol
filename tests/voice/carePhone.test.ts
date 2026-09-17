import test from 'node:test';
import assert from 'node:assert/strict';
import { CarePhoneCoordinator } from '../../src/care-support/phone.ts';
import { CareRequestService } from '../../src/care-support/service.ts';
import { InMemoryCareRequestRepository } from '../../src/care-support/repository.ts';

test('phone binds approval to a call and consumes a confirmation once under concurrency', async () => {
  const service = new CareRequestService(new InMemoryCareRequestRepository());
  const phone = new CarePhoneCoordinator(service);
  phone.begin('call_a'); phone.begin('call_b');
  const selected = phone.select('call_a', '쌀 필요해요');
  assert.equal((await service.list()).length, 0);
  assert.equal((await phone.confirm('call_b', selected.token!, '1')).state, 'EXCEPTION');
  await Promise.all(Array.from({ length: 8 }, () => phone.confirm('call_a', selected.token!, '1')));
  assert.equal((await service.list()).length, 1);
  assert.equal((await phone.confirm('call_a', selected.token!, '1')).state, 'CONFIRMED');
  assert.equal((await service.list()).length, 1);
});

test('approval across Korean midnight keeps the date that was read back', async () => {
  let now = Date.parse('2026-09-17T14:59:00Z');
  const service = new CareRequestService(new InMemoryCareRequestRepository(), () => now);
  const phone = new CarePhoneCoordinator(service, () => now);
  phone.begin('midnight');
  const selected = phone.select('midnight', '쌀');
  now = Date.parse('2026-09-17T15:01:00Z');
  const result = await phone.confirm('midnight', selected.token!, '1');
  assert.equal((await service.get(result.caseId!))?.preferredDate, '2026-09-18');
});

test('cancellation digit after confirmation holds the case without creating another request', async () => {
  const service = new CareRequestService(new InMemoryCareRequestRepository());
  const phone = new CarePhoneCoordinator(service);
  phone.begin('late-cancel');
  const selection = phone.select('late-cancel', '쌀');
  const confirmed = await phone.confirm('late-cancel', selection.token!, '1');
  assert.equal((await phone.confirm('late-cancel', selection.token!, '2')).state, 'EXCEPTION');
  const request = await service.get(confirmed.caseId!);
  assert.equal(request?.status, 'EXCEPTION');
  assert.equal(request?.exceptionOrigin, 'RECIPIENT');
  await phone.confirm('late-cancel', selection.token!, '1');
  assert.equal((await service.list()).length, 1);
});

test('risk mixed with supported nouns, cancellation and expired approvals never execute', async () => {
  const service = new CareRequestService(new InMemoryCareRequestRepository());
  let now = Date.now();
  const phone = new CarePhoneCoordinator(service, () => now);
  for (const [i, text] of ['쌀 필요하고 숨이 안 쉬어져요', '쌀 주소 바꿔주세요', '식사 말고 술 주세요', '쌀 필요없어요'].entries()) {
    const callId = `risk_${i}`;
    phone.begin(callId);
    assert.equal(phone.select(callId, text).state, 'EXCEPTION');
  }
  phone.begin('cancel');
  const cancel = phone.select('cancel', '쌀');
  assert.equal((await phone.confirm('cancel', cancel.token!, '2')).state, 'CANCELLED');
  assert.equal((await phone.confirm('cancel', cancel.token!, '1')).state, 'CANCELLED');
  phone.begin('expired');
  const expired = phone.select('expired', '쌀');
  now += 300_001;
  assert.equal((await phone.confirm('expired', expired.token!, '1')).state, 'EXCEPTION');
  assert.equal((await service.list()).length, 0);
});
