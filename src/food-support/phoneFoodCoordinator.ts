import { createHash } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import type { CaseRepository } from '../e2e/caseRepository.ts';
import type { BenefitCase, CaseState, PolicyDecision, PurchaseCandidate } from '../e2e/types.ts';
import { parseFoodUtterance } from './conversation.ts';
import { containsLikelyPii } from './privacy.ts';
import { evaluateFoodSupportPolicy, FOOD_VOUCHER_POLICY } from './policy.ts';
import type { FoodBudgetProvider } from './budgetProvider.ts';
import type { FoodProduct, FoodSupportBudget } from './types.ts';
import type { PhoneEnrollmentService } from './phoneEnrollment.ts';
import type { SpecialOfferRecipient } from './specialOffer.ts';
import { CanonicalCaseLedger } from '../case-ledger/ledger.ts';
import { canonicalJson } from '../case-ledger/canonicalHash.ts';
import { CANONICAL_CASE_STATES, type CanonicalCaseState, type SafeEventData } from '../case-ledger/types.ts';

export interface PhoneCatalog {
  search(query: { query: string; exactName?: string }): Promise<
    { status: 'LIVE'; products: FoodProduct[] } | { status: 'CREDENTIAL_GATED'; products: [] }
  >;
  get(goodsNo: string): Promise<
    { status: 'LIVE'; product: FoodProduct } | { status: 'CREDENTIAL_GATED' }
  >;
}

export interface PhoneConfirmedOrderTerms {
  productName: string;
  sellerCode: string;
  totalPriceKrw: number;
  policySnapshotHash: string;
}

export function phoneOrderTermsMatch(expected: PhoneConfirmedOrderTerms, current: PhoneConfirmedOrderTerms): boolean {
  return current.productName === expected.productName
    && current.sellerCode === expected.sellerCode
    && current.totalPriceKrw === expected.totalPriceKrw
    && current.policySnapshotHash === expected.policySnapshotHash;
}

export interface PhoneFoodCase {
  caseId: string;
  revision: number;
  status: 'STARTED' | 'NEEDS_CLARIFICATION' | 'BLOCKED' | 'CANDIDATES_READY' | 'AWAITING_CONFIRMATION' | 'ORDER_SUBMITTING' | 'ORDER_REVIEW_REQUIRED' | 'ORDERED' | 'CONFIRMED' | 'CANCELLED';
  candidates: FoodProduct[];
  selectedGoodsNo?: string;
  selectedQuantity?: number;
  policySnapshotHash?: string;
  budgetSource?: 'INSTITUTION' | 'SYNTHETIC_DEMO';
  budget?: FoodSupportBudget;
  callerHash?: string;
  externalOrderId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PhoneFoodRepository {
  get(caseId: string): Promise<PhoneFoodCase | undefined>;
  save(value: PhoneFoodCase): Promise<void>;
}

export class InMemoryPhoneFoodRepository implements PhoneFoodRepository {
  private readonly values = new Map<string, PhoneFoodCase>();
  async get(caseId: string): Promise<PhoneFoodCase | undefined> {
    const value = this.values.get(caseId);
    return value ? structuredClone(value) : undefined;
  }
  async save(value: PhoneFoodCase): Promise<void> {
    const current = this.values.get(value.caseId);
    if (current && value.revision !== current.revision + 1) throw new Error('Phone food revision conflict');
    if (!current && value.revision !== 1) throw new Error('Phone food revision conflict');
    this.values.set(value.caseId, structuredClone(value));
  }
}

export class FirestorePhoneFoodRepository implements PhoneFoodRepository {
  constructor(private readonly db = new Firestore()) {}
  async get(caseId: string): Promise<PhoneFoodCase | undefined> {
    const snapshot = await this.db.collection('phoneFoodCases').doc(caseId).get();
    return snapshot.exists ? snapshot.data() as PhoneFoodCase : undefined;
  }
  async save(value: PhoneFoodCase): Promise<void> {
    const ref = this.db.collection('phoneFoodCases').doc(value.caseId);
    await this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.exists ? snapshot.data() as PhoneFoodCase : undefined;
      if (current && value.revision !== current.revision + 1) throw new Error('Phone food revision conflict');
      if (!current && value.revision !== 1) throw new Error('Phone food revision conflict');
      transaction.set(ref, value);
    });
  }
}

