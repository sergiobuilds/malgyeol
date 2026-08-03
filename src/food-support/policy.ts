import { createHash } from 'node:crypto';
import {
  FOOD_VOUCHER_POLICY_VERSION,
  type CartLine,
  type FoodOrderConsent,
  type FoodPolicyCheck,
  type FoodPolicyDecision,
  type FoodSupportBudget,
  type FoodVoucherCategory
} from './types.ts';

export const FOOD_VOUCHER_POLICY = Object.freeze({
  policyVersion: FOOD_VOUCHER_POLICY_VERSION,
  officialName: '2026 농식품바우처 호환 식품지원',
  integrationStatus: 'COMPATIBLE_RULESET_NOT_OFFICIAL_PAYMENT_INTEGRATION' as const,
  sourceUrls: [
    'https://www.foodvoucher.go.kr/view/fm/vucintro/agriFood',
    'https://www.mafra.go.kr/home/5109/subview.do?enc=Zm5jdDF8QEB8JTJGYmJzJTJGaG9tZSUyRjc5MiUyRjU3NjIzMyUyRmFydGNsVmlldy5kbyUzRnNyY2hDb2x1bW4lM0QlMjZwYXNzd29yZCUzRCUyNmlzVmlld01pbmUlM0RmYWxzZSUyNnJvdyUzRDEwJTI2YmJzT3BlbldyZFNlcSUzRCUyNnNyY2hXcmQlM0QlMjZyZ3NFbmR'
  ],
  verifiedAt: '2026-08-01T00:00:00+09:00',
  allowedCategories: [
    'DOMESTIC_FRUIT', 'DOMESTIC_VEGETABLE', 'WHITE_MILK', 'FRESH_EGGS',
    'MEAT', 'MIXED_GRAINS', 'TOFU', 'FOREST_NUTS'
  ] as readonly FoodVoucherCategory[],
  prohibitedCategories: [
    'WHITE_RICE', 'INSTANT_NOODLES', 'PROCESSED_FOOD', 'FOREIGN_FOOD', 'SEAFOOD',
    'ALCOHOL', 'TOBACCO', 'GIFT_CARD', 'CASH_EQUIVALENT', 'FIREARM', 'AMMUNITION',
    'ILLEGAL_DRUG', 'HIGH_RISK_UNKNOWN', 'OUT_OF_POLICY'
  ] as readonly FoodVoucherCategory[]
});

const HIGH_RISK_PATTERNS: ReadonlyArray<[FoodVoucherCategory, RegExp]> = [
  ['FIREARM', /총기|권총|소총|공기총|엽총|firearm|handgun|rifle/i],
  ['AMMUNITION', /탄약|총알|실탄|ammunition|ammo/i],
  ['ILLEGAL_DRUG', /마약|필로폰|코카인|헤로인|illegal drug/i],
  ['TOBACCO', /담배|전자담배|시가|tobacco|cigarette/i],
  ['ALCOHOL', /주류|소주|맥주|양주|술\b|alcohol/i],
  ['GIFT_CARD', /상품권|기프트\s*카드|gift\s*card/i],
  ['CASH_EQUIVALENT', /현금화|환금|cash\s*equivalent/i]
];

export function detectFoodHighRiskCategory(text: string): FoodVoucherCategory | undefined {
  const normalized = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return HIGH_RISK_PATTERNS.find(([, pattern]) => pattern.test(normalized))?.[0];
}

export interface EvaluateFoodPolicyInput {
  lines: CartLine[];
  budget: FoodSupportBudget;
  originalUtterance: string;
  duplicateCase: boolean;
}

