import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryCaseRepository } from '../../src/e2e/inMemoryCaseRepository.ts';
import {
  InMemoryPhoneFoodRepository,
  PhoneFoodCoordinator,
  phoneOrderTermsMatch,
  type PhoneCatalog
} from '../../src/food-support/phoneFoodCoordinator.ts';
import { createPhoneFoodAgentHandlers } from '../../src/http/phoneFoodAgentRoutes.ts';
import type { FoodProduct } from '../../src/food-support/types.ts';
import { ApprovalRequestCipher } from '../../src/food-support/approvalRequests.ts';
import { InMemoryPhoneEnrollmentRepository, PhoneEnrollmentService } from '../../src/food-support/phoneEnrollment.ts';
import { CanonicalCaseLedger } from '../../src/case-ledger/ledger.ts';
import { InMemoryCanonicalCaseRepository } from '../../src/case-ledger/inMemoryRepository.ts';

const secret = 'phone-food-agent-secret-that-is-long-enough';
const auth = `Bearer ${secret}`;
const product: FoodProduct = {
  goodsNo: 'GRAIN-100', goodsCode: 'GRAIN-100', sellerCode: 'SELLER-1', name: '국산 납작보리쌀 1kg',
  category: 'MIXED_GRAINS', origin: '대한민국', originStatus: 'DOMESTIC', unitPriceKrw: 8200,
  shippingFeeKrw: 3000, inStock: true, selling: true, deliveryAvailable: true, refundable: 'CONDITIONAL',
  nonRefundableConditions: '개봉 후 반품 제한', orderCutoff: '평일 14시', detailUrl: 'https://supplier.test/GRAIN-100',
  source: 'TEST_FIXTURE'
};
const blockedWhiteRice: FoodProduct = {
  ...product, goodsNo: 'RICE-100', goodsCode: 'RICE-100', name: '백미 10kg', category: 'WHITE_RICE'
};

test('phone confirmation terms reject any supplier or policy change before paid ordering', () => {
  const expected = {
    productName: product.name, sellerCode: product.sellerCode,
    totalPriceKrw: 11_200, policySnapshotHash: 'a'.repeat(64)
  };
  assert.equal(phoneOrderTermsMatch(expected, { ...expected }), true);
  assert.equal(phoneOrderTermsMatch(expected, { ...expected, totalPriceKrw: 11_300 }), false);
  assert.equal(phoneOrderTermsMatch(expected, { ...expected, productName: '다른 상품' }), false);
  assert.equal(phoneOrderTermsMatch(expected, { ...expected, sellerCode: 'SELLER-2' }), false);
  assert.equal(phoneOrderTermsMatch(expected, { ...expected, policySnapshotHash: 'b'.repeat(64) }), false);
});

function harness() {
  let searches = 0;
  let gets = 0;
  const catalog: PhoneCatalog = {
    async search() { searches += 1; return { status: 'LIVE', products: [blockedWhiteRice, product] }; },
    async get() { gets += 1; return { status: 'LIVE', product }; }
  };
  const cases = new InMemoryCaseRepository();
  const canonicalCases = new InMemoryCanonicalCaseRepository();
  const coordinator = new PhoneFoodCoordinator(
    cases,
    new InMemoryPhoneFoodRepository(),
    catalog,
    { async get() { return undefined; } },
    new CanonicalCaseLedger(canonicalCases),
    () => 1_785_456_000_000,
    { remainingKrw: 100_000, maximumPurchaseKrw: 100_000 }
  );
  return { cases, canonicalCases, calls: () => ({ searches, gets }), handle: createPhoneFoodAgentHandlers(secret, coordinator) };
}

