import { createHash, createHmac } from 'node:crypto';
import type { CaseRepository } from './caseRepository.ts';
import type { MerchantAdapter } from './merchantAdapter.ts';
import type { BenefitCase, CatalogItem, InterpretedPurchase, PurchaseCandidate } from './types.ts';
import { DEMO_ASSISTIVE_CATALOG } from './catalog/demoAssistiveCatalog.ts';
import { DISABILITY_PERSONAL_BUDGET_PROGRAM, SYNTHETIC_ENROLLMENT } from './programs/disabilityPersonalBudget.ts';
import { detectHighRiskCategory, evaluatePurchasePolicy } from './policyEngine.ts';

const CONFIRMATION_TTL_MS = 60_000;

export interface AudioPurchaseInterpreter {
  analyzeAudio(bytes: Uint8Array, mimeType: string): Promise<InterpretedPurchase>;
}

export interface PaymentExecutor {
  authorize(input: {
    caseId: string;
    sku: string;
    merchantId: string;
    amountKrw: number;
    confirmationCommitment: string;
  }): Promise<{
    paymentAuthorizationId: string;
    paymentReference: string;
    authorizedAmountKrw: number;
  }>;
}

export class CaseCoordinator {
  constructor(
    private readonly repo: CaseRepository,
    private readonly interpreter: AudioPurchaseInterpreter,
    private readonly payment: PaymentExecutor,
    private readonly merchant: MerchantAdapter,
    private readonly now: () => number = Date.now,
    private readonly hmacSecret = 'synthetic-demo-only'
  ) {}

  async beginCall(callSid: string): Promise<BenefitCase> {
    const at = this.now();
    const callSidHash = createHmac('sha256', this.hmacSecret).update(callSid).digest('hex');
    const caseId = `case_${callSidHash.slice(0, 24)}`;
    const existing = await this.repo.get(caseId);
    if (existing) return existing;
    const value: BenefitCase = {
      caseId,
      callSidHash,
      beneficiaryRef: SYNTHETIC_ENROLLMENT.beneficiaryRef,
      programId: DISABILITY_PERSONAL_BUDGET_PROGRAM.programId,
      planId: SYNTHETIC_ENROLLMENT.planId,
      state: 'CALL_CONNECTED',
      createdAt: at,
      updatedAt: at
    };
    try {
      await this.repo.create(value);
      return value;
    } catch (error) {
      const raced = await this.repo.get(caseId);
      if (raced) return raced;
      throw error;
    }
  }

  async capture(callSid: string, audio: Uint8Array, mimeType: string): Promise<BenefitCase> {
    const started = await this.beginCall(callSid);
    if (started.state !== 'CALL_CONNECTED') return started;
    const caseId = started.caseId;
    const audioDigest = createHash('sha256').update(audio).digest('hex');
    await this.repo.transition(caseId, 'CALL_CONNECTED', 'AUDIO_CAPTURED', {}, this.now());

    let interpretation: InterpretedPurchase;
    try {
      interpretation = await this.interpreter.analyzeAudio(audio, mimeType);
    } catch {
      return this.repo.transition(caseId, 'AUDIO_CAPTURED', 'NEEDS_CLARIFICATION', {}, this.now());
    }
    return this.submitInterpretation(caseId, interpretation);
  }

  async submitInterpretation(caseId: string, interpretation: InterpretedPurchase): Promise<BenefitCase> {
    const current = await this.requireCase(caseId);
    if (current.state !== 'CALL_CONNECTED' && current.state !== 'AUDIO_CAPTURED') return current;
    if (current.state === 'CALL_CONNECTED') {
      await this.repo.transition(caseId, 'CALL_CONNECTED', 'AUDIO_CAPTURED', {}, this.now());
    }
    const highRiskCategory = detectHighRiskCategory([
      interpretation.verbatimUserRequest ?? '',
      interpretation.safeUserSummary,
      interpretation.requestedCategory,
      interpretation.requestedSku
    ].join(' '));
    const requestedCategory = highRiskCategory ?? interpretation.requestedCategory;
    const requestedSku = highRiskCategory ? `BLOCKED_${highRiskCategory}` : interpretation.requestedSku;
    const found = DEMO_ASSISTIVE_CATALOG.find(item => item.sku === requestedSku);
    const catalogItem: CatalogItem = found ?? {
      sku: requestedSku,
      category: requestedCategory,
      merchantId: 'DEMO_ACCESS_STORE',
      productName: '승인되지 않은 요청 항목',
      unitPriceKrw: 0,
      deliveryAvailable: true
    };
    const candidate: PurchaseCandidate = {
      caseId,
      sku: requestedSku,
      category: requestedCategory,
      quantity: interpretation.quantity,
      merchantId: catalogItem.merchantId,
      unitPriceKrw: catalogItem.unitPriceKrw,
      totalPriceKrw: catalogItem.unitPriceKrw * interpretation.quantity,
      programAmountKrw: catalogItem.unitPriceKrw * interpretation.quantity,
      substitutionsAllowed: interpretation.substitutionsAllowed,
      confidence: interpretation.confidence,
      ambiguityReasons: interpretation.ambiguityReasons,
      readbackSentence: `${catalogItem.productName} ${interpretation.quantity}개, 총 ${catalogItem.unitPriceKrw * interpretation.quantity}원, 등록된 배송지로 주문합니다.`
    };
    await this.repo.transition(caseId, 'AUDIO_CAPTURED', 'INTERPRETED', { candidate }, this.now());
    if (!highRiskCategory && (interpretation.confidence < 0.9 || interpretation.ambiguityReasons.length > 0 || interpretation.quantity < 1)) {
      return this.repo.transition(caseId, 'INTERPRETED', 'NEEDS_CLARIFICATION', {}, this.now());
    }
    await this.repo.transition(caseId, 'INTERPRETED', 'POLICY_CHECKING', {}, this.now());
    const policy = evaluatePurchasePolicy({
      program: DISABILITY_PERSONAL_BUDGET_PROGRAM,
      enrollment: SYNTHETIC_ENROLLMENT,
      candidate,
      catalogItem,
      now: this.now(),
      expectedPlanRevision: 1,
      duplicate: false
    });
    if (policy.decision === 'BLOCKED') {
      return this.repo.transition(caseId, 'POLICY_CHECKING', 'POLICY_BLOCKED', {
        policy,
        policySnapshotHash: policy.policySnapshotHash
      }, this.now());
    }
    const confirmationExpiresAt = this.now() + CONFIRMATION_TTL_MS;
    return this.repo.transition(caseId, 'POLICY_CHECKING', 'AWAITING_CONFIRMATION', {
      policy,
      policySnapshotHash: policy.policySnapshotHash,
      confirmationExpiresAt
    }, this.now());
  }