export function evaluateFoodSupportPolicy(input: EvaluateFoodPolicyInput): FoodPolicyDecision {
  const originalHighRisk = detectFoodHighRiskCategory(input.originalUtterance);
  let runningApproved = 0;
  const lineInputs = input.lines.map(line => {
    const amountKrw = line.product.unitPriceKrw * line.quantity + line.product.shippingFeeKrw;
    const priceValid = Number.isSafeInteger(line.product.unitPriceKrw)
      && line.product.unitPriceKrw > 0
      && Number.isSafeInteger(line.quotedUnitPriceKrw)
      && line.quotedUnitPriceKrw === line.product.unitPriceKrw
      && Number.isSafeInteger(amountKrw)
      && amountKrw > 0;
    const categoryAllowed = FOOD_VOUCHER_POLICY.allowedCategories.includes(line.product.category);
    const originKnown = line.product.originStatus !== 'UNKNOWN';
    const originDomestic = line.product.originStatus === 'DOMESTIC';
    const withinLineLimit = amountKrw <= input.budget.maximumPurchaseKrw;
    const withinRemainingBudget = runningApproved + amountKrw <= input.budget.remainingKrw;
    const originalRequestSafe = originalHighRisk === undefined;
    const checks: FoodPolicyCheck[] = [
      check('ORIGINAL_REQUEST_HIGH_RISK', originalRequestSafe, 'BLOCKED'),
      check('CATEGORY_SUPPORTED', categoryAllowed, 'BLOCKED'),
      check('ORIGIN_KNOWN', originKnown, 'NEEDS_CLARIFICATION'),
      check('ORIGIN_DOMESTIC', originDomestic, originKnown ? 'BLOCKED' : 'NEEDS_CLARIFICATION'),
      check('PRODUCT_SELLING', line.product.selling, 'BLOCKED'),
      check('STOCK_AVAILABLE', line.product.inStock, 'BLOCKED'),
      check('DELIVERY_AVAILABLE', line.product.deliveryAvailable, 'BLOCKED'),
      check('QUANTITY_VALID', Number.isSafeInteger(line.quantity) && line.quantity > 0, 'BLOCKED'),
      check('PRICE_POSITIVE_AND_UNCHANGED', priceValid, 'BLOCKED'),
      check('WITHIN_PURCHASE_LIMIT', withinLineLimit, 'BLOCKED'),
      check('BALANCE_AVAILABLE', withinRemainingBudget, 'BLOCKED'),
      check('CASE_NOT_DUPLICATE', !input.duplicateCase, 'BLOCKED')
    ];
    const failed = checks.filter(item => !item.pass);
    const decision = failed.some(item => item.outcome === 'BLOCKED')
      ? 'BLOCKED' as const
      : failed.some(item => item.outcome === 'NEEDS_CLARIFICATION')
        ? 'NEEDS_CLARIFICATION' as const
        : 'APPROVED' as const;
    if (decision === 'APPROVED') runningApproved += amountKrw;
    return {
      lineId: line.lineId,
      goodsNo: line.product.goodsNo,
      decision,
      amountKrw,
      checks,
      failedRules: failed.map(item => item.rule)
    };
  });
  const approvedCount = lineInputs.filter(line => line.decision === 'APPROVED').length;
  const blockedCount = lineInputs.filter(line => line.decision === 'BLOCKED').length;
  const clarificationCount = lineInputs.filter(line => line.decision === 'NEEDS_CLARIFICATION').length;
  const decision = approvedCount === lineInputs.length && lineInputs.length > 0
    ? 'APPROVED' as const
    : approvedCount > 0
      ? 'PARTIAL_APPROVAL' as const
      : clarificationCount > 0 && blockedCount === 0
        ? 'NEEDS_CLARIFICATION' as const
        : 'BLOCKED' as const;
  const canonical = JSON.stringify({
    policyVersion: FOOD_VOUCHER_POLICY.policyVersion,
    sourceUrls: FOOD_VOUCHER_POLICY.sourceUrls,
    verifiedAt: FOOD_VOUCHER_POLICY.verifiedAt,
    originalHighRisk: originalHighRisk ?? null,
    budget: input.budget,
    duplicateCase: input.duplicateCase,
    lines: lineInputs
  });
  return {
    decision,
    policyVersion: FOOD_VOUCHER_POLICY.policyVersion,
    policySnapshotHash: createHash('sha256').update(canonical).digest('hex'),
    sourceUrls: [...FOOD_VOUCHER_POLICY.sourceUrls],
    verifiedAt: FOOD_VOUCHER_POLICY.verifiedAt,
    approvedAmountKrw: runningApproved,
    lines: lineInputs
  };
}

export function buildFoodOrderConsent(input: Omit<FoodOrderConsent, 'commitment'>): FoodOrderConsent {
  const canonical = JSON.stringify({ version: 'food-order-consent-v1', ...input });
  return { ...input, commitment: createHash('sha256').update(canonical).digest('hex') };
}

export function consentStillValid(consent: FoodOrderConsent, current: {
  goodsNo: string;
  sellerCode: string;
  quantity: number;
  unitPriceKrw: number;
  shippingFeeKrw: number;
  recipientToken: string;
  policySnapshotHash: string;
  now: number;
}): boolean {
  return current.now <= consent.expiresAt
    && consent.goodsNo === current.goodsNo
    && consent.sellerCode === current.sellerCode
    && consent.quantity === current.quantity
    && consent.unitPriceKrw === current.unitPriceKrw
    && consent.shippingFeeKrw === current.shippingFeeKrw
    && consent.recipientToken === current.recipientToken
    && consent.policySnapshotHash === current.policySnapshotHash;
}

function check(rule: string, pass: boolean, failureOutcome: 'BLOCKED' | 'NEEDS_CLARIFICATION'): FoodPolicyCheck {
  return { rule, pass, outcome: pass ? 'PASS' : failureOutcome };
}
