import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { CaseCoordinator } from '../../src/e2e/caseCoordinator.ts';
import { InMemoryCaseRepository } from '../../src/e2e/inMemoryCaseRepository.ts';
import { createAgentHandlers } from '../../src/http/agentRoutes.ts';
import { createApp } from '../../src/app.ts';
import { ContinuationTokenService } from '../../src/http/continuationToken.ts';

const secret = 'agent-tool-test-secret-that-is-long-enough';
const authorization = `Bearer ${secret}`;

function interpretation(category = 'ASSISTIVE_EQUIPMENT', sku = 'ASSISTIVE_STAND_AID_01') {
  return {
    requestedCategory: category,
    requestedSku: sku,
    quantity: 1,
    substitutionsAllowed: false,
    referencesApprovedPlan: true,
    confidence: 0.97,
    ambiguityReasons: [],
    safeUserSummary: '합성 전화 요청'
  };
}

function harness() {
  const repo = new InMemoryCaseRepository();
  const calls = { payments: 0, orders: 0 };
  const coordinator = new CaseCoordinator(
    repo,
    { async analyzeAudio() { return interpretation(); } },
    { async authorize() { calls.payments += 1; return { paymentAuthorizationId: 'auth_internal_1', paymentReference: 'synthetic_internal_1', authorizedAmountKrw: 380_000 }; } },
    { async submit() { calls.orders += 1; return { providerOrderId: 'SANDBOX-INTERNAL-1' }; } },
    () => 1_785_456_000_000,
    'phone-hmac-test-secret'
  );
  const continuationTokens = new ContinuationTokenService('continuation-token-test-secret-long-enough', () => 1_785_456_000_000);
  return { repo, calls, continuationTokens, handle: createAgentHandlers(secret, coordinator, caseId => repo.get(caseId), continuationTokens) };
}

test('agent bridge rejects missing and incorrect bearer secrets before creating a case', async () => {
  const { repo, handle } = harness();
  for (const candidate of [undefined, 'Bearer wrong']) {
    const response = await handle({
      method: 'POST', pathname: '/internal/agent/begin', body: { callId: 'CA-PRIVATE-1' },
      ...(candidate === undefined ? {} : { authorization: candidate })
    });
    assert.equal(response.status, 401);
  }
  assert.equal((await repo.events('case_unknown')).length, 0);
});

test('agent bridge keeps one caseId from call begin through interpretation and DTMF order', async () => {
  const { calls, handle } = harness();
  const begin = await handle({ method: 'POST', pathname: '/internal/agent/begin', authorization, body: { callId: 'CA-PRIVATE-SUCCESS' } });
  assert.equal(begin.status, 200);
  const begun = begin.body as { caseId: string; state: string };
  assert.equal(begun.state, 'CALL_CONNECTED');
  const repeatedBegin = await handle({ method: 'POST', pathname: '/internal/agent/begin', authorization, body: { callId: 'CA-PRIVATE-SUCCESS' } });
  assert.equal((repeatedBegin.body as { caseId: string }).caseId, begun.caseId);

  const interpreted = await handle({ method: 'POST', pathname: '/internal/agent/interpretation', authorization, body: { caseId: begun.caseId, interpretation: interpretation() } });
  assert.deepEqual({ caseId: (interpreted.body as { caseId: string }).caseId, state: (interpreted.body as { state: string }).state }, { caseId: begun.caseId, state: 'AWAITING_CONFIRMATION' });
  assert.deepEqual(calls, { payments: 0, orders: 0 });

  const confirmed = await handle({ method: 'POST', pathname: '/internal/agent/confirmation', authorization, body: { caseId: begun.caseId, digit: '1' } });
  assert.deepEqual({ caseId: (confirmed.body as { caseId: string }).caseId, state: (confirmed.body as { state: string }).state }, { caseId: begun.caseId, state: 'ORDERED' });
  assert.deepEqual(calls, { payments: 1, orders: 1 });

  const status = await handle({ method: 'GET', pathname: `/internal/agent/status/${begun.caseId}`, authorization });
  const serialized = JSON.stringify(status.body);
  assert.equal(status.status, 200);
  assert.equal(serialized.includes('CA-PRIVATE-SUCCESS'), false);
  assert.equal(serialized.includes('callSidHash'), false);
  assert.equal(serialized.includes('beneficiaryRef'), false);
  assert.equal(serialized.includes('confirmationCommitment'), false);
});

