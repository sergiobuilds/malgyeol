import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryCareRequestRepository } from '../../src/care-support/repository.ts';
import { CareRequestService } from '../../src/care-support/service.ts';
import { createCareRequestHandlers } from '../../src/http/careRequestRoutes.ts';

test('approved care request reaches recipient confirmation without payment', async () => {
  let now = 1_000;
  const service = new CareRequestService(new InMemoryCareRequestRepository(), () => now++);
  const handle = createCareRequestHandlers(service);
  const created = await handle({ method: 'POST', pathname: '/api/demo/care/requests', body: {
    beneficiaryRef: 'demo-senior-01', serviceCode: 'FOOD_PACKAGE', itemCode: 'RICE_4KG',
    quantity: 1, preferredDate: '2026-09-18', confirmed: true
  } });
  assert.equal(created.status, 201);
  const caseId = (created.body as any).request.caseId;
  for (const action of ['PROVIDER_ACCEPT', 'MARK_PROVIDED', 'CONFIRM_RECEIPT']) {
    const result = await handle({ method: 'POST', pathname: `/api/demo/care/requests/${caseId}/actions`, body: { action } });
    assert.equal(result.status, 200);
  }
  const evidence = await handle({ method: 'GET', pathname: `/api/demo/care/requests/${caseId}/events` });
  assert.equal((evidence.body as any).request.status, 'RECIPIENT_CONFIRMED');
  assert.deepEqual((evidence.body as any).events.map((value: any) => value.type), [
    'REQUESTED', 'CONFIRMED', 'PROVIDER_ACCEPTED', 'PROVIDED', 'RECIPIENT_CONFIRMED'
  ]);
  assert.doesNotMatch(JSON.stringify(evidence.body), /payment|결제|잔액/i);
});

test('care request refuses unregistered people, plan mismatches and missing confirmation', async () => {
  const handle = createCareRequestHandlers(new CareRequestService(new InMemoryCareRequestRepository()));
  const base = { serviceCode: 'FOOD_PACKAGE', itemCode: 'RICE_4KG', quantity: 1, preferredDate: '2026-09-18', confirmed: true };
  assert.equal((await handle({ method: 'POST', pathname: '/api/demo/care/requests', body: { ...base, beneficiaryRef: 'unknown' } })).status, 409);
  assert.equal((await handle({ method: 'POST', pathname: '/api/demo/care/requests', body: { ...base, beneficiaryRef: 'demo-senior-01', serviceCode: 'UNAPPROVED' } })).status, 409);
  assert.equal((await handle({ method: 'POST', pathname: '/api/demo/care/requests', body: { ...base, beneficiaryRef: 'demo-senior-01', confirmed: false } })).status, 409);
});

test('care request sends exceptional cases to a human work queue', async () => {
  const service = new CareRequestService(new InMemoryCareRequestRepository());
  const handle = createCareRequestHandlers(service);
  const created = await handle({ method: 'POST', pathname: '/api/demo/care/requests', body: {
    beneficiaryRef: 'demo-senior-01', serviceCode: 'MEAL_DELIVERY', itemCode: 'MEAL_SOFT',
    quantity: 1, preferredDate: '2026-09-18', confirmed: true
  } });
  const caseId = (created.body as any).request.caseId;
  const raised = await handle({ method: 'POST', pathname: `/api/demo/care/requests/${caseId}/actions`, body: {
    action: 'RAISE_EXCEPTION', reason: '어르신이 건강 이상을 호소함'
  } });
  assert.equal((raised.body as any).request.status, 'EXCEPTION');
});
