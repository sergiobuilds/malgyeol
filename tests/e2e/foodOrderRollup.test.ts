import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryCaseRepository } from '../../src/e2e/inMemoryCaseRepository.ts';
import { InMemoryRoleWorkflowRepository } from '../../src/roles/workflow.ts';
import { rollupSpecialOfferOrder } from '../../src/food-support/orderRollup.ts';
import { buildFoodOrderConsent } from '../../src/food-support/policy.ts';
import type { PreparedOrder } from '../../src/http/specialOfferOrderRoutes.ts';

test('supplier success rolls the same caseId into case events and role workflow idempotently', async () => {
  const cases = new InMemoryCaseRepository();
  const workflows = new InMemoryRoleWorkflowRepository(() => 100);
  await cases.create({
    caseId: 'food_rollup_case', callSidHash: 'a'.repeat(64), beneficiaryRef: 'beneficiary-1',
    programId: 'program-2026', planId: 'plan-1', state: 'CONFIRMED', createdAt: 1, updatedAt: 1
  });
  const product = {
    goodsNo: '318346', goodsCode: 'TC00318346', sellerCode: 'SC00005832', name: '모듬잡곡 700g',
    category: 'MIXED_GRAINS' as const, origin: '국내산', originStatus: 'DOMESTIC' as const,
    unitPriceKrw: 8300, shippingFeeKrw: 4000, inStock: true, selling: true, deliveryAvailable: true,
    refundable: true as const, nonRefundableConditions: '', orderCutoff: '12:00', detailUrl: '', source: 'SPECIAL_OFFER_LIVE' as const
  };
  const policyDecision = {
    decision: 'APPROVED' as const, policyVersion: 'kr-agri-food-voucher-compatible-2026-v1' as const,
    policySnapshotHash: 'b'.repeat(64), sourceUrls: [], verifiedAt: '2026-08-01', approvedAmountKrw: 12300,
    lines: [{ lineId: 'order', goodsNo: product.goodsNo, decision: 'APPROVED' as const, amountKrw: 12300, checks: [], failedRules: [] }]
  };
  const recipient = { name: '수령인', cellphone: '010-0000-0000', zip: '00000', address: '비공개', recipientToken: 'c'.repeat(64) };
  const consent = buildFoodOrderConsent({
    caseId: 'food_rollup_case', goodsNo: product.goodsNo, sellerCode: product.sellerCode, quantity: 1,
    unitPriceKrw: 8300, shippingFeeKrw: 4000, totalPriceKrw: 12300, recipientToken: recipient.recipientToken,
    policySnapshotHash: policyDecision.policySnapshotHash, expiresAt: 10_000
  });
  const prepared: PreparedOrder = {
    caseId: 'food_rollup_case', product, quantity: 1, shippingFeePayment: 0, recipient, consent,
    policyDecision, budget: { remainingKrw: 100_000, maximumPurchaseKrw: 50_000 }, now: 100
  };
  const order = {
    externalOrderId: '585492', externalOrderNo: '26080121204025', sellerCode: product.sellerCode,
    goodsNo: product.goodsNo, goodsName: product.name, quantity: 1, goodsPriceKrw: 8300,
    shippingFeeKrw: 4000, totalPriceKrw: 12300, providerOrderState: 2,
    deliveryState: 'PREPARING' as const, source: 'SPECIAL_OFFER_LIVE' as const
  };
  await rollupSpecialOfferOrder(cases, workflows, { prepared, order, at: 200 });
  await rollupSpecialOfferOrder(cases, workflows, { prepared, order, at: 201 });
  assert.equal((await cases.get(prepared.caseId))?.state, 'ORDERED');
  assert.equal((await cases.get(prepared.caseId))?.providerOrderId, '585492');
  assert.deepEqual((await cases.events(prepared.caseId)).map(value => value.state), ['CONFIRMED', 'ORDERED']);
  const workflow = await workflows.get(prepared.caseId);
  assert.equal(workflow?.merchant.fulfillment, 'ACKNOWLEDGED');
  assert.deepEqual(workflow?.events.map(value => value.action), ['ACKNOWLEDGE_ORDER']);
});