export class PhoneFoodCoordinator {
  constructor(
    private readonly cases: CaseRepository,
    private readonly phoneCases: PhoneFoodRepository,
    private readonly catalog: PhoneCatalog,
    private readonly budgets: FoodBudgetProvider,
    private readonly canonicalLedger: CanonicalCaseLedger,
    private readonly now: () => number = Date.now,
    private readonly syntheticDemoBudget?: FoodSupportBudget,
    private readonly enrollments?: PhoneEnrollmentService,
    private readonly submitConfirmedOrder?: (input: {
      caseId: string;
      goodsNo: string;
      quantity: number;
      originalUtterance: string;
      expectedProductName: string;
      expectedSellerCode: string;
      expectedTotalPriceKrw: number;
      expectedPolicySnapshotHash: string;
      recipient: Omit<SpecialOfferRecipient, 'recipientToken'>;
    }) => Promise<
      | { status: 'SUBMITTED'; externalOrderId: string }
      | { status: 'TERMS_CHANGED' }
      | { status: 'ORDER_RECONCILIATION_REQUIRED'; reason: 'IN_FLIGHT' | 'AMBIGUOUS_RESPONSE' }
    >
  ) {}

  async begin(callId: string, callerNumber?: string): Promise<Record<string, unknown>> {
    if (!/^[A-Za-z0-9_.:-]{3,256}$/.test(callId)) throw new PhoneFoodInputError('Invalid callId');
    const caseId = `food_${createHash('sha256').update(`clawops-food-v1:${callId}`).digest('hex').slice(0, 24)}`;
    const existing = await this.cases.get(caseId);
    await this.openCanonicalCase(caseId, callId);
    if (!existing) {
      const at = this.now();
      const enrollment = callerNumber && this.enrollments ? await this.enrollments.resolve(callerNumber) : undefined;
      await this.cases.create({
        caseId,
        callSidHash: createHash('sha256').update(callId).digest('hex'),
        beneficiaryRef: enrollment?.beneficiaryRef ?? 'phone-beneficiary-unlinked',
        programId: enrollment?.programId ?? 'institution-food-support-2026',
        planId: enrollment?.planId ?? 'pending-enrollment',
        state: 'CALL_CONNECTED',
        createdAt: at,
        updatedAt: at
      });
      await this.phoneCases.save({
        caseId, revision: 1, status: 'STARTED', candidates: [], createdAt: at, updatedAt: at,
        ...(enrollment ? { callerHash: enrollment.callerHash, budget: enrollment.budget, budgetSource: enrollment.source } : {})
      });
    }
    return this.status(caseId);
  }