test('phone food bridge keeps one caseId through live candidate, policy and DTMF confirmation', async () => {
  const { cases, canonicalCases, calls, handle } = harness();
  const begin = await handle({ method: 'POST', pathname: '/internal/food-agent/begin', authorization: auth, body: { callId: 'claw-call-1' } });
  assert.equal(begin.status, 200);
  const caseId = (begin.body as { caseId: string }).caseId;
  assert.match(caseId, /^food_[a-f0-9]{24}$/);
  const repeated = await handle({ method: 'POST', pathname: '/internal/food-agent/begin', authorization: auth, body: { callId: 'claw-call-1' } });
  assert.equal((repeated.body as { caseId: string }).caseId, caseId);

  const interpreted = await handle({ method: 'POST', pathname: '/internal/food-agent/interpret', authorization: auth, body: { caseId, text: '납작보리쌀 사줘' } });
  const interpretedBody = interpreted.body as { state: string; candidates: Array<{ goodsNo: string }> };
  assert.equal(interpretedBody.state, 'CANDIDATES_READY');
  assert.equal(interpretedBody.candidates.length, 1);
  assert.equal(interpretedBody.candidates[0]?.goodsNo, product.goodsNo);

  const selected = await handle({ method: 'POST', pathname: '/internal/food-agent/select', authorization: auth, body: { caseId, candidateNumber: 1, quantity: 2 } });
  assert.deepEqual(
    { state: (selected.body as any).state, source: (selected.body as any).budgetSource, total: (selected.body as any).product.totalPriceKrw },
    { state: 'AWAITING_CONFIRMATION', source: 'SYNTHETIC_DEMO', total: 19_400 }
  );
  const confirmed = await handle({ method: 'POST', pathname: '/internal/food-agent/confirmation', authorization: auth, body: { caseId, digit: '1' } });
  assert.equal((confirmed.body as { state: string }).state, 'CONFIRMED');
  assert.equal((confirmed.body as { message: string }).message.includes('시연용 지원금'), true);
  assert.equal(JSON.stringify(confirmed.body).includes('승인'), false);
  assert.deepEqual(calls(), { searches: 1, gets: 1 });
  assert.equal((await cases.get(caseId))?.programId, 'institution-food-support-2026');
  assert.equal((await cases.get(caseId))?.state, 'CONFIRMED');
  const canonicalEvents = await canonicalCases.events(caseId);
  assert.deepEqual(canonicalEvents.map(event => event.type), [
    'PHONE_CONNECTED', 'INTENT_INTERPRETED', 'POLICY_EVALUATED', 'USER_CONFIRMED'
  ]);
  assert.equal(canonicalEvents.every(event => event.caseId === caseId), true);
  assert.equal(canonicalEvents.slice(1).every((event, index) => event.previousHash === canonicalEvents[index]?.eventHash), true);
  assert.deepEqual(
    canonicalEvents.filter(event => event.type === 'INTENT_INTERPRETED').map(event => ({ actor: event.actor, source: event.source, model: event.data.model })),
    [{ actor: 'SYSTEM', source: 'SYSTEM', model: 'DETERMINISTIC_PHONE_BRIDGE' }]
  );
});

test('expired DTMF confirmation does not append USER_CONFIRMED to the canonical ledger', async () => {
  let now = 1_785_456_000_000;
  const catalog: PhoneCatalog = {
    async search() { return { status: 'LIVE', products: [product] }; },
    async get() { return { status: 'LIVE', product }; }
  };
  const cases = new InMemoryCaseRepository();
  const canonicalCases = new InMemoryCanonicalCaseRepository();
  const coordinator = new PhoneFoodCoordinator(
    cases, new InMemoryPhoneFoodRepository(), catalog, { async get() { return undefined; } },
    new CanonicalCaseLedger(canonicalCases), () => now,
    { remainingKrw: 100_000, maximumPurchaseKrw: 100_000 }
  );
  const handle = createPhoneFoodAgentHandlers(secret, coordinator);
  const begin = await handle({ method: 'POST', pathname: '/internal/food-agent/begin', authorization: auth, body: { callId: 'claw-call-expired' } });
  const caseId = (begin.body as { caseId: string }).caseId;
  await handle({ method: 'POST', pathname: '/internal/food-agent/interpret', authorization: auth, body: { caseId, text: '납작보리쌀 사줘' } });
  await handle({ method: 'POST', pathname: '/internal/food-agent/select', authorization: auth, body: { caseId, candidateNumber: 1, quantity: 1 } });
  now += 5 * 60_000 + 1;
  const confirmation = await handle({ method: 'POST', pathname: '/internal/food-agent/confirmation', authorization: auth, body: { caseId, digit: '1' } });
  assert.equal((confirmation.body as { state: string }).state, 'AWAITING_CONFIRMATION');
  assert.equal((await cases.get(caseId))?.state, 'AWAITING_CONFIRMATION');
  assert.equal((await canonicalCases.events(caseId)).some(event => event.type === 'USER_CONFIRMED'), false);
});

