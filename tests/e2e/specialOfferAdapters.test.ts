import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CallbackSpecialOfferCredentialProvider,
  FileSpecialOfferCredentialProvider,
  isAllowedCredentialFileMode,
  HmacExternalActionApprovalVerifier,
  HmacPaidActionApprovalVerifier,
  RecipientDeliveryTracker,
  SpecialOfferCatalogAdapter,
  SpecialOfferOrderAdapter
} from '../../src/food-support/specialOffer.ts';
import { buildFoodOrderConsent } from '../../src/food-support/policy.ts';
import { FOOD_VOUCHER_POLICY_VERSION, type FoodPolicyDecision, type FoodProduct } from '../../src/food-support/types.ts';

const product: FoodProduct = {
  goodsNo: '1086316', goodsCode: 'TC01086316', sellerCode: 'SC00005497', name: '국내산 8곡 잡곡 2kg',
  category: 'MIXED_GRAINS', origin: '국내산', originStatus: 'DOMESTIC', unitPriceKrw: 21_900,
  shippingFeeKrw: 0, inStock: true, selling: true, deliveryAvailable: true,
  refundable: 'CONDITIONAL', nonRefundableConditions: '신선식품 단순변심 제한', orderCutoff: '09:00',
  detailUrl: 'https://specialoffer.kr/shop/view.php?index_no=1086316', source: 'SPECIAL_OFFER_LIVE'
};

const recipient = {
  name: '홍길동', cellphone: '010-1234-5678', zip: '01234', address: '서울특별시 중구 세종대로 1 101호',
  memo: '문 앞', recipientToken: 'recipient_token_001'
};

const liveCredential = new CallbackSpecialOfferCredentialProvider(async () => 'test-credential-1234567890');
const noCredential = new CallbackSpecialOfferCredentialProvider(async () => undefined);
const now = 1_800_000_000_000;
const policyDecision: FoodPolicyDecision = {
  decision: 'APPROVED', policyVersion: FOOD_VOUCHER_POLICY_VERSION, policySnapshotHash: 'a'.repeat(64),
  sourceUrls: ['https://www.foodvoucher.go.kr/view/fm/vucintro/agriFood'], verifiedAt: '2026-08-01T00:00:00+09:00',
  approvedAmountKrw: 21_900,
  lines: [{ lineId: 'grain', goodsNo: product.goodsNo, decision: 'APPROVED', amountKrw: 21_900, checks: [], failedRules: [] }]
};

function orderInput(caseId: string) {
  const consent = buildFoodOrderConsent({
    caseId, goodsNo: product.goodsNo, sellerCode: product.sellerCode, quantity: 1,
    unitPriceKrw: product.unitPriceKrw, shippingFeeKrw: product.shippingFeeKrw,
    totalPriceKrw: product.unitPriceKrw + product.shippingFeeKrw, recipientToken: recipient.recipientToken,
    policySnapshotHash: policyDecision.policySnapshotHash, expiresAt: now + 60_000
  });
  return { caseId, product, quantity: 1, shippingFeePayment: 0 as const, recipient, consent, policyDecision, now };
}

test('credential-gated catalog and order perform zero network calls', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls += 1; throw new Error('must not call'); };
  const catalog = new SpecialOfferCatalogAdapter(noCredential, fetcher);
  const order = new SpecialOfferOrderAdapter(noCredential, fetcher);
  assert.equal((await catalog.search({ query: '잡곡' })).status, 'CREDENTIAL_GATED');
  assert.equal((await order.submit(orderInput('case_gated'))).status, 'CREDENTIAL_GATED');
  assert.equal(calls, 0);
});

test('every SpecialOffer request carries a finite abort deadline', async () => {
  let signal: AbortSignal | null | undefined;
  const catalog = new SpecialOfferCatalogAdapter(
    new CallbackSpecialOfferCredentialProvider(async () => 'credential-1234567890'),
    async (_url, init) => {
      signal = init?.signal;
      return Response.json({ data: [] });
    }
  );
  await catalog.search({ query: '잡곡' });
  assert.ok(signal);
  assert.equal(signal.aborted, false);
  assert.equal(typeof signal.addEventListener, 'function');
});

test('credential file rejects broad permissions and accepts mode 600', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'special-offer-'));
  const path = join(directory, 'credential');
  await writeFile(path, 'test-credential-1234567890\n', { mode: 0o644 });
  const provider = new FileSpecialOfferCredentialProvider(path);
  await assert.rejects(() => provider.getCredential(), /mode 600/);
  await chmod(path, 0o600);
  assert.equal(await provider.getCredential(), 'test-credential-1234567890');
});

