import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryCaseRepository } from '../../src/e2e/inMemoryCaseRepository.ts';
import type { BenefitCase } from '../../src/e2e/types.ts';
import { createRoleHandlers, RoleAccessTokenService } from '../../src/http/roleAccess.ts';
import { InMemoryRoleWorkflowRepository } from '../../src/roles/workflow.ts';
import * as XLSX from '@e965/xlsx';

const baseCase = (caseId: string, providerOrderId?: string): BenefitCase => ({
  caseId, callSidHash: 'hidden', beneficiaryRef: 'hidden', programId: 'food-support-2026', planId: 'plan',
  state: providerOrderId ? 'ORDERED' : 'CALL_CONNECTED', ...(providerOrderId ? { providerOrderId } : {}),
  createdAt: 1, updatedAt: 1
});

test('role access tokens bind role, scope and expiry', () => {
  let now = 1000;
  const service = new RoleAccessTokenService('r'.repeat(32), () => now);
  const issued = service.issue('caregiver', ['case_one'], 1000);
  assert.deepEqual(service.verify('caregiver', issued.token)?.caseIds, ['case_one']);
  assert.equal(service.verify('caregiver', issued.token)?.accessLevel, 'read');
  assert.equal(service.verify('ops', issued.token), undefined);
  now = 2001;
  assert.equal(service.verify('caregiver', issued.token), undefined);
});

test('role overview enforces caregiver scope and merchant order minimization', async () => {
  const repository = new InMemoryCaseRepository();
  await repository.create(baseCase('case_one'));
  await repository.create(baseCase('case_two', 'ORDER-2'));
  const tokens = new RoleAccessTokenService('r'.repeat(32));
  const handler = createRoleHandlers(repository, tokens, new InMemoryRoleWorkflowRepository());
  const unauthorized = await handler({ method: 'GET', pathname: '/api/roles/ops/overview' });
  assert.equal(unauthorized.status, 401);

  const caregiver = tokens.issue('caregiver', ['case_one']);
  const caregiverResult = await handler({ method: 'GET', pathname: '/api/roles/caregiver/overview', authorization: `Bearer ${caregiver.token}` });
  const caregiverBody = caregiverResult.body as { readOnly: boolean; cases: Array<{ caseId: string }> };
  assert.equal(caregiverBody.readOnly, true);
  assert.deepEqual(caregiverBody.cases.map(value => value.caseId), ['case_one']);

  const malformed = await handler({ method: 'POST', pathname: '/api/roles/caregiver/actions', authorization: `Bearer ${tokens.issue('caregiver', ['case_one'], 15 * 60_000, 'act', 'caregiver-malformed').token}`, body: {
    action: 'REQUEST_CHANGE', expectedRevision: 0
  } });
  assert.equal(malformed.status, 400);

  const merchant = tokens.issue('merchant', ['case_one', 'case_two']);
  const merchantResult = await handler({ method: 'GET', pathname: '/api/roles/merchant/overview', authorization: `Bearer ${merchant.token}` });
  const merchantBody = merchantResult.body as { cases: Array<{ caseId: string; providerOrderId?: string }> };
  assert.deepEqual(merchantBody.cases.map(value => value.caseId), ['case_two']);
  assert.equal(JSON.stringify(merchantBody).includes('beneficiaryRef'), false);
  assert.throws(() => tokens.issue('ops'), /requires a case scope/);
});

