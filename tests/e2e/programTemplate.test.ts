import test from 'node:test';
import assert from 'node:assert/strict';
import { DISABILITY_PERSONAL_BUDGET_PROGRAM, SYNTHETIC_ENROLLMENT } from '../../src/e2e/programs/disabilityPersonalBudget.ts';
import { DEMO_ASSISTIVE_CATALOG } from '../../src/e2e/catalog/demoAssistiveCatalog.ts';

test('disability personal-budget fixture keeps approved KRW plan separate from proof payment', () => {
  assert.equal(DISABILITY_PERSONAL_BUDGET_PROGRAM.officialName, '2026 장애인 개인예산제 3차 시범사업 재현');
  assert.equal(SYNTHETIC_ENROLLMENT.monthlyLimitKrw, 420_000);
  assert.equal(SYNTHETIC_ENROLLMENT.remainingKrw, 420_000);
  assert.equal(SYNTHETIC_ENROLLMENT.planRevision, 1);
  assert.deepEqual(SYNTHETIC_ENROLLMENT.approvedSkus, ['ASSISTIVE_STAND_AID_01']);
  assert.deepEqual(SYNTHETIC_ENROLLMENT.approvedMerchants, ['DEMO_ACCESS_STORE']);
  assert.ok(DISABILITY_PERSONAL_BUDGET_PROGRAM.prohibitedCategories.includes('TOBACCO'));
  assert.equal(DEMO_ASSISTIVE_CATALOG[0]?.unitPriceKrw, 380_000);
  assert.equal(DEMO_ASSISTIVE_CATALOG[0]?.settlementProofBaseUnits, 1_000_000);
});