test('credential file accepts a read-only Cloud Run secret mount but not a broad file elsewhere', async () => {
  assert.equal(isAllowedCredentialFileMode('/secrets/specialoffer/api-key', 0o100444), true);
  assert.equal(isAllowedCredentialFileMode('/tmp/api-key', 0o100444), false);
  assert.equal(isAllowedCredentialFileMode('/secrets/specialoffer/api-key', 0o100644), false);
  assert.equal(isAllowedCredentialFileMode('/secrets/../tmp/api-key', 0o100444), false);
  assert.equal(isAllowedCredentialFileMode('/tmp/api-key', 0o100600), true);
});

test('live catalog uses Bearer auth and maps origin, price, stock and return conditions', async () => {
  const requests: Request[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return Response.json({ data: [{
      goods_no: '1086316', goods_code: 'TC01086316', seller_code: 'SC00005497', name: '국내산 8곡 잡곡 2kg',
      origin: '국내산', price: 21900, shipping_fee: 0, stock_type: '1', stock_qty: 12, state: 1,
      is_overseas_shipping: 'N', is_refundable: '3', non_refundable_conditions: '신선식품 제한', order_end_at: '09:00'
    }] });
  };
  const result = await new SpecialOfferCatalogAdapter(liveCredential, fetcher).search({ query: '' });
  assert.equal(result.status, 'LIVE');
  if (result.status !== 'LIVE') return;
  assert.equal(result.products[0]!.category, 'MIXED_GRAINS');
  assert.equal(result.products[0]!.originStatus, 'DOMESTIC');
  assert.equal(result.products[0]!.unitPriceKrw, 21_900);
  assert.equal(result.products[0]!.inStock, true);
  assert.equal(result.products[0]!.refundable, 'CONDITIONAL');
  assert.equal(requests[0]!.headers.get('authorization'), 'Bearer test-credential-1234567890');
  assert.match(requests[0]!.url, /\/api\/goods\?state=1/);
});

test('food catalog expands real grain categories and rejects provider miscategorizations', async () => {
  const requests: Request[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    const url = new URL(request.url);
    if (url.pathname === '/api/categories') {
      assert.equal(url.searchParams.get('parent_code'), '540502');
      return Response.json({ data: [{ code: '540502020', name: '보리' }] });
    }
    assert.equal(url.searchParams.get('category_code'), '540502020');
    return Response.json({ data: [
      { goods_no: '1001', goods_code: 'PAINT', seller_code: 'seller', name: '계란광 수성페인트 아이보리', origin: '국내산', price: 1000, shipping_fee: 0, stock_qty: 3, state: 1 },
      { goods_no: '1003', goods_code: 'BARLEY-RICE', seller_code: 'seller', name: '국내산 찰보리쌀 700g', origin: '국내산', price: 5900, shipping_fee: 3000, stock_qty: 8, state: 1 },
      { goods_no: '1002', goods_code: 'BARLEY', seller_code: 'seller', name: '국내산 납작보리 1kg', origin: '국내산', price: 6500, shipping_fee: 3000, stock_qty: 12, state: 1 }
    ] });
  };
  const result = await new SpecialOfferCatalogAdapter(liveCredential, fetcher).search({
    query: '납작보리쌀',
    exactName: '납작보리쌀'
  });
  assert.equal(result.status, 'LIVE');
  if (result.status !== 'LIVE') return;
  assert.deepEqual(result.products.map(product => product.goodsNo), ['1002', '1003']);
  assert.equal(result.products[0]!.category, 'MIXED_GRAINS');
  assert.equal(result.exactMatch, false);
  assert.equal(requests.length, 2);
});

test('paid gate returns a masked preview and performs zero POST calls', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls += 1; throw new Error('must not call'); };
  const adapter = new SpecialOfferOrderAdapter(liveCredential, fetcher);
  const result = await adapter.submit(orderInput('case_paid_gate'));
  assert.equal(result.status, 'PAID_ACTION_REQUIRED');
  if (result.status !== 'PAID_ACTION_REQUIRED') return;
  assert.equal(result.preview.externalKey, 'case_paid_gate');
  assert.equal(result.preview.totalPriceKrw, 21_900);
  assert.equal(JSON.stringify(result.preview).includes(recipient.address), false);
  assert.equal(JSON.stringify(result.preview).includes(recipient.cellphone), false);
  assert.equal(calls, 0);
});