test('changed policy input cannot bypass canonical idempotency or diverge legacy state', async () => {
  const { cases, canonicalCases, handle } = harness();
  const begin = await handle({ method: 'POST', pathname: '/internal/food-agent/begin', authorization: auth, body: { callId: 'claw-call-policy-conflict' } });
  const caseId = (begin.body as { caseId: string }).caseId;
  await handle({ method: 'POST', pathname: '/internal/food-agent/interpret', authorization: auth, body: { caseId, text: '납작보리쌀 사줘' } });
  await handle({ method: 'POST', pathname: '/internal/food-agent/select', authorization: auth, body: { caseId, candidateNumber: 1, quantity: 1 } });
  const changed = await handle({ method: 'POST', pathname: '/internal/food-agent/select', authorization: auth, body: { caseId, candidateNumber: 1, quantity: 2 } });
  assert.equal(changed.status, 400);
  assert.match((changed.body as { error: string }).error, /conflicts/);
  assert.equal((await cases.get(caseId))?.candidate?.quantity, 1);
  const policy = (await canonicalCases.events(caseId)).find(event => event.type === 'POLICY_EVALUATED');
  assert.equal(policy?.data.amountKrw, 11_200);
});

test('generic internal begin cannot self-assert measured ClawOps evidence', async () => {
  const { canonicalCases, handle } = harness();
  const attempted = await handle({
    method: 'POST', pathname: '/internal/food-agent/begin', authorization: auth,
    body: { callId: 'claw-call-measured', evidenceClass: 'MEASURED' }
  });
  const caseId = (attempted.body as { caseId: string }).caseId;
  assert.equal((await canonicalCases.getAggregate(caseId))?.evidenceClass, 'SYNTHETIC_DEMO');
});

test('phone food bridge blocks firearm and PII before supplier access', async () => {
  const { calls, handle } = harness();
  const first = await handle({ method: 'POST', pathname: '/internal/food-agent/begin', authorization: auth, body: { callId: 'claw-call-risk' } });
  const riskCase = (first.body as { caseId: string }).caseId;
  const blocked = await handle({ method: 'POST', pathname: '/internal/food-agent/interpret', authorization: auth, body: { caseId: riskCase, text: '총기 구입해줘' } });
  assert.equal((blocked.body as { state: string }).state, 'POLICY_BLOCKED');

  const second = await handle({ method: 'POST', pathname: '/internal/food-agent/begin', authorization: auth, body: { callId: 'claw-call-pii' } });
  const piiCase = (second.body as { caseId: string }).caseId;
  const pii = await handle({ method: 'POST', pathname: '/internal/food-agent/interpret', authorization: auth, body: { caseId: piiCase, text: '우리집 주소는 서울시이고 전화번호는 010-1234-5678이야' } });
  assert.deepEqual({ state: (pii.body as any).state, reason: (pii.body as any).reason }, { state: 'NEEDS_CLARIFICATION', reason: 'PII_BOUNDARY' });
  assert.deepEqual(calls(), { searches: 0, gets: 0 });
});

