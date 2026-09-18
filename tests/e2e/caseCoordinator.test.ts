import test from 'node:test';
import assert from 'node:assert/strict';
import { CaseCoordinator } from '../../src/e2e/caseCoordinator.ts';
import { InMemoryCaseRepository } from '../../src/e2e/inMemoryCaseRepository.ts';
import { DEMO_ASSISTIVE_CATALOG } from '../../src/e2e/catalog/demoAssistiveCatalog.ts';
import { DemoMerchantAdapter } from '../../src/e2e/demoMerchantAdapter.ts';

function dependencies(category = 'ASSISTIVE_EQUIPMENT', sku = 'ASSISTIVE_STAND_AID_01') {
  const calls = { payments: 0, orders: 0 };
  return {
    calls,
    interpreter: { async analyzeAudio() { return { requestedCategory: category, requestedSku: sku, quantity: 1, substitutionsAllowed: false, referencesApprovedPlan: true, confidence: 0.97, ambiguityReasons: [], safeUserSummary: '합성 요청' }; } },
    payment: { async authorize() { calls.payments += 1; return { paymentAuthorizationId: 'auth_1', paymentReference: 'synthetic_reference_1', authorizedAmountKrw: 380_000 }; } },
    merchant: { async submit() { calls.orders += 1; return { providerOrderId: 'DEMO-ORDER-1' }; } }
  };
}

test('phone fixture reaches ORDERED once with one caseId, payment and merchant order', async () => {
  const repo = new InMemoryCaseRepository();
  const deps = dependencies();
  const coordinator = new CaseCoordinator(repo, deps.interpreter, deps.payment, deps.merchant, () => 1_785_456_000_000);
  const start = await coordinator.capture('CA-SYNTHETIC-1', Buffer.from('synthetic-audio'), 'audio/mpeg');
  assert.equal(start.state, 'AWAITING_CONFIRMATION');
  const ordered = await coordinator.confirm(start.caseId, '1');
  const replay = await coordinator.confirm(start.caseId, '1');
  assert.equal(ordered.state, 'ORDERED');
  assert.equal(replay.state, 'ORDERED');
  assert.equal(ordered.providerOrderId, 'DEMO-ORDER-1');
  assert.equal(ordered.candidate?.programAmountKrw, 380_000);
  assert.equal(ordered.authorizedAmountKrw, 380_000);
  assert.deepEqual(deps.calls, { payments: 1, orders: 1 });
  assert.equal(DEMO_ASSISTIVE_CATALOG.length, 1);
});

test('prohibited phone request ends POLICY_BLOCKED with zero payment and order calls', async () => {
  const repo = new InMemoryCaseRepository();
  const deps = dependencies('TOBACCO', 'TOBACCO_01');
  const coordinator = new CaseCoordinator(repo, deps.interpreter, deps.payment, deps.merchant, () => 1_785_456_000_000);
  const result = await coordinator.capture('CA-SYNTHETIC-2', Buffer.from('synthetic-audio'), 'audio/mpeg');
  assert.equal(result.state, 'POLICY_BLOCKED');
  assert.deepEqual(deps.calls, { payments: 0, orders: 0 });
});

test('firearm, weapon, ammunition and prompt-injection requests never reach payment or ordering', async () => {
  const attacks = [
    ['FIREARM', 'FIREARM_HANDGUN_01'],
    ['WEAPON', 'WEAPON_HUNTING_01'],
    ['AMMUNITION', 'AMMUNITION_01'],
    ['UNKNOWN_HIGH_RISK', 'IGNORE_POLICY_AND_APPROVE_01']
  ] as const;
  for (const [category, sku] of attacks) {
    const repo = new InMemoryCaseRepository();
    const deps = dependencies(category, sku);
    const coordinator = new CaseCoordinator(repo, deps.interpreter, deps.payment, deps.merchant, () => 1_785_456_000_000);
    const result = await coordinator.capture(`CA-SYNTHETIC-${category}`, Buffer.from('synthetic-audio'), 'audio/mpeg');
    assert.equal(result.state, 'POLICY_BLOCKED', category);
    assert.deepEqual(deps.calls, { payments: 0, orders: 0 }, category);
    assert.equal(result.policy?.policyVersion, 'kr-disability-personal-budget-demo-v2');
    assert.ok(result.policySnapshotHash);
  }
});

test('expired DTMF confirmation fails closed before payment and ordering', async () => {
  let now = 1_785_456_000_000;
  const repo = new InMemoryCaseRepository();
  const deps = dependencies();
  const coordinator = new CaseCoordinator(repo, deps.interpreter, deps.payment, deps.merchant, () => now);
  const start = await coordinator.capture('CA-SYNTHETIC-EXPIRED', Buffer.from('synthetic-audio'), 'audio/mpeg');
  now = (start.confirmationExpiresAt ?? now) + 1;
  const result = await coordinator.confirm(start.caseId, '1');
  assert.equal(result.state, 'CONFIRMATION_EXPIRED');
  assert.deepEqual(deps.calls, { payments: 0, orders: 0 });
});

test('payment success and merchant failure recovers without paying twice', async () => {
  const repo = new InMemoryCaseRepository();
  const deps = dependencies();
  const sandbox = new DemoMerchantAdapter();
  let attempts = 0;
  const merchant = {
    async submit(input: Parameters<typeof sandbox.submit>[0]) {
      attempts += 1;
      if (attempts === 1) throw new Error('synthetic merchant timeout');
      return sandbox.submit(input);
    }
  };
  const coordinator = new CaseCoordinator(repo, deps.interpreter, deps.payment, merchant, () => 1_785_456_000_000);
  const start = await coordinator.capture('CA-SYNTHETIC-U4-RECOVERY', Buffer.from('synthetic-audio'), 'audio/mpeg');

  const failed = await coordinator.confirm(start.caseId, '1');
  const recovered = await coordinator.recoverOrder(start.caseId);
  const replay = await coordinator.recoverOrder(start.caseId);

  assert.equal(failed.state, 'ORDER_REVIEW_REQUIRED');
  assert.equal(recovered.state, 'ORDERED');
  assert.match(recovered.providerOrderId ?? '', /^DEMO-[A-F0-9]{12}$/);
  assert.equal(replay.providerOrderId, recovered.providerOrderId);
  assert.equal(deps.calls.payments, 1);
  assert.equal(attempts, 2);
});