test('approved live order sends external_key=caseId once and strips response PII', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ data: {
      order_id: '123456', order_no: '26080112345678', seller_code: 'SC00005497', order_state: 2,
      goods_name: product.name, delivery_company: '', delivery_no: '', delivery_date: null, shop_memo: '',
      sum_qty: 1, goods_price: 21900, shipping_fee: 0, total_price: 21900,
      receiver_name: recipient.name, receiver_cellphone: recipient.cellphone, receiver_addr: recipient.address
    } });
  };
  const verifier = new HmacPaidActionApprovalVerifier('paid-action-test-secret-at-least-32-bytes');
  const adapter = new SpecialOfferOrderAdapter(liveCredential, fetcher, 'https://specialoffer.kr', verifier);
  const baseInput = orderInput('case_live_order');
  const input = { ...baseInput, paidActionApproval: verifier.issue(baseInput, now + 30_000) };
  const first = await adapter.submit(input);
  const replay = await adapter.submit(input);
  assert.equal(first.status, 'SUBMITTED');
  assert.equal(replay.status, 'SUBMITTED');
  if (first.status !== 'SUBMITTED' || replay.status !== 'SUBMITTED') return;
  assert.equal(first.order.externalOrderId, '123456');
  assert.equal(replay.replayed, true);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]!.external_key, 'case_live_order');
  assert.equal(JSON.stringify(first.order).includes(recipient.name), false);
  assert.equal(JSON.stringify(first.order).includes(recipient.address), false);
  const changedBase = { ...orderInput('case_live_order'), quantity: 2 };
  await assert.rejects(() => adapter.submit({ ...changedBase, paidActionApproval: verifier.issue(changedBase, now + 30_000) }), /Consent does not match|expired or stale/);
});

test('ambiguous provider timeout never auto-retries a potentially accepted paid order', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error('timeout');
    return Response.json({ data: {
      order_id: '999', order_no: '260801999', seller_code: 'SC00005497', order_state: 2,
      goods_name: product.name, sum_qty: 1, goods_price: 21900, shipping_fee: 0, total_price: 21900
    } });
  };
  const verifier = new HmacPaidActionApprovalVerifier('paid-action-test-secret-at-least-32-bytes');
  const adapter = new SpecialOfferOrderAdapter(liveCredential, fetcher, 'https://specialoffer.kr', verifier);
  const baseInput = orderInput('case_retry');
  const input = { ...baseInput, paidActionApproval: verifier.issue(baseInput, now + 30_000) };
  assert.equal((await adapter.submit(input)).status, 'ORDER_RECONCILIATION_REQUIRED');
  assert.equal((await adapter.submit(input)).status, 'ORDER_RECONCILIATION_REQUIRED');
  assert.equal(calls, 1);
});

test('expired execution lease reconciles by supplier readback without a second paid POST', async () => {
  let posts = 0;
  let reads = 0;
  const fetcher: typeof fetch = async (raw, init) => {
    const request = new Request(raw, init);
    if (request.method === 'POST') {
      posts += 1;
      throw new Error('provider accepted but response timed out');
    }
    reads += 1;
    return Response.json({ data: {
      order_id: '999', order_no: '260801999', seller_code: 'SC00005497', order_state: 2,
      goods_name: product.name, sum_qty: 1, goods_price: 21900, shipping_fee: 0, total_price: 21900
    } });
  };
  const verifier = new HmacPaidActionApprovalVerifier('paid-action-test-secret-at-least-32-bytes');
  const adapter = new SpecialOfferOrderAdapter(liveCredential, fetcher, 'https://specialoffer.kr', verifier, undefined, undefined, 1_000);
  const base = orderInput('case_reconcile');
  const input = { ...base, paidActionApproval: verifier.issue(base, now + 30_000) };
  assert.equal((await adapter.submit(input)).status, 'ORDER_RECONCILIATION_REQUIRED');
  assert.deepEqual(await adapter.reconcile({ caseId: base.caseId, orderId: '999', now: now + 999 }), {
    status: 'NOT_READY', retryAfter: now + 1_000
  });
  const reconciled = await adapter.reconcile({ caseId: base.caseId, orderId: '999', now: now + 1_000 });
  assert.equal(reconciled.status, 'COMPLETED');
  assert.equal(posts, 1);
  assert.equal(reads, 1);
  const replay = await adapter.submit(input);
  assert.equal(replay.status, 'SUBMITTED');
  assert.equal(posts, 1);
});