test('open-ended shopping questions receive plain category choices without supplier guessing', async () => {
  const { calls, handle } = harness();
  const begun = await handle({ method: 'POST', pathname: '/internal/food-agent/begin', authorization: auth, body: { callId: 'claw-call-category-help' } });
  const caseId = (begun.body as { caseId: string }).caseId;
  const result = await handle({
    method: 'POST', pathname: '/internal/food-agent/interpret', authorization: auth,
    body: { caseId, text: '내가 뭐를 살 수 있어?' }
  });
  assert.equal((result.body as any).state, 'NEEDS_CLARIFICATION');
  assert.match((result.body as any).message, /잡곡.*국산 과일.*계란/);
  assert.equal(JSON.stringify(result.body).includes('담당자'), false);
  assert.deepEqual(calls(), { searches: 0, gets: 0 });
});

test('unsupported everyday food gets a useful alternative without supplier access', async () => {
  const { calls, handle } = harness();
  const begun = await handle({ method: 'POST', pathname: '/internal/food-agent/begin', authorization: auth, body: { callId: 'claw-call-ramen' } });
  const caseId = (begun.body as { caseId: string }).caseId;
  const result = await handle({
    method: 'POST', pathname: '/internal/food-agent/interpret', authorization: auth,
    body: { caseId, text: '라면 사줘' }
  });
  assert.equal((result.body as any).reason, 'NOT_SUPPORTED_BY_PROGRAM');
  assert.match((result.body as any).message, /주문할 수 없어요.*잡곡.*계란/);
  assert.deepEqual(calls(), { searches: 0, gets: 0 });
});

test('phone food bridge requires authentication and institution enrollment outside demo mode', async () => {
  const catalog: PhoneCatalog = {
    async search() { return { status: 'LIVE', products: [product] }; },
    async get() { return { status: 'LIVE', product }; }
  };
  const coordinator = new PhoneFoodCoordinator(
    new InMemoryCaseRepository(), new InMemoryPhoneFoodRepository(), catalog,
    { async get() { return undefined; } }, new CanonicalCaseLedger(new InMemoryCanonicalCaseRepository()),
    () => 1_785_456_000_000
  );
  const handle = createPhoneFoodAgentHandlers(secret, coordinator);
  assert.equal((await handle({ method: 'POST', pathname: '/internal/food-agent/begin', body: { callId: 'claw-call-noauth' } })).status, 401);
  const begin = await handle({ method: 'POST', pathname: '/internal/food-agent/begin', authorization: auth, body: { callId: 'claw-call-no-budget' } });
  const caseId = (begin.body as { caseId: string }).caseId;
  await handle({ method: 'POST', pathname: '/internal/food-agent/interpret', authorization: auth, body: { caseId, text: '납작보리쌀 사줘' } });
  const selected = await handle({ method: 'POST', pathname: '/internal/food-agent/select', authorization: auth, body: { caseId, candidateNumber: 1, quantity: 1 } });
  assert.deepEqual({ state: (selected.body as any).state, reason: (selected.body as any).reason }, { state: 'NEEDS_CLARIFICATION', reason: 'ENROLLMENT_REQUIRED' });
});