  async interpret(caseId: string, text: string): Promise<Record<string, unknown>> {
    validateCaseId(caseId);
    if (!text.trim() || text.length > 1000) throw new PhoneFoodInputError('Invalid utterance');
    const current = await this.requireContext(caseId);
    const parsed = parseFoodUtterance(text);
    if (containsLikelyPii(text)) {
      await this.update(current, 'NEEDS_CLARIFICATION', [], 'NEEDS_CLARIFICATION');
      return { caseId, state: 'NEEDS_CLARIFICATION', reason: 'PII_BOUNDARY', message: '주소와 연락처는 통화에서 받지 않습니다. 필요한 먹거리만 말씀해 주세요.' };
    }
    const highRisk = parsed.requestedCategories.some(category => ['FIREARM', 'AMMUNITION', 'ILLEGAL_DRUG', 'TOBACCO', 'ALCOHOL', 'GIFT_CARD', 'CASH_EQUIVALENT', 'HIGH_RISK_UNKNOWN'].includes(category));
    if (highRisk) {
      await this.update(current, 'BLOCKED', [], 'POLICY_BLOCKED');
      return { caseId, state: 'POLICY_BLOCKED', reason: 'PROHIBITED_CATEGORY', message: '지원 범위와 안전 기준에 맞지 않아 상품 조회와 주문을 시작하지 않았습니다.' };
    }
    const unsupported = parsed.requestedCategories.find(category => !FOOD_VOUCHER_POLICY.allowedCategories.includes(category));
    if (unsupported && parsed.clarificationCode !== 'AMBIGUOUS_RICE') {
      await this.update(current, 'NEEDS_CLARIFICATION', [], 'NEEDS_CLARIFICATION');
      return {
        caseId, state: 'NEEDS_CLARIFICATION', reason: 'NOT_SUPPORTED_BY_PROGRAM',
        message: '그 먹거리는 지원금으로 주문할 수 없어요. 잡곡, 국산 과일, 채소, 흰우유, 계란, 고기, 두부, 밤·잣·호두 중에서 다른 것을 골라 주세요.'
      };
    }
    if (parsed.needsClarification && parsed.clarificationCode !== 'AMBIGUOUS_RICE') {
      await this.update(current, 'NEEDS_CLARIFICATION', [], 'NEEDS_CLARIFICATION');
      return { caseId, state: 'NEEDS_CLARIFICATION', reason: parsed.clarificationCode, message: parsed.response };
    }
    if (!['DISCOVER_PRODUCTS', 'COMPARE_PRODUCTS', 'PURCHASE'].includes(parsed.intent)) {
      await this.update(current, 'NEEDS_CLARIFICATION', [], 'NEEDS_CLARIFICATION');
      return { caseId, state: 'NEEDS_CLARIFICATION', reason: parsed.intent, message: parsed.response };
    }
    const query = parsed.query.exactName ?? text;
    const found = await this.catalog.search({ query, ...(parsed.query.exactName ? { exactName: parsed.query.exactName } : {}) });
    if (found.status !== 'LIVE') {
      await this.update(current, 'NEEDS_CLARIFICATION', [], 'NEEDS_CLARIFICATION');
      return { caseId, state: 'NEEDS_CLARIFICATION', reason: 'SUPPLIER_CREDENTIAL_GATED', message: '현재 판매처 상품을 확인할 수 없어 주문을 진행하지 않았습니다.' };
    }
    const candidates = found.products.filter(product =>
      product.inStock
      && product.selling
      && product.deliveryAvailable
      && product.originStatus === 'DOMESTIC'
      && FOOD_VOUCHER_POLICY.allowedCategories.includes(product.category)
    ).slice(0, 3);
    if (candidates.length === 0) {
      await this.update(current, 'NEEDS_CLARIFICATION', [], 'NEEDS_CLARIFICATION');
      return { caseId, state: 'NEEDS_CLARIFICATION', reason: 'NO_LIVE_PRODUCT', message: '현재 주문 가능한 실제 상품을 찾지 못했습니다. 다른 먹거리를 말씀해 주세요.' };
    }
    await this.advanceCanonicalOnce(caseId, 'INTENT_INTERPRETED', {
      intentHash: prefixedHash(text),
      intent: parsed.intent,
      model: 'DETERMINISTIC_PHONE_BRIDGE'
    }, 'SYSTEM', 'SYSTEM', `${caseId}:intent:v1`);
    await this.update(current, 'CANDIDATES_READY', candidates, 'INTERPRETED');
    return {
      caseId,
      state: 'CANDIDATES_READY',
      clarification: parsed.clarificationCode,
      candidates: candidates.map((product, index) => ({
        number: index + 1,
        goodsNo: product.goodsNo,
        name: product.name,
        origin: product.origin,
        unitPriceKrw: product.unitPriceKrw,
        shippingFeeKrw: product.shippingFeeKrw
      })),
      message: '실제 판매 중인 상품 후보입니다. 원하는 번호를 말씀해 주세요.'
    };
  }

