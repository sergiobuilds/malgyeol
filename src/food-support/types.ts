export const FOOD_VOUCHER_POLICY_VERSION = 'kr-agri-food-voucher-compatible-2026-v1' as const;

export type FoodVoucherCategory =
  | 'DOMESTIC_FRUIT'
  | 'DOMESTIC_VEGETABLE'
  | 'WHITE_MILK'
  | 'FRESH_EGGS'
  | 'MEAT'
  | 'MIXED_GRAINS'
  | 'TOFU'
  | 'FOREST_NUTS'
  | 'WHITE_RICE'
  | 'INSTANT_NOODLES'
  | 'PROCESSED_FOOD'
  | 'FOREIGN_FOOD'
  | 'SEAFOOD'
  | 'ALCOHOL'
  | 'TOBACCO'
  | 'GIFT_CARD'
  | 'CASH_EQUIVALENT'
  | 'FIREARM'
  | 'AMMUNITION'
  | 'ILLEGAL_DRUG'
  | 'HIGH_RISK_UNKNOWN'
  | 'OUT_OF_POLICY';

export type FoodIntent =
  | 'DISCOVER_PRODUCTS'
  | 'CHECK_ELIGIBILITY'
  | 'COMPARE_PRODUCTS'
  | 'ADD_TO_CART'
  | 'MODIFY_CART'
  | 'PURCHASE'
  | 'REORDER'
  | 'CHECK_BUDGET'
  | 'TRACK_ORDER'
  | 'CANCEL_ORDER'
  | 'REQUEST_HELP'
  | 'UNKNOWN';

export interface ProductQuery {
  text: string;
  exactName?: string;
  category?: FoodVoucherCategory;
  sort?: 'LOWEST_TOTAL_PRICE';
  quantity?: number;
}

export interface ConversationTurn {
  turnId: string;
  actor: 'BENEFICIARY' | 'CAREGIVER' | 'AGENT';
  intent: FoodIntent;
  query: ProductQuery;
  createdAt: number;
  needsClarification: boolean;
  clarificationCode?: 'AMBIGUOUS_RICE' | 'MALFORMED_MULTI_ITEM' | 'UNBOUNDED_SUBSTITUTION' | 'CATEGORY_CHOICE' | 'MISSING_CONTEXT';
}

export interface ConversationSession {
  sessionId: string;
  caseId: string;
  revision: number;
  turns: ConversationTurn[];
  createdAt: number;
  updatedAt: number;
}

export interface CandidateSet {
  caseId: string;
  query: ProductQuery;
  source: 'SPECIAL_OFFER_LIVE' | 'CREDENTIAL_GATED';
  candidates: FoodProduct[];
  exactMatch: boolean;
}

export interface CartLine {
  lineId: string;
  product: FoodProduct;
  quantity: number;
  quotedUnitPriceKrw: number;
}

export interface Cart {
  caseId: string;
  revision: number;
  lines: CartLine[];
  updatedAt: number;
}

export type OriginStatus = 'DOMESTIC' | 'FOREIGN' | 'UNKNOWN';

export interface FoodProduct {
  goodsNo: string;
  goodsCode: string;
  sellerCode: string;
  name: string;
  category: FoodVoucherCategory;
  origin: string;
  originStatus: OriginStatus;
  unitPriceKrw: number;
  shippingFeeKrw: number;
  inStock: boolean;
  selling: boolean;
  deliveryAvailable: boolean;
  refundable: boolean | 'CONDITIONAL';
  nonRefundableConditions: string;
  orderCutoff: string;
  detailUrl: string;
  source: 'SPECIAL_OFFER_LIVE' | 'TEST_FIXTURE';
}

export interface FoodSupportBudget {
  remainingKrw: number;
  maximumPurchaseKrw: number;
}

export interface FoodPolicyCheck {
  rule: string;
  pass: boolean;
  outcome: 'PASS' | 'BLOCKED' | 'NEEDS_CLARIFICATION';
}

export interface FoodLinePolicyDecision {
  lineId: string;
  goodsNo: string;
  decision: 'APPROVED' | 'BLOCKED' | 'NEEDS_CLARIFICATION';
  amountKrw: number;
  checks: FoodPolicyCheck[];
  failedRules: string[];
}

export interface FoodPolicyDecision {
  decision: 'APPROVED' | 'PARTIAL_APPROVAL' | 'BLOCKED' | 'NEEDS_CLARIFICATION';
  policyVersion: typeof FOOD_VOUCHER_POLICY_VERSION;
  policySnapshotHash: string;
  sourceUrls: string[];
  verifiedAt: string;
  approvedAmountKrw: number;
  lines: FoodLinePolicyDecision[];
}

export interface FoodOrderConsent {
  caseId: string;
  goodsNo: string;
  sellerCode: string;
  quantity: number;
  unitPriceKrw: number;
  shippingFeeKrw: number;
  totalPriceKrw: number;
  recipientToken: string;
  policySnapshotHash: string;
  expiresAt: number;
  commitment: string;
}

export type DeliveryState =
  | 'ORDER_ACCEPTED'
  | 'PREPARING'
  | 'SHIPPED'
  | 'CARRIER_DELIVERED'
  | 'RECIPIENT_CONFIRMED'
  | 'DELIVERY_DISPUTED'
  | 'CANCELLED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

export interface ExternalOrderReadback {
  caseId?: string;
  goodsNo?: string;
  externalOrderId: string;
  externalOrderNo: string;
  sellerCode: string;
  goodsName: string;
  quantity: number;
  goodsPriceKrw: number;
  shippingFeeKrw: number;
  totalPriceKrw: number;
  providerOrderState: number;
  deliveryState: DeliveryState;
  deliveryCompany?: string;
  trackingNumber?: string;
  shippedAt?: string;
  sellerMemo?: string;
  buyerMemo?: string;
  source: 'SPECIAL_OFFER_LIVE';
}

export interface RecipientConfirmation {
  caseId: string;
  state: 'RECIPIENT_CONFIRMED' | 'DELIVERY_DISPUTED';
  reason?: 'NOT_RECEIVED' | 'ITEM_PROBLEM';
  confirmedAt: number;
}
