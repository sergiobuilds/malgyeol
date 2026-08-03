import type { CaseRepository } from '../e2e/caseRepository.ts';
import type { RoleWorkflowRepository } from '../roles/workflow.ts';
import type { PreparedOrder } from '../http/specialOfferOrderRoutes.ts';
import type { ExternalOrderReadback } from './types.ts';

export async function rollupSpecialOfferOrder(
  cases: CaseRepository,
  workflows: RoleWorkflowRepository,
  input: { prepared: PreparedOrder; order: ExternalOrderReadback; at: number }
): Promise<void> {
  const existing = await cases.get(input.prepared.caseId);
  if (!existing) throw new Error('Cannot roll up an order without an authoritative case');
  if (existing.state === 'ORDERED' && existing.providerOrderId !== input.order.externalOrderId) {
    throw new Error('Case already contains another supplier order');
  }
  const candidate = existing.candidate ?? {
    caseId: input.prepared.caseId,
    sku: input.prepared.product.goodsNo,
    category: input.prepared.product.category,
    quantity: input.prepared.quantity,
    merchantId: input.prepared.product.sellerCode,
    unitPriceKrw: input.prepared.product.unitPriceKrw,
    totalPriceKrw: input.prepared.product.unitPriceKrw * input.prepared.quantity + input.prepared.product.shippingFeeKrw,
    programAmountKrw: input.prepared.product.unitPriceKrw * input.prepared.quantity + input.prepared.product.shippingFeeKrw,
    substitutionsAllowed: false,
    confidence: 1,
    ambiguityReasons: [],
    readbackSentence: input.prepared.product.name
  };
  if (existing.state !== 'ORDERED') {
    await cases.transition(input.prepared.caseId, existing.state, 'ORDERED', {
      candidate,
      providerOrderId: input.order.externalOrderId
    }, input.at);
  }
  const workflow = await workflows.get(input.prepared.caseId);
  if (!workflow || workflow.merchant.fulfillment === 'NEW') {
    await workflows.apply({
      caseId: input.prepared.caseId,
      role: 'merchant',
      subjectId: 'system:specialoffer',
      action: 'ACKNOWLEDGE_ORDER',
      expectedRevision: workflow?.revision ?? 0
    });
  }
}

export async function rollupReconciledSpecialOfferOrder(
  cases: CaseRepository,
  workflows: RoleWorkflowRepository,
  input: { caseId: string; order: ExternalOrderReadback; at: number }
): Promise<void> {
  const existing = await cases.get(input.caseId);
  if (!existing?.candidate) throw new Error('Cannot reconcile an order without the confirmed candidate');
  if (existing.candidate.sku !== input.order.goodsNo
    || existing.candidate.merchantId !== input.order.sellerCode
    || existing.candidate.quantity !== input.order.quantity
    || existing.candidate.totalPriceKrw !== input.order.totalPriceKrw) {
    throw new Error('Reconciled supplier order does not match the confirmed candidate');
  }
  if (existing.state === 'ORDERED' && existing.providerOrderId !== input.order.externalOrderId) {
    throw new Error('Case already contains another supplier order');
  }
  if (existing.state !== 'ORDERED') {
    await cases.transition(input.caseId, existing.state, 'ORDERED', {
      providerOrderId: input.order.externalOrderId
    }, input.at);
  }
  const workflow = await workflows.get(input.caseId);
  if (!workflow || workflow.merchant.fulfillment === 'NEW') {
    await workflows.apply({
      caseId: input.caseId,
      role: 'merchant',
      subjectId: 'system:specialoffer',
      action: 'ACKNOWLEDGE_ORDER',
      expectedRevision: workflow?.revision ?? 0
    });
  }
}
