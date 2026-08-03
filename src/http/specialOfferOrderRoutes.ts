import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { buildFoodOrderConsent, evaluateFoodSupportPolicy } from '../food-support/policy.ts';
import type { FoodBudgetProvider } from '../food-support/budgetProvider.ts';
import {
  HmacPaidActionApprovalVerifier,
  type SpecialOfferCatalogAdapter,
  type SpecialOfferOrderAdapter,
  type SpecialOfferOrderInput,
  type SpecialOfferRecipient
} from '../food-support/specialOffer.ts';
import {
  newApprovalRequestId,
  publicApprovalRequest,
  type ApprovalRequestCipher,
  type ApprovalRequestRepository
} from '../food-support/approvalRequests.ts';
import type { FoodBudgetLedger, FoodBudgetScope } from '../food-support/budgetLedger.ts';
import type { ExternalOrderReadback, FoodSupportBudget } from '../food-support/types.ts';

export interface SpecialOfferOrderRouteRequest {
  method: string;
  pathname: string;
  body?: Record<string, unknown>;
  authorization?: string;
}

export interface SpecialOfferOrderRouteResponse {
  status: number;
  body: unknown;
}

export class SpecialOfferOrderInputError extends Error {}

export function createSpecialOfferOrderHandlers(input: {
  catalog: SpecialOfferCatalogAdapter;
  budgets: FoodBudgetProvider;
  orders: SpecialOfferOrderAdapter;
  paidApprovals: HmacPaidActionApprovalVerifier;
  operatorSecret: string;
  validateSession: (caseId: string, token: string | undefined) => Promise<boolean>;
  isDuplicateCase: (caseId: string) => Promise<boolean>;
  authorizeOperator?: (authorization: string | undefined, caseId: string, accessLevel: 'read' | 'act') => boolean;
  approvalRequests?: ApprovalRequestRepository;
  approvalCipher?: ApprovalRequestCipher;
  budgetLedger?: FoodBudgetLedger;
  resolveBudgetScope?: (caseId: string) => Promise<FoodBudgetScope | undefined>;
  rollupOrder?: (input: { prepared: PreparedOrder; order: ExternalOrderReadback; at: number }) => Promise<void>;
  rollupReconciledOrder?: (input: { caseId: string; order: ExternalOrderReadback; at: number }) => Promise<void>;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const handle = async (request: SpecialOfferOrderRouteRequest): Promise<SpecialOfferOrderRouteResponse> => {
    if (request.method === 'POST' && request.pathname === '/api/food-support/order-preview') {
      const prepared = await prepareOrder(request.body, input, now());
      const result = await input.orders.submit(prepared);
      if (result.status !== 'PAID_ACTION_REQUIRED') throw new Error('Order preview unexpectedly executed a paid action');
      return {
        status: 200,
        body: {
          ...result,
          policySnapshotHash: prepared.policyDecision.policySnapshotHash,
          consentExpiresAt: prepared.consent.expiresAt,
          previewProof: signPreview(input.operatorSecret, prepared.caseId, prepared.consent.commitment, result.preview.totalPriceKrw, prepared.consent.expiresAt)
        }
      };
    }
    if (request.method === 'POST' && request.pathname === '/api/food-support/order-submit') {
      const caseId = requiredIdentifier(request.body?.caseId, 'caseId');
      if (!validBearer(request.authorization, input.operatorSecret) && !input.authorizeOperator?.(request.authorization, caseId, 'act')) {
        return { status: 401, body: { error: 'Unauthorized paid action' } };
      }
      const submittedAt = now();
      const expectedConsentExpiresAt = requiredInteger(request.body?.expectedConsentExpiresAt, 'expectedConsentExpiresAt', submittedAt + 1, submittedAt + 10 * 60_000);
      const expectedCommitment = requiredText(request.body?.expectedConsentCommitment, 'expectedConsentCommitment', 64);
      const expectedTotalKrw = requiredInteger(request.body?.expectedTotalKrw, 'expectedTotalKrw', 1, 100_000_000);
      const previewProof = requiredText(request.body?.previewProof, 'previewProof', 64);
      if (!validPreviewProof(input.operatorSecret, previewProof, caseId, expectedCommitment, expectedTotalKrw, expectedConsentExpiresAt)) {
        return { status: 409, body: { error: 'Invalid or changed order preview' } };
      }
      const prepared = await prepareOrder(request.body, input, submittedAt, expectedConsentExpiresAt);
      if (prepared.consent.commitment !== expectedCommitment
        || prepared.product.unitPriceKrw * prepared.quantity + prepared.product.shippingFeeKrw !== expectedTotalKrw) {
        return { status: 409, body: { error: 'Order terms changed; preview again' } };
      }
      if (input.budgetLedger) {
        const reservation = await input.budgetLedger.get(caseId);
        if (!reservation || reservation.status !== 'RESERVED' || reservation.fingerprint !== budgetFingerprint(prepared)) {
          return { status: 409, body: { error: 'Active case budget reservation required' } };
        }
      }
      const approval = input.paidApprovals.issue(prepared, prepared.now + 60_000);
      const result = await input.orders.submit({ ...prepared, paidActionApproval: approval });
      const fingerprint = budgetFingerprint(prepared);
      if (result.status === 'SUBMITTED') {
        await input.budgetLedger?.commit(caseId, fingerprint, now());
        await input.rollupOrder?.({ prepared, order: result.order, at: now() });
      } else if (result.status !== 'ORDER_RECONCILIATION_REQUIRED') {
        await input.budgetLedger?.release(caseId, fingerprint, now());
      }
      return {
        status: result.status === 'SUBMITTED' ? 201 : 409,
        body: result.status === 'SUBMITTED'
          ? { ...result, orderAccess: issueOrderAccess(input.operatorSecret, prepared.caseId, result.order.externalOrderId, submittedAt + 30 * 24 * 60 * 60_000) }
          : result
      };
    }
    if (request.method === 'POST' && request.pathname === '/api/food-support/order-submit-direct') {
      const caseId = requiredIdentifier(request.body?.caseId, 'caseId');
      if (!validBearer(request.authorization, input.operatorSecret)) {
        return { status: 401, body: { error: 'Unauthorized direct order' } };
      }
      const submittedAt = now();
      const expectedConsentExpiresAt = requiredInteger(request.body?.expectedConsentExpiresAt, 'expectedConsentExpiresAt', submittedAt + 1, submittedAt + 10 * 60_000);
      const expectedCommitment = requiredText(request.body?.expectedConsentCommitment, 'expectedConsentCommitment', 64);
      const expectedTotalKrw = requiredInteger(request.body?.expectedTotalKrw, 'expectedTotalKrw', 1, 100_000_000);
      const previewProof = requiredText(request.body?.previewProof, 'previewProof', 64);
      if (!validPreviewProof(input.operatorSecret, previewProof, caseId, expectedCommitment, expectedTotalKrw, expectedConsentExpiresAt)) {
        return { status: 409, body: { error: 'Invalid or changed order preview' } };
      }
      const prepared = await prepareOrder(request.body, input, submittedAt, expectedConsentExpiresAt);
      const totalKrw = prepared.product.unitPriceKrw * prepared.quantity + prepared.product.shippingFeeKrw;
      if (prepared.consent.commitment !== expectedCommitment || totalKrw !== expectedTotalKrw) {
        return { status: 409, body: { error: 'Order terms changed; preview again' } };
      }
      const fingerprint = budgetFingerprint(prepared);
      if (input.budgetLedger) {
        const scope = await input.resolveBudgetScope?.(caseId);
        if (!scope) throw new SpecialOfferOrderInputError('Budget scope unavailable');
        const reserved = await input.budgetLedger.reserve({
          caseId, scope, allocationKrw: prepared.budget.remainingKrw,
          amountKrw: totalKrw, fingerprint, now: submittedAt
        });
        if (reserved.status === 'INSUFFICIENT') throw new SpecialOfferOrderInputError('Budget balance unavailable');
        if (reserved.status === 'CONFLICT') throw new SpecialOfferOrderInputError('Case already controls another budget reservation');
      }
      const approval = input.paidApprovals.issue(prepared, prepared.now + 60_000);
      const result = await input.orders.submit({ ...prepared, paidActionApproval: approval });
      if (result.status === 'SUBMITTED') {
        await input.budgetLedger?.commit(caseId, fingerprint, now());
        await input.rollupOrder?.({ prepared, order: result.order, at: now() });
      } else if (result.status !== 'ORDER_RECONCILIATION_REQUIRED') {
        await input.budgetLedger?.release(caseId, fingerprint, now());
      }
      return {
        status: result.status === 'SUBMITTED' ? 201 : 409,
        body: result.status === 'SUBMITTED'
          ? { ...result, orderAccess: issueOrderAccess(input.operatorSecret, caseId, result.order.externalOrderId, submittedAt + 30 * 24 * 60 * 60_000) }
          : result
      };
    }
    if (request.method === 'POST' && request.pathname === '/api/food-support/approval-request') {
      if (!input.approvalRequests || !input.approvalCipher) return { status: 503, body: { error: 'Approval inbox is not configured' } };
      const submittedAt = now();
      const caseId = requiredIdentifier(request.body?.caseId, 'caseId');
      const expectedConsentExpiresAt = requiredInteger(request.body?.expectedConsentExpiresAt, 'expectedConsentExpiresAt', submittedAt + 1, submittedAt + 10 * 60_000);
      const expectedCommitment = requiredText(request.body?.expectedConsentCommitment, 'expectedConsentCommitment', 64);
      const expectedTotalKrw = requiredInteger(request.body?.expectedTotalKrw, 'expectedTotalKrw', 1, 100_000_000);
      const previewProof = requiredText(request.body?.previewProof, 'previewProof', 64);
      if (!validPreviewProof(input.operatorSecret, previewProof, caseId, expectedCommitment, expectedTotalKrw, expectedConsentExpiresAt)) {
        return { status: 409, body: { error: 'Invalid or changed order preview' } };
      }
      const prepared = await prepareOrder(request.body, input, submittedAt, expectedConsentExpiresAt);
      if (prepared.consent.commitment !== expectedCommitment
        || prepared.product.unitPriceKrw * prepared.quantity + prepared.product.shippingFeeKrw !== expectedTotalKrw) {
        return { status: 409, body: { error: 'Order terms changed; preview again' } };
      }
      const value = await createApproval(prepared, request.body ?? {}, input, submittedAt);
      return { status: 201, body: publicApprovalRequest(value) };
    }
    if (request.method === 'POST' && request.pathname === '/api/food-support/approval-refresh-preview') {
      if (!input.approvalRequests || !input.approvalCipher) return { status: 503, body: { error: 'Approval inbox is not configured' } };
      const requestId = requiredApprovalId(request.body?.requestId);
      const current = await input.approvalRequests.get(requestId);
      if (!current || current.status !== 'PENDING') return { status: 409, body: { error: 'Approval request cannot be refreshed' } };
      const payload = input.approvalCipher.decrypt(current.encryptedPayload);
      const sessionAccessToken = requiredText(request.body?.sessionAccessToken, 'sessionAccessToken', 2048);
      const refreshedAt = now();
      const prepared = await prepareOrder({ ...payload, sessionAccessToken }, input, refreshedAt);
      const preview = input.orders.preview(prepared);
      return { status: 200, body: {
        status: 'REFRESH_RECONFIRMATION_REQUIRED', replacesRequestId: requestId, preview,
        consentExpiresAt: prepared.consent.expiresAt,
        previewProof: signPreview(input.operatorSecret, prepared.caseId, prepared.consent.commitment, preview.totalPriceKrw, prepared.consent.expiresAt)
      } };
    }
    if (request.method === 'POST' && request.pathname === '/api/food-support/approval-refresh-confirm') {
      if (!input.approvalRequests || !input.approvalCipher) return { status: 503, body: { error: 'Approval inbox is not configured' } };
      if (request.body?.userReconfirmed !== true) return { status: 409, body: { error: 'Fresh user reconfirmation is required' } };
      const requestId = requiredApprovalId(request.body?.requestId);
      const current = await input.approvalRequests.get(requestId);
      if (!current || current.status !== 'PENDING') return { status: 409, body: { error: 'Approval request cannot be refreshed' } };
      const payload = input.approvalCipher.decrypt(current.encryptedPayload);
      const refreshedAt = now();
      const expectedConsentExpiresAt = requiredInteger(request.body?.expectedConsentExpiresAt, 'expectedConsentExpiresAt', refreshedAt + 1, refreshedAt + 10 * 60_000);
      const expectedCommitment = requiredText(request.body?.expectedConsentCommitment, 'expectedConsentCommitment', 64);
      const expectedTotalKrw = requiredInteger(request.body?.expectedTotalKrw, 'expectedTotalKrw', 1, 100_000_000);
      const previewProof = requiredText(request.body?.previewProof, 'previewProof', 64);
      const sessionAccessToken = requiredText(request.body?.sessionAccessToken, 'sessionAccessToken', 2048);
      if (!validPreviewProof(input.operatorSecret, previewProof, current.caseId, expectedCommitment, expectedTotalKrw, expectedConsentExpiresAt)) {
        return { status: 409, body: { error: 'Invalid or changed refresh preview' } };
      }
      const refreshedPayload = { ...payload, sessionAccessToken, expectedConsentExpiresAt, expectedConsentCommitment: expectedCommitment, expectedTotalKrw, previewProof };
      const prepared = await prepareOrder(refreshedPayload, input, refreshedAt, expectedConsentExpiresAt);
      if (prepared.consent.commitment !== expectedCommitment || prepared.product.unitPriceKrw * prepared.quantity + prepared.product.shippingFeeKrw !== expectedTotalKrw) {
        return { status: 409, body: { error: 'Order terms changed; refresh again' } };
      }
      const replacement = await createApproval(prepared, refreshedPayload, input, refreshedAt);
      await input.approvalRequests.update(requestId, 'PENDING', { status: 'REPLACED', replacedByRequestId: replacement.requestId, updatedAt: refreshedAt });
      return { status: 201, body: { request: publicApprovalRequest(replacement), replacedRequestId: requestId } };
    }
    if (request.method === 'POST' && request.pathname === '/api/food-support/approval-list') {
      if (!input.approvalRequests) return { status: 503, body: { error: 'Approval inbox is not configured' } };
      const caseId = requiredIdentifier(request.body?.caseId, 'caseId');
      if (!input.authorizeOperator?.(request.authorization, caseId, 'read')) return { status: 401, body: { error: 'Unauthorized approval inbox' } };
      return { status: 200, body: { caseId, requests: (await input.approvalRequests.list(caseId)).map(publicApprovalRequest) } };
    }
    if (request.method === 'POST' && request.pathname === '/api/food-support/approval-execute') {
      if (!input.approvalRequests || !input.approvalCipher) return { status: 503, body: { error: 'Approval inbox is not configured' } };
      const caseId = requiredIdentifier(request.body?.caseId, 'caseId');
      if (!input.authorizeOperator?.(request.authorization, caseId, 'act')) return { status: 401, body: { error: 'Unauthorized approval execution' } };
      const requestId = requiredApprovalId(request.body?.requestId);
      const approval = await input.approvalRequests.get(requestId);
      if (!approval || approval.caseId !== caseId) return { status: 404, body: { error: 'Approval request not found' } };
      if (approval.status !== 'PENDING') return { status: 409, body: { error: 'Approval request is no longer pending', request: publicApprovalRequest(approval) } };
      const payload = input.approvalCipher.decrypt(approval.encryptedPayload);
      const executionAt = now();
      if (payload.caseId !== approval.caseId
        || payload.goodsNo !== approval.goodsNo
        || payload.quantity !== approval.quantity
        || payload.expectedConsentCommitment !== approval.consentCommitment
        || payload.expectedConsentExpiresAt !== approval.consentExpiresAt
        || payload.expectedTotalKrw !== approval.totalPriceKrw) {
        return { status: 409, body: { error: 'Encrypted approval payload does not match request metadata' } };
      }
      const result = await handle({ method: 'POST', pathname: '/api/food-support/order-submit', authorization: `Bearer ${input.operatorSecret}`, body: payload });
      const resultBody = result.body as { status?: string; order?: { externalOrderId?: string } };
      const status = result.status === 201 ? 'SUBMITTED'
        : resultBody.status === 'ORDER_RECONCILIATION_REQUIRED' ? 'RECONCILIATION_REQUIRED' : 'FAILED';
      const updated = await input.approvalRequests.update(requestId, 'PENDING', {
        status, updatedAt: now(), ...(resultBody.order?.externalOrderId ? { externalOrderId: resultBody.order.externalOrderId } : {})
      });
      return { status: result.status, body: { result: result.body, request: publicApprovalRequest(updated) } };
    }
    if (request.method === 'POST' && request.pathname === '/api/food-support/order-reconcile') {
      const caseId = requiredIdentifier(request.body?.caseId, 'caseId');
      if (!input.authorizeOperator?.(request.authorization, caseId, 'act')) return { status: 401, body: { error: 'Unauthorized order reconciliation' } };
      if (!input.approvalRequests || !input.approvalCipher) return { status: 503, body: { error: 'Approval inbox is not configured' } };
      const requestId = requiredApprovalId(request.body?.requestId);
      const approval = await input.approvalRequests.get(requestId);
      if (!approval || approval.caseId !== caseId || approval.status !== 'RECONCILIATION_REQUIRED') return { status: 409, body: { error: 'Approval is not awaiting reconciliation' } };
      const orderId = requiredIdentifier(request.body?.orderId, 'orderId');
      const result = await input.orders.reconcile({ caseId, orderId, now: now() });
      if (result.status !== 'COMPLETED') return { status: result.status === 'NOT_READY' ? 425 : 409, body: result };
      const payload = input.approvalCipher.decrypt(approval.encryptedPayload);
      const prepared = await prepareOrder(payload, input, Number(payload.expectedConsentExpiresAt) - 1, Number(payload.expectedConsentExpiresAt));
      await input.budgetLedger?.commit(caseId, budgetFingerprint(prepared), now());
      await input.rollupOrder?.({ prepared, order: result.order, at: now() });
      const updated = await input.approvalRequests.update(requestId, 'RECONCILIATION_REQUIRED', {
        status: 'SUBMITTED', externalOrderId: result.order.externalOrderId, updatedAt: now()
      });
      return { status: 200, body: { result, request: publicApprovalRequest(updated) } };
    }
    if (request.method === 'POST' && request.pathname === '/api/food-support/order-reconcile-direct') {
      const caseId = requiredIdentifier(request.body?.caseId, 'caseId');
      if (!validBearer(request.authorization, input.operatorSecret)
        && !input.authorizeOperator?.(request.authorization, caseId, 'act')) {
        return { status: 401, body: { error: 'Unauthorized direct order reconciliation' } };
      }
      if (!input.budgetLedger || !input.rollupReconciledOrder) {
        return { status: 503, body: { error: 'Direct order reconciliation is not configured' } };
      }
      const orderId = requiredIdentifier(request.body?.orderId, 'orderId');
      const result = await input.orders.reconcile({ caseId, orderId, now: now() });
      if (result.status !== 'COMPLETED') {
        return {
          status: result.status === 'NOT_READY' ? 425 : result.status === 'CREDENTIAL_GATED' ? 503 : 409,
          body: result
        };
      }
      const reservation = await input.budgetLedger.get(caseId);
      if (!reservation || reservation.status === 'RELEASED') {
        return { status: 409, body: { error: 'Direct order budget reservation is unavailable' } };
      }
      await input.budgetLedger.commit(caseId, reservation.fingerprint, now());
      await input.rollupReconciledOrder({ caseId, order: result.order, at: now() });
      return { status: 200, body: result };
    }
    if (request.method === 'POST' && request.pathname === '/api/food-support/order-access') {
      const caseId = requiredIdentifier(request.body?.caseId, 'caseId');
      if (!validBearer(request.authorization, input.operatorSecret) && !input.authorizeOperator?.(request.authorization, caseId, 'act')) {
        return { status: 401, body: { error: 'Unauthorized order access issuance' } };
      }
      const orderId = requiredIdentifier(request.body?.orderId, 'orderId');
      const completed = await input.orders.getCompletedByCaseId(caseId);
      if (!completed || completed.externalOrderId !== orderId) return { status: 404, body: { error: 'Completed order not found for case' } };
      return { status: 200, body: { caseId, orderId, orderAccess: issueOrderAccess(input.operatorSecret, caseId, orderId, now() + 30 * 24 * 60 * 60_000) } };
    }
    if (request.method === 'POST' && request.pathname === '/api/food-support/order-status') {
      const orderId = requiredIdentifier(request.body?.orderId, 'orderId');
      const accessToken = optionalText(request.body?.orderAccessToken, 'orderAccessToken', 2048);
      const orderAccess = accessToken ? verifyOrderAccess(input.operatorSecret, accessToken, orderId, now()) : undefined;
      if (!validBearer(request.authorization, input.operatorSecret) && !orderAccess) return { status: 401, body: { error: 'Unauthorized order status' } };
      const result = await input.orders.getByOrderId(orderId);
      return {
        status: result.status === 'LIVE' ? 200 : 503,
        body: result.status === 'LIVE' && orderAccess ? { ...result, caseId: orderAccess.caseId } : result
      };
    }
    return { status: 404, body: { error: 'Not found' } };
  };
  return handle;
}

async function prepareOrder(
  body: Record<string, unknown> | undefined,
  services: Parameters<typeof createSpecialOfferOrderHandlers>[0],
  now: number,
  consentExpiresAt = now + 10 * 60_000
): Promise<PreparedOrder> {
  const caseId = requiredIdentifier(body?.caseId, 'caseId');
  const sessionAccessToken = optionalText(body?.sessionAccessToken, 'sessionAccessToken', 2048);
  if (!await services.validateSession(caseId, sessionAccessToken || undefined)) throw new SpecialOfferOrderInputError('Invalid or expired food session');
  const goodsNo = requiredIdentifier(body?.goodsNo, 'goodsNo');
  const quantity = requiredInteger(body?.quantity, 'quantity', 1, 100);
  const originalUtterance = requiredText(body?.originalUtterance, 'originalUtterance', 1000);
  const recipient = parseRecipient(body?.recipient);
  const [catalogResult, budget, duplicateCase] = await Promise.all([
    services.catalog.get(goodsNo), services.budgets.get(caseId), services.isDuplicateCase(caseId)
  ]);
  if (catalogResult.status !== 'LIVE') throw new SpecialOfferOrderInputError('Supplier credential unavailable');
  if (!budget) throw new SpecialOfferOrderInputError('Case budget unavailable');
  const product = catalogResult.product;
  const policyDecision = evaluateFoodSupportPolicy({
    lines: [{ lineId: 'order', product, quantity, quotedUnitPriceKrw: product.unitPriceKrw }],
    budget, originalUtterance, duplicateCase
  });
  if (policyDecision.decision !== 'APPROVED') throw new SpecialOfferOrderInputError(`Policy decision is ${policyDecision.decision}`);
  const totalPriceKrw = product.unitPriceKrw * quantity + product.shippingFeeKrw;
  const consent = buildFoodOrderConsent({
    caseId, goodsNo: product.goodsNo, sellerCode: product.sellerCode, quantity,
    unitPriceKrw: product.unitPriceKrw, shippingFeeKrw: product.shippingFeeKrw, totalPriceKrw,
    recipientToken: recipient.recipientToken, policySnapshotHash: policyDecision.policySnapshotHash,
    expiresAt: consentExpiresAt
  });
  return { caseId, product, quantity, shippingFeePayment: 0, recipient, consent, policyDecision, budget, now };
}

export type PreparedOrder = Omit<SpecialOfferOrderInput, 'paidActionApproval'> & { budget: FoodSupportBudget };

async function createApproval(
  prepared: PreparedOrder,
  payload: Record<string, unknown>,
  services: Parameters<typeof createSpecialOfferOrderHandlers>[0],
  at: number
) {
  if (!services.approvalRequests || !services.approvalCipher) throw new Error('Approval inbox is not configured');
  const preview = services.orders.preview(prepared);
  if (services.budgetLedger) {
    const scope = await services.resolveBudgetScope?.(prepared.caseId);
    if (!scope) throw new SpecialOfferOrderInputError('Budget scope unavailable');
    const reserved = await services.budgetLedger.reserve({
      caseId: prepared.caseId, scope, allocationKrw: prepared.budget.remainingKrw,
      amountKrw: preview.totalPriceKrw, fingerprint: budgetFingerprint(prepared), now: at
    });
    if (reserved.status === 'INSUFFICIENT') throw new SpecialOfferOrderInputError('Budget balance unavailable');
    if (reserved.status === 'CONFLICT') throw new SpecialOfferOrderInputError('Case already controls another budget reservation');
  }
  const value = {
    requestId: newApprovalRequestId(), caseId: prepared.caseId, status: 'PENDING' as const,
    productName: preview.productName, goodsNo: preview.goodsNo, quantity: preview.quantity,
    totalPriceKrw: preview.totalPriceKrw, consentCommitment: preview.consentCommitment,
    consentExpiresAt: prepared.consent.expiresAt, maskedRecipient: preview.maskedRecipient,
    maskedPhone: preview.maskedPhone, maskedAddress: preview.maskedAddress,
    encryptedPayload: services.approvalCipher.encrypt(payload), createdAt: at, updatedAt: at
  };
  await services.approvalRequests.create(value);
  return value;
}

function budgetFingerprint(prepared: PreparedOrder): string {
  return createHash('sha256').update(JSON.stringify({
    version: 'food-budget-reservation-v1', caseId: prepared.caseId, goodsNo: prepared.product.goodsNo,
    sellerCode: prepared.product.sellerCode, quantity: prepared.quantity,
    totalPriceKrw: prepared.product.unitPriceKrw * prepared.quantity + prepared.product.shippingFeeKrw,
    recipientToken: prepared.recipient.recipientToken, policySnapshotHash: prepared.policyDecision.policySnapshotHash
  })).digest('hex');
}

function parseRecipient(value: unknown): SpecialOfferRecipient {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SpecialOfferOrderInputError('Invalid recipient');
  const input = value as Record<string, unknown>;
  const name = requiredText(input.name, 'recipient.name', 100);
  const cellphone = requiredText(input.cellphone, 'recipient.cellphone', 30);
  const zip = requiredText(input.zip, 'recipient.zip', 20);
  const address = requiredText(input.address, 'recipient.address', 300);
  const telephone = optionalText(input.telephone, 'recipient.telephone', 30) || cellphone;
  const memo = optionalText(input.memo, 'recipient.memo', 200);
  const recipientToken = createHash('sha256').update(JSON.stringify({ name, cellphone, zip, address })).digest('hex');
  return { name, cellphone, telephone, zip, address, recipientToken, ...(memo ? { memo } : {}) };
}

function validBearer(value: string | undefined, expected: string): boolean {
  const supplied = value?.startsWith('Bearer ') ? value.slice(7) : '';
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export function issueOrderAccess(secret: string, caseId: string, orderId: string, expiresAt: number): { token: string; expiresAt: number } {
  const payload = Buffer.from(JSON.stringify({ version: 'special-offer-order-access-v1', caseId, orderId, expiresAt })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, expiresAt };
}

export function verifyOrderAccess(secret: string, token: string, orderId: string, now: number): { caseId: string } | undefined {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return undefined;
  const supplied = Buffer.from(signature, 'base64url');
  const expected = Buffer.from(createHmac('sha256', secret).update(payload).digest('base64url'), 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return undefined;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (value.version !== 'special-offer-order-access-v1'
      || typeof value.caseId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.caseId)
      || value.orderId !== orderId || !Number.isSafeInteger(value.expiresAt) || Number(value.expiresAt) < now) return undefined;
    return { caseId: value.caseId };
  } catch {
    return undefined;
  }
}

function signPreview(secret: string, caseId: string, commitment: string, totalPriceKrw: number, expiresAt: number): string {
  return createHmac('sha256', secret).update(JSON.stringify({
    version: 'special-offer-preview-v1', caseId, commitment, totalPriceKrw, expiresAt
  })).digest('hex');
}

function validPreviewProof(secret: string, proof: string, caseId: string, commitment: string, totalPriceKrw: number, expiresAt: number): boolean {
  if (!/^[a-f0-9]{64}$/.test(proof)) return false;
  const supplied = Buffer.from(proof, 'hex');
  const expected = Buffer.from(signPreview(secret, caseId, commitment, totalPriceKrw, expiresAt), 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function requiredIdentifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new SpecialOfferOrderInputError(`Invalid ${name}`);
  return value;
}

function requiredApprovalId(value: unknown): string {
  if (typeof value !== 'string' || !/^approval_[0-9a-f-]{36}$/.test(value)) throw new SpecialOfferOrderInputError('Invalid requestId');
  return value;
}

function requiredText(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new SpecialOfferOrderInputError(`Invalid ${name}`);
  return value.trim();
}

function optionalText(value: unknown, name: string, maximum: number): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > maximum) throw new SpecialOfferOrderInputError(`Invalid ${name}`);
  return value.trim();
}

function requiredInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new SpecialOfferOrderInputError(`Invalid ${name}`);
  return Number(value);
}