test('role actions enforce read-only scope, invalidate consent and preserve external readback', async () => {
  let now = 10;
  const repository = new InMemoryCaseRepository();
  await repository.create(baseCase('case_order', 'EXTERNAL-READBACK-1'));
  const workflows = new InMemoryRoleWorkflowRepository(() => ++now);
  const tokens = new RoleAccessTokenService('r'.repeat(32));
  const handler = createRoleHandlers(repository, tokens, workflows);

  const read = tokens.issue('ops', ['case_order']);
  const denied = await handler({ method: 'POST', pathname: '/api/roles/ops/actions', authorization: `Bearer ${read.token}`, body: {
    caseId: 'case_order', action: 'REVIEW_POLICY', expectedRevision: 0
  } });
  assert.equal(denied.status, 403);

  const ops = tokens.issue('ops', ['case_order'], 15 * 60_000, 'act', 'ops-reviewer');
  const reviewed = await handler({ method: 'POST', pathname: '/api/roles/ops/actions', authorization: `Bearer ${ops.token}`, body: {
    caseId: 'case_order', action: 'REVIEW_POLICY', expectedRevision: 0
  } });
  assert.equal(reviewed.status, 200);
  const consent = await handler({ method: 'POST', pathname: '/api/roles/ops/actions', authorization: `Bearer ${ops.token}`, body: {
    caseId: 'case_order', action: 'RECORD_CONSENT', expectedRevision: 1, data: { fingerprint: 'a'.repeat(64) }
  } });
  assert.equal((consent.body as any).workflow.consent.status, 'RECORDED');

  const caregiver = tokens.issue('caregiver', ['case_order'], 15 * 60_000, 'act', 'caregiver-editor');
  const changed = await handler({ method: 'POST', pathname: '/api/roles/caregiver/actions', authorization: `Bearer ${caregiver.token}`, body: {
    caseId: 'case_order', action: 'REQUEST_CHANGE', expectedRevision: 2, data: { changedFields: ['product', 'shippingFee'] }
  } });
  assert.equal((changed.body as any).workflow.consent.status, 'INVALIDATED');
  assert.equal((changed.body as any).workflow.ops.policyReview, 'PENDING');
  assert.equal((changed.body as any).workflow.caregiver.coApproval, 'NONE');
  assert.equal((changed.body as any).workflow.externalReadbackImmutable, true);
  assert.equal((await repository.get('case_order'))?.providerOrderId, 'EXTERNAL-READBACK-1');

  const merchant = tokens.issue('merchant', ['case_order'], 15 * 60_000, 'act', 'merchant-after-change');
  assert.equal((await handler({ method: 'POST', pathname: '/api/roles/merchant/actions', authorization: `Bearer ${merchant.token}`, body: {
    caseId: 'case_order', action: 'ACKNOWLEDGE_ORDER', expectedRevision: 3
  } })).status, 200);
  const unsafePreparing = await handler({ method: 'POST', pathname: '/api/roles/merchant/actions', authorization: `Bearer ${merchant.token}`, body: {
    caseId: 'case_order', action: 'MARK_PREPARING', expectedRevision: 4
  } });
  assert.equal(unsafePreparing.status, 409);

  const stale = await handler({ method: 'POST', pathname: '/api/roles/caregiver/actions', authorization: `Bearer ${caregiver.token}`, body: {
    caseId: 'case_order', action: 'REQUEST_COAPPROVAL', expectedRevision: 3
  } });
  assert.equal(stale.status, 409);
});