test('authenticated agent issues a short-lived continuation for an existing phone case only', async () => {
  const { handle, continuationTokens } = harness();
  const begin = await handle({ method: 'POST', pathname: '/internal/agent/begin', authorization, body: { callId: 'CA-CONTINUE-1' } });
  const caseId = (begin.body as { caseId: string }).caseId;
  const response = await handle({ method: 'POST', pathname: `/internal/agent/continuation/${caseId}`, authorization });
  assert.equal(response.status, 200);
  const body = response.body as { caseId: string; continuationToken: string; path: string };
  assert.equal(body.caseId, caseId);
  assert.equal(continuationTokens.verify(caseId, body.continuationToken), true);
  assert.match(body.path, /^\/\?v=voice&caseId=/);
  assert.equal((await handle({ method: 'POST', pathname: '/internal/agent/continuation/case_missing', authorization })).status, 404);
});

test('firearm interpretation is policy-blocked in the original case with zero payment and order calls', async () => {
  const { calls, handle } = harness();
  const begin = await handle({ method: 'POST', pathname: '/internal/agent/begin', authorization, body: { callId: 'CA-PRIVATE-FIREARM' } });
  const caseId = (begin.body as { caseId: string }).caseId;
  const blocked = await handle({
    method: 'POST', pathname: '/internal/agent/interpretation', authorization,
    body: { caseId, interpretation: interpretation('FIREARM', 'FIREARM_HANDGUN_01') }
  });
  assert.deepEqual({ caseId: (blocked.body as { caseId: string }).caseId, state: (blocked.body as { state: string }).state }, { caseId, state: 'POLICY_BLOCKED' });
  const afterDigit = await handle({ method: 'POST', pathname: '/internal/agent/confirmation', authorization, body: { caseId, digit: '1' } });
  assert.equal((afterDigit.body as { state: string }).state, 'POLICY_BLOCKED');
  assert.deepEqual(calls, { payments: 0, orders: 0 });
});

test('verbatim firearm request overrides a model-laundered approved SKU and low confidence', async () => {
  const { calls, handle } = harness();
  const begin = await handle({ method: 'POST', pathname: '/internal/agent/begin', authorization, body: { callId: 'CA-PRIVATE-LAUNDERED-FIREARM' } });
  const caseId = (begin.body as { caseId: string }).caseId;
  const laundered = {
    ...interpretation(),
    confidence: 0.8,
    safeUserSummary: '승인된 보조기 요청',
    verbatimUserRequest: '총기 구입해 줘'
  };
  const blocked = await handle({
    method: 'POST', pathname: '/internal/agent/interpretation', authorization,
    body: { caseId, interpretation: laundered }
  });
  assert.equal((blocked.body as { state: string }).state, 'POLICY_BLOCKED');
  assert.deepEqual(calls, { payments: 0, orders: 0 });
});

test('agent bridge validates the structured interpretation at its trust boundary', async () => {
  const { handle } = harness();
  const begin = await handle({ method: 'POST', pathname: '/internal/agent/begin', authorization, body: { callId: 'CA-PRIVATE-BAD-INPUT' } });
  const caseId = (begin.body as { caseId: string }).caseId;
  await assert.rejects(
    handle({ method: 'POST', pathname: '/internal/agent/interpretation', authorization, body: { caseId, interpretation: { ...interpretation(), confidence: 2 } } }),
    /Invalid confidence/
  );
});