  async select(caseId: string, candidateNumber: number, quantity: number): Promise<Record<string, unknown>> {
    validateCaseId(caseId);
    if (!Number.isSafeInteger(candidateNumber) || candidateNumber < 1 || candidateNumber > 3) throw new PhoneFoodInputError('Invalid candidateNumber');
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) throw new PhoneFoodInputError('Invalid quantity');
    const current = await this.requireContext(caseId);
    const snapshot = current.candidates[candidateNumber - 1];
    if (!snapshot) throw new PhoneFoodInputError('Candidate is not available');
    const authoritative = await this.catalog.get(snapshot.goodsNo);
    if (authoritative.status !== 'LIVE') return { caseId, state: 'NEEDS_CLARIFICATION', reason: 'SUPPLIER_CREDENTIAL_GATED' };
    const institutionalBudget = await this.budgets.get(caseId);
    const enrolledBudget = current.budget;
    const budget = institutionalBudget ?? enrolledBudget ?? (!current.callerHash ? this.syntheticDemoBudget : undefined);
    if (!budget) {
      await this.update(current, 'NEEDS_CLARIFICATION', current.candidates, 'NEEDS_CLARIFICATION');
      return { caseId, state: 'NEEDS_CLARIFICATION', reason: 'ENROLLMENT_REQUIRED', message: '이 전화번호에 지원 정보가 연결되지 않아 주문하지 않았습니다. 지원을 등록한 곳에 전화번호 연결을 먼저 요청해 주세요.' };
    }
    const decision = evaluateFoodSupportPolicy({
      lines: [{ lineId: 'phone', product: authoritative.product, quantity, quotedUnitPriceKrw: authoritative.product.unitPriceKrw }],
      budget,
      originalUtterance: authoritative.product.name,
      duplicateCase: false
    });
    if (decision.decision !== 'APPROVED') {
      await this.transition(caseId, 'POLICY_BLOCKED', { policySnapshotHash: decision.policySnapshotHash });
      await this.phoneCases.save({ ...current, revision: current.revision + 1, status: 'BLOCKED', policySnapshotHash: decision.policySnapshotHash, updatedAt: this.now() });
      return { caseId, state: 'POLICY_BLOCKED', failedRules: decision.lines.flatMap(line => line.failedRules), message: '지원 기준을 통과하지 못해 주문 요청을 만들지 않았습니다.' };
    }
    const total = authoritative.product.unitPriceKrw * quantity + authoritative.product.shippingFeeKrw;
    const candidate: PurchaseCandidate = {
      caseId,
      sku: authoritative.product.goodsNo,
      category: authoritative.product.category,
      quantity,
      merchantId: authoritative.product.sellerCode,
      unitPriceKrw: authoritative.product.unitPriceKrw,
      totalPriceKrw: total,
      programAmountKrw: total,
      substitutionsAllowed: false,
      confidence: 1,
      ambiguityReasons: [],
      readbackSentence: authoritative.product.name
    };
    const policy: PolicyDecision = {
      decision: 'APPROVED',
      policyVersion: 'kr-agri-food-voucher-compatible-2026-v1',
      checks: decision.lines.flatMap(line => line.checks.map(check => ({ rule: check.rule, pass: check.pass }))),
      policySnapshotHash: decision.policySnapshotHash
    };
    const expiresAt = this.now() + 5 * 60_000;
    const conditionHash = prefixedHash(JSON.stringify({
      caseId,
      goodsNo: authoritative.product.goodsNo,
      sellerCode: authoritative.product.sellerCode,
      quantity,
      unitPriceKrw: authoritative.product.unitPriceKrw,
      shippingFeeKrw: authoritative.product.shippingFeeKrw,
      policySnapshotHash: decision.policySnapshotHash
    }));
    await this.advanceCanonicalOnce(caseId, 'POLICY_EVALUATED', {
      policySnapshotHash: normalizeHash(decision.policySnapshotHash),
      conditionHash,
      goodsNoHash: prefixedHash(authoritative.product.goodsNo),
      amountKrw: total,
      shippingFeeKrw: authoritative.product.shippingFeeKrw,
      inStock: authoritative.product.inStock,
      domestic: authoritative.product.originStatus === 'DOMESTIC'
    }, 'POLICY_ENGINE', 'DETERMINISTIC_POLICY', `${caseId}:policy:v1`);
    await this.transition(caseId, 'AWAITING_CONFIRMATION', { candidate, policy, policySnapshotHash: decision.policySnapshotHash, confirmationExpiresAt: expiresAt });
    await this.phoneCases.save({
      ...current,
      revision: current.revision + 1,
      status: 'AWAITING_CONFIRMATION',
      selectedGoodsNo: authoritative.product.goodsNo,
      selectedQuantity: quantity,
      policySnapshotHash: decision.policySnapshotHash,
      budgetSource: institutionalBudget ? 'INSTITUTION' : current.budgetSource ?? 'SYNTHETIC_DEMO',
      updatedAt: this.now()
    });
    return {
      caseId,
      state: 'AWAITING_CONFIRMATION',
      product: { name: authoritative.product.name, quantity, totalPriceKrw: total },
      budgetSource: institutionalBudget ? 'INSTITUTION' : current.budgetSource ?? 'SYNTHETIC_DEMO',
      message: '상품과 총액을 확인했습니다. 남은 지원금을 다시 확인한 뒤 바로 주문하려면 1번, 취소하려면 2번을 눌러 주세요.'
    };
  }

  async confirm(caseId: string, digit: string): Promise<Record<string, unknown>> {
    validateCaseId(caseId);
    const current = await this.requireContext(caseId);
    const value = await this.cases.get(caseId);
    if (!value) throw new PhoneFoodInputError('Case not found');
    if (digit === '2' && value.state === 'AWAITING_CONFIRMATION') {
      await this.transition(caseId, 'USER_REJECTED', {});
      await this.phoneCases.save({ ...current, revision: current.revision + 1, status: 'CANCELLED', updatedAt: this.now() });
      return { caseId, state: 'USER_REJECTED', message: '요청을 취소했습니다. 결제나 주문은 이루어지지 않았습니다.' };
    }
    if (digit !== '1' || !['AWAITING_CONFIRMATION', 'CONFIRMED', 'ORDER_SUBMITTING'].includes(value.state) || !value.candidate || !value.policySnapshotHash) return this.status(caseId);
    const commitment = createHash('sha256').update(JSON.stringify({ caseId, sku: value.candidate.sku, quantity: value.candidate.quantity, totalPriceKrw: value.candidate.totalPriceKrw, policySnapshotHash: value.policySnapshotHash })).digest('hex');
    let working = current;
    if (value.state === 'AWAITING_CONFIRMATION') {
      const consumed = await this.cases.consumeConfirmation(caseId, commitment, this.now());
      if (!consumed) return this.status(caseId);
      working = { ...current, revision: current.revision + 1, status: 'ORDER_SUBMITTING', updatedAt: this.now() };
      await this.phoneCases.save(working);
    }
    await this.advanceCanonicalOnce(caseId, 'USER_CONFIRMED', {
      confirmationHash: normalizeHash(commitment),
      confirmationMethod: 'DTMF'
    }, 'RECIPIENT', 'DTMF', `${caseId}:user-confirm:v1`);
    if (working.externalOrderId) {
      return { caseId, state: 'ORDERED', externalOrderId: working.externalOrderId, message: '주문이 접수되었습니다.' };
    }
    if (working.callerHash && this.enrollments && this.submitConfirmedOrder) {
      const recipient = await this.enrollments.recipient(working.callerHash);
      if (!recipient) throw new PhoneFoodInputError('Enrollment recipient unavailable');
      const beforeSubmit = await this.cases.get(caseId);
      if (!beforeSubmit) throw new PhoneFoodInputError('Case not found');
      if (beforeSubmit.state === 'CONFIRMED') await this.transition(caseId, 'ORDER_SUBMITTING', {});
      const result = await this.submitConfirmedOrder({
        caseId, goodsNo: value.candidate.sku, quantity: value.candidate.quantity,
        originalUtterance: value.candidate.readbackSentence,
        expectedProductName: value.candidate.readbackSentence,
        expectedSellerCode: value.candidate.merchantId,
        expectedTotalPriceKrw: value.candidate.totalPriceKrw,
        expectedPolicySnapshotHash: value.policySnapshotHash,
        recipient
      });
      if (result.status === 'TERMS_CHANGED') {
        await this.transition(caseId, 'NEEDS_CLARIFICATION', {});
        await this.phoneCases.save({ ...working, revision: working.revision + 1, status: 'NEEDS_CLARIFICATION', updatedAt: this.now() });
        return {
          caseId, state: 'NEEDS_CLARIFICATION', reason: 'ORDER_TERMS_CHANGED',
          message: '상품이나 가격이 바뀌어 주문하지 않았습니다. 상품을 다시 골라 주세요.'
        };
      }
      if (result.status === 'ORDER_RECONCILIATION_REQUIRED') {
        if (result.reason === 'IN_FLIGHT') {
          return {
            caseId, state: 'ORDER_SUBMITTING',
            message: '주문을 접수하고 있습니다. 잠시만 기다려 주세요.'
          };
        }
        await this.transition(caseId, 'ORDER_REVIEW_REQUIRED', {});
        await this.phoneCases.save({ ...working, revision: working.revision + 1, status: 'ORDER_REVIEW_REQUIRED', updatedAt: this.now() });
        return {
          caseId, state: 'ORDER_REVIEW_REQUIRED',
          message: '주문이 들어갔는지 확인하고 있습니다. 같은 주문을 다시 하지 않고 결과를 확인할게요.'
        };
      }
      await this.transition(caseId, 'ORDERED', { providerOrderId: result.externalOrderId });
      await this.phoneCases.save({
        ...working, revision: working.revision + 1, status: 'ORDERED', externalOrderId: result.externalOrderId, updatedAt: this.now()
      });
      return {
        caseId, state: 'ORDERED', externalOrderId: result.externalOrderId,
        message: '판매처에 주문이 바로 접수되었습니다.'
      };
    }
    await this.phoneCases.save({ ...working, revision: working.revision + 1, status: 'CONFIRMED', updatedAt: this.now() });
    return {
      caseId, state: 'CONFIRMED',
      message: working.callerHash
        ? '주문 기능이 연결되지 않아 주문하지 않았습니다.'
        : '시연용 지원금으로 확인한 흐름이라 실제 판매처에는 주문하지 않았습니다.'
    };
  }

  async status(caseId: string): Promise<Record<string, unknown>> {
    validateCaseId(caseId);
    const [value, phone] = await Promise.all([this.cases.get(caseId), this.phoneCases.get(caseId)]);
    if (!value || !phone) throw new PhoneFoodInputError('Case not found');
    return {
      caseId,
      state: value.state,
      phoneStatus: phone.status,
      ...(value.candidate ? { product: { name: value.candidate.readbackSentence, quantity: value.candidate.quantity, totalPriceKrw: value.candidate.totalPriceKrw } } : {}),
      ...(phone.budgetSource ? { budgetSource: phone.budgetSource } : {}),
      ...(phone.externalOrderId ? { externalOrderId: phone.externalOrderId } : {}),
      paymentExecuted: false,
      supplierOrderExecuted: Boolean(phone.externalOrderId)
    };
  }

  private async requireContext(caseId: string): Promise<PhoneFoodCase> {
    const value = await this.phoneCases.get(caseId);
    if (!value || !await this.cases.get(caseId)) throw new PhoneFoodInputError('Case not found');
    return value;
  }

  private async update(current: PhoneFoodCase, status: PhoneFoodCase['status'], candidates: FoodProduct[], state: CaseState): Promise<void> {
    await this.transition(current.caseId, state, {});
    await this.phoneCases.save({ ...current, revision: current.revision + 1, status, candidates, updatedAt: this.now() });
  }

  private async transition(caseId: string, next: CaseState, patch: Partial<BenefitCase>): Promise<void> {
    const value = await this.cases.get(caseId);
    if (!value) throw new PhoneFoodInputError('Case not found');
    if (value.state === next && Object.keys(patch).length === 0) return;
    await this.cases.transition(caseId, value.state, next, patch, this.now());
  }

  private async openCanonicalCase(caseId: string, callId: string): Promise<void> {
    const data: SafeEventData = {
      callIdHash: prefixedHash(callId),
      recordingMode: 'OFF',
      disclosureVersion: 'phone-disclosure-v1',
      evidenceClass: 'SYNTHETIC_DEMO'
    };
    if (await this.canonicalLedger.getAggregate(caseId)) {
      await this.assertCanonicalEventMatches(caseId, 'PHONE_CONNECTED', data, 'PHONE_PROVIDER', 'CLAWOPS');
      return;
    }
    const result = await this.canonicalLedger.openCase({
      caseId,
      type: 'PHONE_CONNECTED',
      at: this.now(),
      actor: 'PHONE_PROVIDER',
      source: 'CLAWOPS',
      idempotencyKey: `${caseId}:phone-connected:v1`,
      data
    });
    assertCanonicalAccepted(result.status, result.reasonCode);
  }

  private async advanceCanonicalOnce(
    caseId: string,
    type: CanonicalCaseState,
    data: SafeEventData,
    actor: Parameters<CanonicalCaseLedger['advance']>[0]['actor'],
    source: Parameters<CanonicalCaseLedger['advance']>[0]['source'],
    idempotencyKey: string
  ): Promise<void> {
    const aggregate = await this.canonicalLedger.getAggregate(caseId);
    if (!aggregate) throw new Error('Canonical phone case missing');
    const currentIndex = CANONICAL_CASE_STATES.indexOf(aggregate.currentState);
    const targetIndex = CANONICAL_CASE_STATES.indexOf(type);
    if (currentIndex >= targetIndex) {
      await this.assertCanonicalEventMatches(caseId, type, data, actor, source);
      return;
    }
    const result = await this.canonicalLedger.advance({
      caseId,
      type,
      at: this.now(),
      actor,
      source,
      idempotencyKey,
      expectedPreviousHash: aggregate.lastEventHash,
      data
    });
    assertCanonicalAccepted(result.status, result.reasonCode);
  }

  private async assertCanonicalEventMatches(
    caseId: string,
    type: CanonicalCaseState,
    data: SafeEventData,
    actor: Parameters<CanonicalCaseLedger['advance']>[0]['actor'],
    source: Parameters<CanonicalCaseLedger['advance']>[0]['source']
  ): Promise<void> {
    const existing = (await this.canonicalLedger.events(caseId)).find(event => event.type === type);
    if (!existing || existing.actor !== actor || existing.source !== source || canonicalJson(existing.data) !== canonicalJson(data)) {
      throw new PhoneFoodInputError(`Canonical ${type} conflicts with the existing case evidence`);
    }
  }
}

export class PhoneFoodInputError extends Error {}

function validateCaseId(value: string): void {
  if (!/^food_[a-f0-9]{24}$/.test(value)) throw new PhoneFoodInputError('Invalid caseId');
}

function prefixedHash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function normalizeHash(value: string): string {
  return value.startsWith('sha256:') ? value : `sha256:${value}`;
}

function assertCanonicalAccepted(status: string, reasonCode: string | undefined): void {
  if (!['ACCEPTED', 'REPLAYED'].includes(status)) throw new Error(`Canonical case ledger rejected phone event: ${reasonCode ?? 'UNKNOWN'}`);
}