  async confirm(caseId: string, digit: string): Promise<BenefitCase> {
    const current = await this.requireCase(caseId);
    if (current.state === 'ORDERED' || current.state === 'POLICY_BLOCKED' || current.state === 'USER_REJECTED') return current;
    if (current.state !== 'AWAITING_CONFIRMATION') return current;
    if (current.confirmationExpiresAt === undefined || this.now() > current.confirmationExpiresAt) {
      return this.repo.transition(caseId, 'AWAITING_CONFIRMATION', 'CONFIRMATION_EXPIRED', {}, this.now());
    }
    if (digit !== '1') {
      return this.repo.transition(caseId, 'AWAITING_CONFIRMATION', digit === '2' ? 'USER_REJECTED' : 'CONFIRMATION_EXPIRED', {}, this.now());
    }
    const commitment = createHash('sha256').update(JSON.stringify({
      version: 'benefit-consent-v1',
      caseId,
      candidate: current.candidate,
      policySnapshotHash: current.policySnapshotHash,
      confirmationExpiresAt: current.confirmationExpiresAt
    })).digest('hex');
    const consumed = await this.repo.consumeConfirmation(caseId, commitment, this.now());
    if (!consumed) return this.requireCase(caseId);
    const confirmed = await this.requireCase(caseId);
    const candidate = confirmed.candidate;
    if (!candidate) throw new Error('Confirmed case has no candidate');
    await this.repo.transition(caseId, 'CONFIRMED', 'PAYMENT_AUTHORIZING', {}, this.now());
    await this.repo.transition(caseId, 'PAYMENT_AUTHORIZING', 'PAYMENT_REQUIRED', {}, this.now());
    let payment;
    try {
      payment = await this.payment.authorize({
        caseId,
        sku: candidate.sku,
        merchantId: candidate.merchantId,
        amountKrw: candidate.programAmountKrw,
        confirmationCommitment: commitment
      });
    } catch {
      return this.repo.transition(caseId, 'PAYMENT_REQUIRED', 'PAYMENT_FAILED', {}, this.now());
    }
    await this.repo.transition(caseId, 'PAYMENT_REQUIRED', 'PAID', payment, this.now());
    await this.repo.transition(caseId, 'PAID', 'ORDER_SUBMITTING', {}, this.now());
    return this.submitOrder(caseId, candidate, payment.paymentAuthorizationId);
  }

  async recoverOrder(caseId: string): Promise<BenefitCase> {
    const current = await this.requireCase(caseId);
    if (current.state === 'ORDERED') return current;
    if (current.state !== 'ORDER_REVIEW_REQUIRED') return current;
    if (!current.candidate || !current.paymentAuthorizationId) throw new Error('Paid case has no recoverable order context');
    await this.repo.transition(caseId, 'ORDER_REVIEW_REQUIRED', 'ORDER_SUBMITTING', {}, this.now());
    return this.submitOrder(caseId, current.candidate, current.paymentAuthorizationId);
  }

  private async submitOrder(caseId: string, candidate: PurchaseCandidate, paymentAuthorizationId: string): Promise<BenefitCase> {
    try {
      const order = await this.merchant.submit({
        caseId,
        sku: candidate.sku,
        quantity: candidate.quantity,
        merchantId: candidate.merchantId,
        programAmountKrw: candidate.programAmountKrw,
        paymentAuthorizationId
      });
      return this.repo.transition(caseId, 'ORDER_SUBMITTING', 'ORDERED', order, this.now());
    } catch {
      return this.repo.transition(caseId, 'ORDER_SUBMITTING', 'ORDER_REVIEW_REQUIRED', {}, this.now());
    }
  }

  private async requireCase(caseId: string): Promise<BenefitCase> {
    const value = await this.repo.get(caseId);
    if (!value) throw new Error('Case not found');
    return value;
  }
}