test('HTTP app exposes the configured bridge and enforces bearer auth', async (t) => {
  const previous = process.env.AGENT_TOOL_SECRET;
  process.env.AGENT_TOOL_SECRET = secret;
  const server = createApp();
  if (previous === undefined) delete process.env.AGENT_TOOL_SECRET;
  else process.env.AGENT_TOOL_SECRET = previous;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const url = `${base}/internal/agent/begin`;
  const body = JSON.stringify({ callId: 'CA-HTTP-BRIDGE-1' });
  assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 401);
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization }, body });
  assert.equal(response.status, 200);
  const begun = (await response.json()) as { caseId: string; state: string };
  assert.equal(begun.state, 'CALL_CONNECTED');
  const missingSubject = await fetch(`${base}/internal/agent/role-access`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization },
    body: JSON.stringify({ role: 'ops', accessLevel: 'act', caseIds: [begun.caseId] })
  });
  assert.equal(missingSubject.status, 400);
  const unknownScope = await fetch(`${base}/internal/agent/role-access`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization },
    body: JSON.stringify({ role: 'ops', accessLevel: 'act', subjectId: 'ops-unknown-test', caseIds: ['case_missing'] })
  });
  assert.equal(unknownScope.status, 404);
  const malformedAgent = await fetch(`${base}/internal/agent/interpretation`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization },
    body: JSON.stringify({ caseId: begun.caseId, interpretation: { ...interpretation(), confidence: 2 } })
  });
  assert.equal(malformedAgent.status, 400);
  assert.deepEqual(await malformedAgent.json(), { error: 'INVALID_AGENT_INPUT' });
  const continuationResponse = await fetch(`${base}/internal/agent/continuation/${begun.caseId}`, {
    method: 'POST', headers: { authorization }
  });
  assert.equal(continuationResponse.status, 200);
  const continuation = await continuationResponse.json() as { caseId: string; continuationToken: string };
  const denied = await fetch(`${base}/api/food-support/interpret`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caseId: begun.caseId, text: '잡곡 사줘' })
  });
  assert.equal(denied.status, 403);
  const resumed = await fetch(`${base}/api/food-support/interpret`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caseId: begun.caseId, continuationToken: continuation.continuationToken, text: '잡곡 사줘' })
  });
  assert.equal(resumed.status, 200);
  assert.equal(((await resumed.json()) as { caseId: string }).caseId, begun.caseId);

  const issueOps = await fetch(`${base}/internal/agent/role-access`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization },
    body: JSON.stringify({ role: 'ops', accessLevel: 'act', subjectId: 'ops-http-test', caseIds: [begun.caseId] })
  });
  assert.equal(issueOps.status, 200);
  const ops = await issueOps.json() as { accessToken: string };
  const consent = await fetch(`${base}/api/roles/ops/actions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${ops.accessToken}` },
    body: JSON.stringify({ caseId: begun.caseId, action: 'RECORD_CONSENT', expectedRevision: 0, data: { fingerprint: 'b'.repeat(64) } })
  });
  assert.equal(consent.status, 200);
  const issueCaregiver = await fetch(`${base}/internal/agent/role-access`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization },
    body: JSON.stringify({ role: 'caregiver', accessLevel: 'act', subjectId: 'caregiver-http-test', caseIds: [begun.caseId] })
  });
  const caregiver = await issueCaregiver.json() as { accessToken: string };
  const changed = await fetch(`${base}/api/roles/caregiver/actions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${caregiver.accessToken}` },
    body: JSON.stringify({ caseId: begun.caseId, action: 'REQUEST_CHANGE', expectedRevision: 1, data: { changedFields: ['unitPrice', 'shippingFee'] } })
  });
  assert.equal(changed.status, 200);
  assert.equal(((await changed.json()) as any).workflow.consent.status, 'INVALIDATED');

  const journey = await fetch(`${base}/api/food-support/journey?caseId=${encodeURIComponent(begun.caseId)}&continuationToken=${encodeURIComponent(continuation.continuationToken)}`);
  assert.equal(journey.status, 200);
  const journeyBody = await journey.json() as { caseId: string; events: Array<{ source: string; event: string; queryHash?: string }> };
  assert.equal(journeyBody.caseId, begun.caseId);
  assert.deepEqual(new Set(journeyBody.events.map(value => value.source)), new Set(['PHONE', 'WEB', 'ROLE']));
  assert.ok(journeyBody.events.some(value => value.event === 'RECORD_CONSENT'));
  assert.ok(journeyBody.events.some(value => value.event === 'REQUEST_CHANGE'));
  assert.ok(journeyBody.events.some(value => value.queryHash?.startsWith('sha256:')));
  assert.equal(JSON.stringify(journeyBody).includes('잡곡 사줘'), false);
});