test('tampered or expired consent and unsigned paid approval fail before supplier POST', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls += 1; throw new Error('must not call'); };
  const verifier = new HmacPaidActionApprovalVerifier('paid-action-test-secret-at-least-32-bytes');
  const adapter = new SpecialOfferOrderAdapter(liveCredential, fetcher, 'https://specialoffer.kr', verifier);
  const base = orderInput('case_consent_gate');
  await assert.rejects(() => adapter.submit({ ...base, consent: { ...base.consent, unitPriceKrw: 1 } }), /Invalid consent commitment/);
  await assert.rejects(() => adapter.submit({ ...base, now: base.consent.expiresAt + 1 }), /expired or stale/);
  const unsigned = await adapter.submit({ ...base, paidActionApproval: { token: 'f'.repeat(64), expiresAt: now + 30_000 } });
  assert.equal(unsigned.status, 'PAID_ACTION_REQUIRED');
  assert.equal(calls, 0);
});

test('carrier delivery and recipient confirmation remain separate states', () => {
  const tracker = new RecipientDeliveryTracker();
  tracker.syncProviderOrder({
    externalOrderId: 'order_1', externalOrderNo: '2608011', sellerCode: 'SC1', goodsName: '잡곡', quantity: 1,
    goodsPriceKrw: 10000, shippingFeeKrw: 0, totalPriceKrw: 10000, providerOrderState: 2,
    deliveryState: 'SHIPPED', trackingNumber: 'TRACK123', source: 'SPECIAL_OFFER_LIVE'
  });
  assert.equal(tracker.markCarrierDelivered('order_1'), 'CARRIER_DELIVERED');
  assert.equal(tracker.confirmRecipient('order_1', 'NOT_RECEIVED'), 'DELIVERY_DISPUTED');
  assert.equal(tracker.confirmRecipient('order_1', 'RECEIVED'), 'RECIPIENT_CONFIRMED');
});

test('supplier order response mismatch is held for reconciliation', async () => {
  const fetcher: typeof fetch = async () => Response.json({ data: {
    order_id: '123', order_no: '456', seller_code: 'WRONG', order_state: 2,
    goods_name: product.name, sum_qty: 2, goods_price: 21900, shipping_fee: 0, total_price: 43800
  } });
  const verifier = new HmacPaidActionApprovalVerifier('paid-action-test-secret-at-least-32-bytes');
  const adapter = new SpecialOfferOrderAdapter(liveCredential, fetcher, 'https://specialoffer.kr', verifier);
  const base = orderInput('case_mismatched_response');
  const result = await adapter.submit({ ...base, paidActionApproval: verifier.issue(base, now + 30_000) });
  assert.equal(result.status, 'ORDER_RECONCILIATION_REQUIRED');
});

test('supplier order response with another goods identity is held for reconciliation', async () => {
  const fetcher: typeof fetch = async () => Response.json({ data: {
    order_id: '123', order_no: '456', goods_no: '9999999', seller_code: product.sellerCode, order_state: 2,
    goods_name: product.name, sum_qty: 1, goods_price: 21900, shipping_fee: 0, total_price: 21900
  } });
  const verifier = new HmacPaidActionApprovalVerifier('paid-action-test-secret-at-least-32-bytes');
  const adapter = new SpecialOfferOrderAdapter(liveCredential, fetcher, 'https://specialoffer.kr', verifier);
  const base = orderInput('case_wrong_goods');
  const result = await adapter.submit({ ...base, paidActionApproval: verifier.issue(base, now + 30_000) });
  assert.equal(result.status, 'ORDER_RECONCILIATION_REQUIRED');
});

test('supplier cancellation requires a signed scoped action token', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls += 1; return Response.json({ data: {} }); };
  const actions = new HmacExternalActionApprovalVerifier('external-action-test-secret-32-bytes-minimum');
  const adapter = new SpecialOfferOrderAdapter(liveCredential, fetcher, 'https://specialoffer.kr', undefined, actions);
  assert.equal((await adapter.cancel({ orderId: '123', reason: '이용자 요청', now })).status, 'EXTERNAL_ACTION_REQUIRED');
  const approval = actions.issue({ orderId: '123', reason: '이용자 요청', now }, now + 30_000);
  assert.equal((await adapter.cancel({ orderId: '123', reason: '이용자 요청', approval, now })).status, 'CANCEL_REQUESTED');
  assert.equal(calls, 1);
});
