import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPublicCase, projectPublicEvent } from '../../src/http/publicProjection.ts';

const record = {
  caseId: 'case_public_1', callSidHash: 'secret-hash', beneficiaryRef: 'P-2026-0031',
  programId: 'kr-disability-personal-budget-demo', planId: 'plan-stand-aid', state: 'ORDERED' as const,
  candidate: {
    caseId: 'case_public_1', sku: 'ASSISTIVE_STAND_AID_01', category: 'ASSISTIVE_EQUIPMENT', quantity: 1,
    merchantId: 'DEMO_ACCESS_STORE', unitPriceKrw: 380_000, totalPriceKrw: 380_000, programAmountKrw: 380_000,
    substitutionsAllowed: false, confidence: 0.97, ambiguityReasons: [], readbackSentence: '기립 보조기 1개'
  },
  policySnapshotHash: 'a'.repeat(64), confirmationCommitment: 'b'.repeat(64),
  paymentAuthorizationId: 'auth_1', paymentReference: 'synthetic_reference_1', authorizedAmountKrw: 380_000,
  providerOrderId: 'DEMO-ORDER-1', createdAt: 1000, updatedAt: 2000
};

test('public case projection excludes Twilio and beneficiary references from default view', () => {
  const projected = projectPublicCase(record, false);
  assert.equal(projected.currentProductProgram, '2026 농식품바우처 호환 식품지원');
  assert.equal(projected.legacyEvidence, true);
  assert.match(projected.programName, /현행 식품지원 아님/);
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes('secret-hash'), false);
  assert.equal(serialized.includes('P-2026-0031'), false);
  assert.equal(serialized.includes('synthetic_reference_1'), false);
  assert.equal(projected.programAmountKrw, 380_000);
  assert.equal(projected.state, 'ORDERED');
});

test('technical proof remains opt-in and labels the simulated authorization separately', () => {
  const projected = projectPublicCase(record, true);
  assert.equal(projected.technicalProof?.paymentReference, 'synthetic_reference_1');
  assert.equal(projected.technicalProof?.authorizedAmountKrw, 380_000);
  assert.match(projected.technicalProof?.disclaimer ?? '', /실제 정부자금.*아님/);
});

test('public event projection exposes state and failed rules without internal event data', () => {
  const projected = projectPublicEvent({
    caseId: 'case_public_1', sequence: 4, state: 'POLICY_BLOCKED', at: 2000,
    data: {
      beneficiaryRef: 'P-2026-0031',
      confirmationCommitment: 'secret-confirmation',
      policy: { checks: [{ rule: 'SKU_ALLOWED', pass: false }, { rule: 'BALANCE_AVAILABLE', pass: true }] }
    }
  });
  assert.deepEqual(projected.failedPolicyRules, ['SKU_ALLOWED']);
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes('P-2026-0031'), false);
  assert.equal(serialized.includes('secret-confirmation'), false);
});