test('merchant fulfillment transitions and ops XLSX are role scoped', async () => {
  const repository = new InMemoryCaseRepository();
  await repository.create(baseCase('case_plain'));
  await repository.create(baseCase('case_order', 'ORDER-1'));
  await repository.create(baseCase('case_cancel', 'ORDER-2'));
  const workflows = new InMemoryRoleWorkflowRepository(() => 20);
  const tokens = new RoleAccessTokenService('r'.repeat(32));
  const handler = createRoleHandlers(repository, tokens, workflows);
  const merchant = tokens.issue('merchant', ['case_plain', 'case_order'], 15 * 60_000, 'act', 'merchant-operator');
  const opsSetup = tokens.issue('ops', ['case_order'], 15 * 60_000, 'act', 'ops-setup');
  const careRequester = tokens.issue('caregiver', ['case_order'], 15 * 60_000, 'act', 'caregiver-requester');
  const careApprover = tokens.issue('caregiver', ['case_order'], 15 * 60_000, 'act', 'caregiver-approver');
  assert.equal((await handler({ method: 'POST', pathname: '/api/roles/ops/actions', authorization: `Bearer ${opsSetup.token}`, body: {
    caseId: 'case_order', action: 'REVIEW_POLICY', expectedRevision: 0
  } })).status, 200);
  assert.equal((await handler({ method: 'POST', pathname: '/api/roles/ops/actions', authorization: `Bearer ${opsSetup.token}`, body: {
    caseId: 'case_order', action: 'RECORD_CONSENT', expectedRevision: 1, data: { fingerprint: 'd'.repeat(64) }
  } })).status, 200);
  assert.equal((await handler({ method: 'POST', pathname: '/api/roles/caregiver/actions', authorization: `Bearer ${careRequester.token}`, body: {
    caseId: 'case_order', action: 'REQUEST_COAPPROVAL', expectedRevision: 2
  } })).status, 200);
  const selfApproval = await handler({ method: 'POST', pathname: '/api/roles/caregiver/actions', authorization: `Bearer ${careRequester.token}`, body: {
    caseId: 'case_order', action: 'APPROVE_COAPPROVAL', expectedRevision: 3
  } });
  assert.equal(selfApproval.status, 409);
  assert.equal((await handler({ method: 'POST', pathname: '/api/roles/caregiver/actions', authorization: `Bearer ${careApprover.token}`, body: {
    caseId: 'case_order', action: 'APPROVE_COAPPROVAL', expectedRevision: 3
  } })).status, 200);
  const ack = await handler({ method: 'POST', pathname: '/api/roles/merchant/actions', authorization: `Bearer ${merchant.token}`, body: {
    caseId: 'case_order', action: 'ACKNOWLEDGE_ORDER', expectedRevision: 4
  } });
  assert.equal((ack.body as any).workflow.merchant.fulfillment, 'ACKNOWLEDGED');
  const preparing = await handler({ method: 'POST', pathname: '/api/roles/merchant/actions', authorization: `Bearer ${merchant.token}`, body: {
    caseId: 'case_order', action: 'MARK_PREPARING', expectedRevision: 5
  } });
  assert.equal((preparing.body as any).workflow.merchant.fulfillment, 'PREPARING');
  const shipped = await handler({ method: 'POST', pathname: '/api/roles/merchant/actions', authorization: `Bearer ${merchant.token}`, body: {
    caseId: 'case_order', action: 'REGISTER_SHIPMENT', expectedRevision: 6,
    data: { carrierCode: 'CJ', trackingNumber: '12345-67890' }
  } });
  assert.equal((shipped.body as any).workflow.merchant.fulfillment, 'SHIPPED');

  const caregiver = tokens.issue('caregiver', ['case_order'], 15 * 60_000, 'act', 'caregiver-late');
  const lateChange = await handler({ method: 'POST', pathname: '/api/roles/caregiver/actions', authorization: `Bearer ${caregiver.token}`, body: {
    caseId: 'case_order', action: 'REQUEST_CHANGE', expectedRevision: 7, data: { changedFields: ['product'] }
  } });
  assert.equal(lateChange.status, 409);
  const opsAct = tokens.issue('ops', ['case_order'], 15 * 60_000, 'act', 'ops-late');
  const lateConsent = await handler({ method: 'POST', pathname: '/api/roles/ops/actions', authorization: `Bearer ${opsAct.token}`, body: {
    caseId: 'case_order', action: 'RECORD_CONSENT', expectedRevision: 7, data: { fingerprint: 'c'.repeat(64) }
  } });
  assert.equal(lateConsent.status, 409);

  const noOrder = await handler({ method: 'POST', pathname: '/api/roles/merchant/actions', authorization: `Bearer ${merchant.token}`, body: {
    caseId: 'case_plain', action: 'ACKNOWLEDGE_ORDER', expectedRevision: 0
  } });
  assert.equal(noOrder.status, 409);

  const merchantCancel = tokens.issue('merchant', ['case_cancel'], 15 * 60_000, 'act', 'merchant-cancel');
  const caregiverCancel = tokens.issue('caregiver', ['case_cancel'], 15 * 60_000, 'act', 'caregiver-cancel');
  assert.equal((await handler({ method: 'POST', pathname: '/api/roles/merchant/actions', authorization: `Bearer ${merchantCancel.token}`, body: {
    caseId: 'case_cancel', action: 'ACKNOWLEDGE_ORDER', expectedRevision: 0
  } })).status, 200);
  assert.equal((await handler({ method: 'POST', pathname: '/api/roles/merchant/actions', authorization: `Bearer ${merchantCancel.token}`, body: {
    caseId: 'case_cancel', action: 'PROPOSE_SUBSTITUTION', expectedRevision: 1, data: { goodsNo: 'ALT-1', reasonCode: 'OUT_OF_STOCK' }
  } })).status, 200);
  assert.equal((await handler({ method: 'POST', pathname: '/api/roles/merchant/actions', authorization: `Bearer ${merchantCancel.token}`, body: {
    caseId: 'case_cancel', action: 'MARK_OUT_OF_STOCK', expectedRevision: 2
  } })).status, 200);
  assert.equal((await handler({ method: 'POST', pathname: '/api/roles/caregiver/actions', authorization: `Bearer ${caregiverCancel.token}`, body: {
    caseId: 'case_cancel', action: 'REQUEST_CANCELLATION', expectedRevision: 3
  } })).status, 200);
  assert.equal((await handler({ method: 'POST', pathname: '/api/roles/merchant/actions', authorization: `Bearer ${merchantCancel.token}`, body: {
    caseId: 'case_cancel', action: 'ACCEPT_CANCELLATION', expectedRevision: 4
  } })).status, 200);
  const repeatedCaregiverCancel = await handler({ method: 'POST', pathname: '/api/roles/caregiver/actions', authorization: `Bearer ${caregiverCancel.token}`, body: {
    caseId: 'case_cancel', action: 'REQUEST_CANCELLATION', expectedRevision: 5
  } });
  assert.equal(repeatedCaregiverCancel.status, 409);
  const refunded = await handler({ method: 'POST', pathname: '/api/roles/merchant/actions', authorization: `Bearer ${merchantCancel.token}`, body: {
    caseId: 'case_cancel', action: 'MARK_REFUNDED', expectedRevision: 5
  } });
  assert.equal((refunded.body as any).workflow.merchant.fulfillment, 'REFUNDED');

  const ops = tokens.issue('ops', ['case_order']);
  const exported = await handler({ method: 'GET', pathname: '/api/roles/ops/export.xlsx', authorization: `Bearer ${ops.token}` });
  assert.equal(exported.status, 200);
  assert.ok(Buffer.isBuffer(exported.body));
  assert.match(String(exported.contentType), /spreadsheet/);
  const workbook = XLSX.read(exported.body as Buffer, { type: 'buffer' });
  const serialized = JSON.stringify(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]!]!));
  assert.equal(serialized.includes('beneficiaryRef'), false);
  assert.equal(serialized.includes('참여자 코드'), false);
  assert.equal(serialized.includes('이용계획'), false);
  assert.equal(serialized.includes('동의 commitment'), false);
});
