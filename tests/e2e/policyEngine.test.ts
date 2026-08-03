import test from 'node:test';
import assert from 'node:assert/strict';
import { detectHighRiskCategory, evaluatePurchasePolicy } from '../../src/e2e/policyEngine.ts';
import { DISABILITY_PERSONAL_BUDGET_PROGRAM, SYNTHETIC_ENROLLMENT } from '../../src/e2e/programs/disabilityPersonalBudget.ts';
import { DEMO_ASSISTIVE_CATALOG } from '../../src/e2e/catalog/demoAssistiveCatalog.ts';

const candidate = {
  caseId: 'case_policy_001', sku: 'ASSISTIVE_STAND_AID_01', category: 'ASSISTIVE_EQUIPMENT',
  quantity: 1, merchantId: 'DEMO_ACCESS_STORE', unitPriceKrw: 380_000, totalPriceKrw: 380_000,
  programAmountKrw: 380_000,
  substitutionsAllowed: false, confidence: 0.97, ambiguityReasons: [],
  readbackSentence: '승인된 기립 보조기 1개, 총 380000원, 등록된 배송지로 주문합니다.'
};

test('policy approves an active current-plan purchase deterministically', () => {
  const input = {
    program: DISABILITY_PERSONAL_BUDGET_PROGRAM, enrollment: SYNTHETIC_ENROLLMENT,
    candidate, catalogItem: DEMO_ASSISTIVE_CATALOG[0]!, now: Date.parse('2026-07-31T00:00:00Z'),
    expectedPlanRevision: 1, duplicate: false
  };
  const a = evaluatePurchasePolicy(input);
  const b = evaluatePurchasePolicy(input);
  assert.equal(a.decision, 'APPROVED');
  assert.equal(a.policySnapshotHash, b.policySnapshotHash);
  assert.equal(a.checks.every(check => check.pass), true);
});

test('policy blocks prohibited and out-of-plan items before payment', () => {
  const blocked = evaluatePurchasePolicy({
    program: DISABILITY_PERSONAL_BUDGET_PROGRAM, enrollment: SYNTHETIC_ENROLLMENT,
    candidate: { ...candidate, sku: 'TOBACCO_01', category: 'TOBACCO' },
    catalogItem: { ...DEMO_ASSISTIVE_CATALOG[0]!, sku: 'TOBACCO_01', category: 'TOBACCO' },
    now: Date.parse('2026-07-31T00:00:00Z'), expectedPlanRevision: 1, duplicate: false
  });
  assert.equal(blocked.decision, 'BLOCKED');
  assert.ok(blocked.checks.some(check => check.rule === 'CATEGORY_NOT_PROHIBITED' && !check.pass));
  assert.ok(blocked.checks.some(check => check.rule === 'SKU_ALLOWED' && !check.pass));
});

test('policy explicitly blocks every high-risk category', () => {
  for (const category of DISABILITY_PERSONAL_BUDGET_PROGRAM.prohibitedCategories) {
    const blocked = evaluatePurchasePolicy({
      program: DISABILITY_PERSONAL_BUDGET_PROGRAM,
      enrollment: SYNTHETIC_ENROLLMENT,
      candidate: { ...candidate, sku: `${category}_01`, category },
      catalogItem: { ...DEMO_ASSISTIVE_CATALOG[0]!, sku: `${category}_01`, category },
      now: Date.parse('2026-07-31T00:00:00Z'),
      expectedPlanRevision: 1,
      duplicate: false
    });
    assert.equal(blocked.decision, 'BLOCKED', category);
    assert.ok(blocked.checks.some(check => check.rule === 'CATEGORY_NOT_PROHIBITED' && !check.pass), category);
  }
});

test('policy rejects quantity, price arithmetic and catalog category tampering', () => {
  const variants = [
    { candidate: { ...candidate, quantity: 0 }, catalogItem: DEMO_ASSISTIVE_CATALOG[0]!, rule: 'QUANTITY_VALID' },
    { candidate: { ...candidate, unitPriceKrw: -1, totalPriceKrw: -1, programAmountKrw: -1 }, catalogItem: DEMO_ASSISTIVE_CATALOG[0]!, rule: 'PRICE_ARITHMETIC_VALID' },
    { candidate: { ...candidate, totalPriceKrw: 1 }, catalogItem: DEMO_ASSISTIVE_CATALOG[0]!, rule: 'PRICE_ARITHMETIC_VALID' },
    { candidate, catalogItem: { ...DEMO_ASSISTIVE_CATALOG[0]!, category: 'FIREARM' }, rule: 'CATALOG_MATCH' }
  ];
  for (const variant of variants) {
    const blocked = evaluatePurchasePolicy({
      program: DISABILITY_PERSONAL_BUDGET_PROGRAM,
      enrollment: SYNTHETIC_ENROLLMENT,
      candidate: variant.candidate,
      catalogItem: variant.catalogItem,
      now: Date.parse('2026-07-31T00:00:00Z'),
      expectedPlanRevision: 1,
      duplicate: false
    });
    assert.equal(blocked.decision, 'BLOCKED');
    assert.ok(blocked.checks.some(check => check.rule === variant.rule && !check.pass), variant.rule);
  }
});

test('deterministic language boundary recognizes Korean high-risk purchase phrases', () => {
  const examples = [
    ['총기 구입해 줘', 'FIREARM'], ['권총 하나 사줘', 'FIREARM'], ['사냥용 탄약', 'AMMUNITION'],
    ['담배 한 보루', 'TOBACCO'], ['소주 두 병', 'ALCOHOL'], ['상품권으로 바꿔줘', 'GIFT_CARD'],
    ['현금화 가능한 걸 사줘', 'CASH_EQUIVALENT'], ['로또 사줘', 'LOTTERY']
  ] as const;
  for (const [phrase, category] of examples) assert.equal(detectHighRiskCategory(phrase), category, phrase);
  assert.equal(detectHighRiskCategory('승인된 기립 보조기 한 개'), undefined);
});
