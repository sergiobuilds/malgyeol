import { createHash } from 'node:crypto';
import type { CatalogItem, Enrollment, PolicyDecision, ProgramTemplate, PurchaseCandidate } from './types.ts';

const HIGH_RISK_LANGUAGE: Array<[string, RegExp]> = [
  ['FIREARM', /총기|권총|소총|공기총|엽총|총을|총 한|firearm|handgun|rifle/i],
  ['AMMUNITION', /탄약|총알|실탄|ammunition|ammo/i],
  ['EXPLOSIVE', /폭발물|폭탄|수류탄|explosive|bomb/i],
  ['ILLEGAL_DRUG', /마약|필로폰|코카인|헤로인|illegal drug/i],
  ['CONTROLLED_SUBSTANCE', /향정신성|통제 약물|controlled substance/i],
  ['TOBACCO', /담배|전자담배|시가|tobacco|cigarette/i],
  ['ALCOHOL', /주류|소주|맥주|양주|술\b|alcohol/i],
  ['LOTTERY', /복권|로또|lottery/i],
  ['GAMBLING', /도박|카지노|베팅|gambling|casino/i],
  ['ADULT_CONTENT', /성인물|음란물|adult content/i],
  ['GIFT_CARD', /상품권|기프트카드|gift card/i],
  ['CASH_EQUIVALENT', /현금화|환금|cash equivalent/i],
  ['CASH', /현금|cash/i],
  ['CRYPTO_SPECULATION', /코인 투자|암호화폐 투기|crypto speculation/i],
  ['DEBT_REPAYMENT', /빚 갚|채무 상환|debt repayment/i],
  ['WEAPON', /무기|도검|칼을 사|weapon/i]
];

export function detectHighRiskCategory(text: string): string | undefined {
  const normalized = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return HIGH_RISK_LANGUAGE.find(([, pattern]) => pattern.test(normalized))?.[0];
}

interface PolicyInput {
  program: ProgramTemplate;
  enrollment: Enrollment;
  candidate: PurchaseCandidate;
  catalogItem: CatalogItem;
  now: number;
  expectedPlanRevision: number;
  duplicate: boolean;
}

export function evaluatePurchasePolicy(input: PolicyInput): PolicyDecision {
  const { program, enrollment, candidate, catalogItem, now } = input;
  const priceArithmeticValid = Number.isSafeInteger(candidate.unitPriceKrw)
    && candidate.unitPriceKrw > 0
    && Number.isSafeInteger(candidate.totalPriceKrw)
    && candidate.totalPriceKrw === candidate.unitPriceKrw * candidate.quantity
    && candidate.programAmountKrw === candidate.totalPriceKrw;
  const checks = [
    { rule: 'ENROLLMENT_ACTIVE', pass: enrollment.active },
    { rule: 'PROGRAM_MATCH', pass: enrollment.programId === program.programId },
    { rule: 'PROGRAM_VALID', pass: now >= program.validFrom && now <= program.validUntil },
    { rule: 'PLAN_VALID', pass: now >= enrollment.validFrom && now <= enrollment.validUntil },
    { rule: 'PLAN_REVISION_CURRENT', pass: enrollment.planRevision === input.expectedPlanRevision },
    { rule: 'PLAN_CATEGORY_ALLOWED', pass: enrollment.approvedCategories.includes(candidate.category) },
    { rule: 'SKU_ALLOWED', pass: enrollment.approvedSkus.includes(candidate.sku) },
    { rule: 'CATEGORY_NOT_PROHIBITED', pass: !program.prohibitedCategories.includes(candidate.category) },
    { rule: 'MERCHANT_ALLOWED', pass: enrollment.approvedMerchants.includes(candidate.merchantId) },
    { rule: 'CATALOG_MATCH', pass: catalogItem.sku === candidate.sku && catalogItem.category === candidate.category && catalogItem.merchantId === candidate.merchantId },
    { rule: 'QUANTITY_VALID', pass: Number.isSafeInteger(candidate.quantity) && candidate.quantity > 0 },
    { rule: 'PRICE_ARITHMETIC_VALID', pass: priceArithmeticValid },
    { rule: 'WITHIN_LIMIT', pass: candidate.totalPriceKrw <= enrollment.maximumPurchaseKrw },
    { rule: 'BALANCE_AVAILABLE', pass: candidate.totalPriceKrw <= enrollment.remainingKrw },
    { rule: 'NOT_DUPLICATE', pass: !input.duplicate },
    { rule: 'DELIVERY_AVAILABLE', pass: catalogItem.deliveryAvailable },
    { rule: 'INTERPRETATION_CONFIDENT', pass: candidate.confidence >= 0.9 && candidate.ambiguityReasons.length === 0 }
  ];
  const canonical = JSON.stringify({
    policyVersion: 'kr-disability-personal-budget-demo-v2',
    programId: program.programId,
    programVersion: program.version,
    beneficiaryRef: enrollment.beneficiaryRef,
    planId: enrollment.planId,
    planRevision: enrollment.planRevision,
    candidate: {
      sku: candidate.sku,
      category: candidate.category,
      quantity: candidate.quantity,
      merchantId: candidate.merchantId,
      totalPriceKrw: candidate.totalPriceKrw
    },
    checks
  });
  return {
    decision: checks.every(check => check.pass) ? 'APPROVED' : 'BLOCKED',
    policyVersion: 'kr-disability-personal-budget-demo-v2',
    checks,
    policySnapshotHash: createHash('sha256').update(canonical).digest('hex')
  };
}
