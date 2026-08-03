import type { Enrollment, ProgramTemplate } from '../types.ts';

export const DISABILITY_PERSONAL_BUDGET_PROGRAM: ProgramTemplate = Object.freeze({
  programId: 'kr-disability-personal-budget-demo',
  version: 1,
  officialName: '2026 장애인 개인예산제 3차 시범사업 재현',
  sourceUrls: [
    'https://mohw.go.kr/board.es?mid=a10503010100&bid=0027&tag=&act=view&list_no=1490382&cg_code=',
    'https://mohw.go.kr/board.es?mid=a10503010100&bid=0027&tag=&act=view&list_no=1488658&cg_code='
  ],
  currency: 'KRW',
  eligibilityOwnedBy: 'LEGACY_INSTITUTION',
  prohibitedCategories: [
    'FIREARM',
    'WEAPON',
    'AMMUNITION',
    'EXPLOSIVE',
    'ILLEGAL_DRUG',
    'CONTROLLED_SUBSTANCE',
    'TOBACCO',
    'ALCOHOL',
    'LOTTERY',
    'GAMBLING',
    'ADULT_CONTENT',
    'CASH',
    'CASH_EQUIVALENT',
    'GIFT_CARD',
    'CRYPTO_SPECULATION',
    'TAX',
    'DEBT_REPAYMENT',
    'UNAPPROVED_MEDICAL',
    'UNKNOWN_HIGH_RISK'
  ],
  validFrom: Date.parse('2026-05-01T00:00:00+09:00'),
  validUntil: Date.parse('2026-10-31T23:59:59+09:00')
});

export const SYNTHETIC_ENROLLMENT: Enrollment = Object.freeze({
  beneficiaryRef: 'P-2026-0031',
  programId: DISABILITY_PERSONAL_BUDGET_PROGRAM.programId,
  planId: 'plan-stand-aid',
  planRevision: 1,
  active: true,
  monthlyLimitKrw: 420_000,
  remainingKrw: 420_000,
  approvedCategories: ['ASSISTIVE_EQUIPMENT'],
  approvedSkus: ['ASSISTIVE_STAND_AID_01'],
  approvedMerchants: ['DEMO_ACCESS_STORE'],
  maximumPurchaseKrw: 390_000,
  validFrom: DISABILITY_PERSONAL_BUDGET_PROGRAM.validFrom,
  validUntil: DISABILITY_PERSONAL_BUDGET_PROGRAM.validUntil
});