test('registered caller places the supplier order immediately after DTMF confirmation', async () => {
  const catalog: PhoneCatalog = {
    async search() { return { status: 'LIVE', products: [product] }; },
    async get() { return { status: 'LIVE', product }; }
  };
  const cases = new InMemoryCaseRepository();
  const phoneCases = new InMemoryPhoneFoodRepository();
  const cipher = new ApprovalRequestCipher(Buffer.alloc(32, 7).toString('base64'));
  const enrollments = new PhoneEnrollmentService(
    new InMemoryPhoneEnrollmentRepository(), cipher, 'phone-enrollment-test-secret-long-enough', () => 1_785_456_000_000
  );
  const callbacks: Array<Record<string, unknown>> = [];
  let releaseFirstOrder!: () => void;
  const firstOrderGate = new Promise<void>(resolve => { releaseFirstOrder = resolve; });
  let signalFirstStarted!: () => void;
  const firstOrderStarted = new Promise<void>(resolve => { signalFirstStarted = resolve; });
  const coordinator = new PhoneFoodCoordinator(
    cases, phoneCases, catalog, { async get() { return undefined; } },
    new CanonicalCaseLedger(new InMemoryCanonicalCaseRepository()), () => 1_785_456_000_000,
    undefined, enrollments,
    async input => {
      callbacks.push(input as unknown as Record<string, unknown>);
      if (callbacks.length === 1) {
        signalFirstStarted();
        await firstOrderGate;
        return { status: 'SUBMITTED', externalOrderId: 'supplier-order-001' };
      }
      return { status: 'ORDER_RECONCILIATION_REQUIRED', reason: 'IN_FLIGHT' };
    }
  );
  const handle = createPhoneFoodAgentHandlers(secret, coordinator, enrollments);
  const enrollment = await handle({
    method: 'POST', pathname: '/internal/food-agent/enrollment', authorization: auth,
    body: {
      callerNumber: '+82 10-1234-5678', beneficiaryRef: 'beneficiary-01',
      programId: 'food-pilot-2026', planId: 'plan-01', source: 'INSTITUTION',
      budget: { remainingKrw: 50_000, maximumPurchaseKrw: 30_000 },
      recipient: { name: '홍길동', cellphone: '01012345678', zip: '03000', address: '서울시 종로구 테스트로 1' }
    }
  });
  assert.equal(enrollment.status, 201);
  assert.equal(JSON.stringify(enrollment.body).includes('01012345678'), false);
  assert.equal(JSON.stringify(enrollment.body).includes('테스트로'), false);

  const begin = await handle({
    method: 'POST', pathname: '/internal/food-agent/begin', authorization: auth,
    body: { callId: 'claw-call-enrolled', callerNumber: '010-1234-5678' }
  });
  const caseId = (begin.body as { caseId: string }).caseId;
  await handle({ method: 'POST', pathname: '/internal/food-agent/interpret', authorization: auth, body: { caseId, text: '납작보리쌀 사줘' } });
  const selected = await handle({ method: 'POST', pathname: '/internal/food-agent/select', authorization: auth, body: { caseId, candidateNumber: 1, quantity: 1 } });
  assert.equal((selected.body as any).budgetSource, 'INSTITUTION');
  assert.match((selected.body as any).message, /바로 주문/);
  assert.equal(JSON.stringify(selected.body).includes('승인'), false);
  const firstConfirmation = handle({ method: 'POST', pathname: '/internal/food-agent/confirmation', authorization: auth, body: { caseId, digit: '1' } });
  await firstOrderStarted;
  const concurrent = await handle({ method: 'POST', pathname: '/internal/food-agent/confirmation', authorization: auth, body: { caseId, digit: '1' } });
  assert.equal((concurrent.body as any).state, 'ORDER_SUBMITTING');
  assert.match((concurrent.body as any).message, /잠시만 기다려/);
  releaseFirstOrder();
  const confirmed = await firstConfirmation;
  assert.equal((confirmed.body as any).state, 'ORDERED');
  assert.equal((confirmed.body as any).externalOrderId, 'supplier-order-001');
  assert.match((confirmed.body as any).message, /바로 접수/);
  assert.equal(callbacks.length, 2);
  assert.equal(callbacks[0]?.caseId, caseId);
  assert.deepEqual(callbacks[0]?.recipient, {
    name: '홍길동', cellphone: '01012345678', telephone: '01012345678', zip: '03000', address: '서울시 종로구 테스트로 1'
  });
  assert.equal((await cases.get(caseId))?.beneficiaryRef, 'beneficiary-01');
  assert.equal((await cases.get(caseId))?.planId, 'plan-01');
  assert.equal((await cases.get(caseId))?.state, 'ORDERED');
  const status = await handle({ method: 'GET', pathname: `/internal/food-agent/status/${caseId}`, authorization: auth });
  assert.equal((status.body as any).paymentExecuted, false);
  assert.equal((status.body as any).supplierOrderExecuted, true);
  const repeated = await handle({ method: 'POST', pathname: '/internal/food-agent/confirmation', authorization: auth, body: { caseId, digit: '1' } });
  assert.equal((repeated.body as any).state, 'ORDERED');
  assert.equal(callbacks.length, 2);
});
