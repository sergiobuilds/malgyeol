import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeliveryEvidenceHandlers,
  InMemoryDeliveryEvidenceRepository
} from '../../src/delivery/evidence.ts';
import { RoleAccessTokenService } from '../../src/http/roleAccess.ts';
import { issueOrderAccess } from '../../src/http/specialOfferOrderRoutes.ts';

const secret = 'delivery-evidence-secret-long-enough';
const now = 1_785_600_000_000;

function tinyPng(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('synthetic-private-image-bytes')
  ]);
}

test('synthetic delivery evidence is explicitly labeled and contains three public demo states', async () => {
  const handler = createDeliveryEvidenceHandlers({
    repository: new InMemoryDeliveryEvidenceRepository(), operatorSecret: secret,
    roleTokens: new RoleAccessTokenService('r'.repeat(32), () => now), now: () => now
  });
  const result = await handler({ method: 'GET', pathname: '/api/delivery-evidence/demo', searchParams: new URLSearchParams() });
  assert.equal(result.status, 200);
  const body = result.body as { synthetic: boolean; evidence: Array<{ synthetic: boolean; source: string; imageUrl: string }> };
  assert.equal(body.synthetic, true);
  assert.equal(body.evidence.length, 3);
  assert.ok(body.evidence.every(value => value.synthetic && value.source === 'SYNTHETIC_DEMO' && value.imageUrl.startsWith('/assets/delivery-evidence/')));
});

test('private upload binds case and order access, validates image and requires scoped ops review', async () => {
  const repository = new InMemoryDeliveryEvidenceRepository();
  const roleTokens = new RoleAccessTokenService('r'.repeat(32), () => now);
  const handler = createDeliveryEvidenceHandlers({ repository, operatorSecret: secret, roleTokens, now: () => now });
  const orderAccess = issueOrderAccess(secret, 'case_food_1', 'order_100', now + 60_000);
  const body = {
    caseId: 'case_food_1', orderId: 'order_100', orderAccessToken: orderAccess.token,
    issueType: 'DAMAGED', mimeType: 'image/png', dataBase64: tinyPng().toString('base64')
  };

  const unauthorized = await handler({ method: 'POST', pathname: '/api/delivery-evidence/upload', searchParams: new URLSearchParams(), body: { ...body, orderAccessToken: `${orderAccess.token}x` } });
  assert.equal(unauthorized.status, 401);
  const uploaded = await handler({ method: 'POST', pathname: '/api/delivery-evidence/upload', searchParams: new URLSearchParams(), body });
  assert.equal(uploaded.status, 201);
  const evidence = uploaded.body as { evidenceId: string; synthetic: boolean; source: string; imageDataUrl: string; reviewState: string };
  assert.equal(evidence.synthetic, false);
  assert.equal(evidence.source, 'USER_UPLOAD');
  assert.equal(evidence.reviewState, 'PENDING');
  assert.ok(evidence.imageDataUrl.startsWith('data:image/png;base64,'));

  const read = roleTokens.issue('ops', ['case_food_1'], 60_000, 'read', 'ops-reader');
  const listed = await handler({
    method: 'GET', pathname: '/api/delivery-evidence/list', authorization: `Bearer ${read.token}`,
    searchParams: new URLSearchParams({ caseId: 'case_food_1' })
  });
  assert.equal((listed.body as { evidence: unknown[] }).evidence.length, 1);
  const readReview = await handler({
    method: 'POST', pathname: '/api/delivery-evidence/review', authorization: `Bearer ${read.token}`,
    searchParams: new URLSearchParams(), body: { caseId: 'case_food_1', evidenceId: evidence.evidenceId, reviewState: 'ACCEPTED' }
  });
  assert.equal(readReview.status, 403);

  const wrongScope = roleTokens.issue('ops', ['case_other'], 60_000, 'act', 'ops-wrong');
  assert.equal((await handler({
    method: 'POST', pathname: '/api/delivery-evidence/review', authorization: `Bearer ${wrongScope.token}`,
    searchParams: new URLSearchParams(), body: { caseId: 'case_food_1', evidenceId: evidence.evidenceId, reviewState: 'ACCEPTED' }
  })).status, 403);

  const act = roleTokens.issue('ops', ['case_food_1'], 60_000, 'act', 'ops-reviewer');
  const reviewed = await handler({
    method: 'POST', pathname: '/api/delivery-evidence/review', authorization: `Bearer ${act.token}`,
    searchParams: new URLSearchParams(), body: { caseId: 'case_food_1', evidenceId: evidence.evidenceId, reviewState: 'ACCEPTED' }
  });
  assert.equal((reviewed.body as { reviewState: string }).reviewState, 'ACCEPTED');
  assert.equal(JSON.stringify(reviewed.body).includes('ops-reviewer'), false);
});

test('private upload rejects MIME spoofing and oversized payloads', async () => {
  const handler = createDeliveryEvidenceHandlers({
    repository: new InMemoryDeliveryEvidenceRepository(), operatorSecret: secret,
    roleTokens: new RoleAccessTokenService('r'.repeat(32), () => now), now: () => now
  });
  const access = issueOrderAccess(secret, 'case_food_2', 'order_200', now + 60_000);
  await assert.rejects(handler({
    method: 'POST', pathname: '/api/delivery-evidence/upload', searchParams: new URLSearchParams(),
    body: { caseId: 'case_food_2', orderId: 'order_200', orderAccessToken: access.token, issueType: 'WRONG_ITEM', mimeType: 'image/jpeg', dataBase64: tinyPng().toString('base64') }
  }), /do not match/);
  await assert.rejects(handler({
    method: 'POST', pathname: '/api/delivery-evidence/upload', searchParams: new URLSearchParams(),
    body: { caseId: 'case_food_2', orderId: 'order_200', orderAccessToken: access.token, issueType: 'WRONG_ITEM', mimeType: 'image/png', dataBase64: Buffer.alloc(600_001).toString('base64') }
  }), /between 16 and 600000/);
});
