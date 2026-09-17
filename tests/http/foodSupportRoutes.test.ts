import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../../src/app.ts';
import { createFoodSupportHandlers } from '../../src/http/foodSupportRoutes.ts';
import { SpecialOfferHttpError, type SpecialOfferCatalogAdapter } from '../../src/food-support/specialOffer.ts';
import type { FoodProduct } from '../../src/food-support/types.ts';

test('food-support HTTP APIs expose program, conversation and credential gate without PII', async (t) => {
  const previous = process.env.SPECIAL_OFFER_API_KEY_FILE;
  delete process.env.SPECIAL_OFFER_API_KEY_FILE;
  const server = createApp();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.close();
    if (previous === undefined) delete process.env.SPECIAL_OFFER_API_KEY_FILE;
    else process.env.SPECIAL_OFFER_API_KEY_FILE = previous;
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;

  const program = await fetch(`${base}/api/food-support/program`).then(response => response.json()) as Record<string, unknown>;
  assert.equal(program.officialName, '2026 농식품바우처 호환 식품지원');
  assert.equal(program.integrationStatus, 'COMPATIBLE_RULESET_NOT_OFFICIAL_PAYMENT_INTEGRATION');

  const interpretation = await fetch(`${base}/api/food-support/interpret`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caseId: 'web_http_food', text: '쌀 사줘' })
  }).then(response => response.json()) as Record<string, unknown>;
  assert.equal(interpretation.caseId, 'web_http_food');
  assert.equal(interpretation.intent, 'DISCOVER_PRODUCTS');
  assert.equal(interpretation.clarificationCode, 'AMBIGUOUS_RICE');
  assert.equal(typeof interpretation.sessionAccessToken, 'string');

  const gatedBudget = await fetch(`${base}/api/food-support/order-readiness`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      caseId: interpretation.caseId, sessionAccessToken: interpretation.sessionAccessToken,
      goodsNo: '101', quantity: 1, originalUtterance: '납작보리쌀 한 봉지 사줘'
    })
  });
  assert.equal(gatedBudget.status, 503);
  assert.equal(((await gatedBudget.json()) as { status: string }).status, 'BUDGET_CREDENTIAL_GATED');

  const catalogResponse = await fetch(`${base}/api/food-support/catalog?query=${encodeURIComponent('잡곡')}`);
  assert.equal(catalogResponse.status, 503);
  const catalogText = await catalogResponse.text();
  assert.match(catalogText, /CREDENTIAL_GATED/);
  assert.equal(/010-\d{4}-\d{4}/.test(catalogText), false);
});

test('malformed food-support input is a client error, not a server failure', async (t) => {
  const server = createApp();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/food-support/order-readiness`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '납작보리쌀 사줘' })
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'INVALID_FOOD_SUPPORT_INPUT' });
});

test('order readiness uses server catalog and budget and performs no supplier POST', async () => {
  const product = {
    goodsNo: '101', goodsCode: 'TC101', sellerCode: 'SC1', name: '국내산 잡곡', category: 'MIXED_GRAINS',
    origin: '국내산', originStatus: 'DOMESTIC', unitPriceKrw: 10000, shippingFeeKrw: 3000,
    inStock: true, selling: true, deliveryAvailable: true, refundable: 'CONDITIONAL',
    nonRefundableConditions: '신선식품 제한', orderCutoff: '10:00', detailUrl: '', source: 'SPECIAL_OFFER_LIVE'
  } as const;
  const catalog = { async get() { return { status: 'LIVE', product }; } } as unknown as SpecialOfferCatalogAdapter;
  const handler = createFoodSupportHandlers(catalog, async () => true, undefined, async () => ({ remainingKrw: 50000, maximumPurchaseKrw: 50000 }), async () => false);
  const result = await handler({ method: 'POST', pathname: '/api/food-support/order-readiness', searchParams: new URLSearchParams(), body: {
    caseId: 'web_readiness', goodsNo: '101', quantity: 2, originalUtterance: '잡곡 두 개 보내줘'
  } });
  assert.equal(result.status, 200);
  const body = result.body as { status: string; product: { totalPriceKrw: number }; supplierPostCalls: number };
  assert.equal(body.status, 'PAID_ACTION_REQUIRED');
  assert.equal(body.product.totalPriceKrw, 23000);
  assert.equal(body.supplierPostCalls, 0);
  assert.equal(Object.hasOwn(body, 'budget'), false);
});

test('public catalog omits every product that cannot be ordered with support', async () => {
  const allowed: FoodProduct = {
    goodsNo: '101', goodsCode: '101', sellerCode: 'SC1', name: '국내산 잡곡', category: 'MIXED_GRAINS',
    origin: '국내산', originStatus: 'DOMESTIC', unitPriceKrw: 10000, shippingFeeKrw: 0,
    inStock: true, selling: true, deliveryAvailable: true, refundable: true,
    nonRefundableConditions: '', orderCutoff: '', detailUrl: '', source: 'TEST_FIXTURE'
  };
  const blockedCategory: FoodProduct = { ...allowed, goodsNo: '102', name: '백미', category: 'WHITE_RICE' };
  const foreign: FoodProduct = { ...allowed, goodsNo: '103', name: '외국산 잡곡', originStatus: 'FOREIGN' };
  const soldOut: FoodProduct = { ...allowed, goodsNo: '104', name: '품절 잡곡', inStock: false };
  const notSelling: FoodProduct = { ...allowed, goodsNo: '105', name: '판매중지 잡곡', selling: false };
  const notDeliverable: FoodProduct = { ...allowed, goodsNo: '106', name: '배송불가 잡곡', deliveryAvailable: false };
  const catalog = {
    async search() { return { status: 'LIVE', exactMatch: false, products: [blockedCategory, foreign, soldOut, notSelling, notDeliverable, allowed] }; },
    async get(goodsNo: string) { return { status: 'LIVE', product: goodsNo === allowed.goodsNo ? allowed : blockedCategory }; }
  } as unknown as SpecialOfferCatalogAdapter;
  const handler = createFoodSupportHandlers(catalog);
  const result = await handler({
    method: 'GET', pathname: '/api/food-support/catalog', searchParams: new URLSearchParams('query=쌀')
  });
  assert.equal(result.status, 200);
  assert.deepEqual((result.body as { products: FoodProduct[] }).products.map(product => product.goodsNo), ['101']);
  assert.equal(JSON.stringify(result.body).includes('백미'), false);
  assert.equal(JSON.stringify(result.body).includes('외국산 잡곡'), false);
  assert.equal(JSON.stringify(result.body).includes('품절 잡곡'), false);
  assert.equal(JSON.stringify(result.body).includes('판매중지 잡곡'), false);
  assert.equal(JSON.stringify(result.body).includes('배송불가 잡곡'), false);

  const allowedItem = await handler({
    method: 'GET', pathname: '/api/food-support/catalog-item', searchParams: new URLSearchParams('goodsNo=101')
  });
  assert.equal(allowedItem.status, 200);
  const blockedItem = await handler({
    method: 'GET', pathname: '/api/food-support/catalog-item', searchParams: new URLSearchParams('goodsNo=102')
  });
  assert.deepEqual(blockedItem, { status: 404, body: { error: 'PRODUCT_NOT_ORDERABLE' } });
});

test('public catalog clears exactMatch when the exact supplier result is not support-orderable', async () => {
  const blocked: FoodProduct = {
    goodsNo: '201', goodsCode: '201', sellerCode: 'SC1', name: '백미', category: 'WHITE_RICE',
    origin: '국내산', originStatus: 'DOMESTIC', unitPriceKrw: 10000, shippingFeeKrw: 0,
    inStock: true, selling: true, deliveryAvailable: true, refundable: true,
    nonRefundableConditions: '', orderCutoff: '', detailUrl: '', source: 'TEST_FIXTURE'
  };
  const handler = createFoodSupportHandlers({
    async search() { return { status: 'LIVE', exactMatch: true, products: [blocked] }; }
  } as unknown as SpecialOfferCatalogAdapter);
  const result = await handler({
    method: 'GET', pathname: '/api/food-support/catalog', searchParams: new URLSearchParams('query=백미&exactName=백미')
  });
  assert.deepEqual(result.body, { status: 'LIVE', exactMatch: false, products: [] });
});

test('public catalog item maps a supplier 404 to a non-orderable product without leaking a server error', async () => {
  const handler = createFoodSupportHandlers({
    async get() { throw new SpecialOfferHttpError(404); }
  } as unknown as SpecialOfferCatalogAdapter);
  const result = await handler({
    method: 'GET', pathname: '/api/food-support/catalog-item', searchParams: new URLSearchParams('goodsNo=deleted-201')
  });
  assert.deepEqual(result, { status: 404, body: { error: 'PRODUCT_NOT_ORDERABLE' } });
});

test('public food-support policy API requires a case-bound session before reading budget', async (t) => {
  const server = createApp();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const makeProduct = (category: string, goodsNo: string) => ({
    goodsNo, goodsCode: `TC${goodsNo}`, sellerCode: 'SC1', name: category,
    category, origin: '국내산', originStatus: 'DOMESTIC', unitPriceKrw: 10000,
    shippingFeeKrw: 0, inStock: true, selling: true, deliveryAvailable: true,
    refundable: 'CONDITIONAL', nonRefundableConditions: '', orderCutoff: '09:00', detailUrl: '', source: 'TEST_FIXTURE'
  });
  const response = await fetch(`${base}/api/food-support/policy`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      caseId: 'web_policy_untrusted', originalUtterance: '잡곡이랑 라면 보내줘', duplicateCase: false,
      budget: { remainingKrw: 50000, maximumPurchaseKrw: 50000 },
      lines: [
        { lineId: 'grain', product: makeProduct('MIXED_GRAINS', '101'), quantity: 1, quotedUnitPriceKrw: 10000 },
        { lineId: 'ramen', product: makeProduct('INSTANT_NOODLES', '102'), quantity: 1, quotedUnitPriceKrw: 10000 }
      ]
    })
  });
  assert.equal(response.status, 403);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Invalid or expired food session access');
});

test('web interpretation exposes provider-neutral provenance but deterministic high-risk guard runs first', async () => {
  let interpreterCalls = 0;
  const catalog = {} as SpecialOfferCatalogAdapter;
  const handler = createFoodSupportHandlers(
    catalog, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    async text => {
      interpreterCalls += 1;
      return {
        normalizedQuery: text, requestedCategories: ['MIXED_GRAINS'], exactProductName: '납작보리쌀',
        quantity: 1, substitutionsAllowed: false, needsClarification: false, ambiguityReasons: [],
        safeUserSummary: '잡곡 요청', confidence: 0.95,
        providerMetadata: { provider: 'test-provider', modelId: 'test-model', responseId: 'r1' }
      };
    }
  );
  const allowed = await handler({ method: 'POST', pathname: '/api/food-support/interpret', searchParams: new URLSearchParams(), body: {
    caseId: 'web_ai_food', text: '납작보리쌀 사줘'
  } });
  assert.equal(allowed.status, 200);
  const interpretation = (allowed.body as { interpretation: { engine: string; policyAuthority: boolean; inputHash: string } }).interpretation;
  assert.equal(interpretation.engine, 'CONFIGURED_AI_PROVIDER');
  assert.equal(interpretation.policyAuthority, false);
  assert.match(interpretation.inputHash, /^sha256:[a-f0-9]{64}$/);

  const blocked = await handler({ method: 'POST', pathname: '/api/food-support/interpret', searchParams: new URLSearchParams(), body: {
    caseId: 'web_ai_blocked', text: '총기 구입해줘'
  } });
  assert.equal((blocked.body as { mustNotExecutePurchase: boolean }).mustNotExecutePurchase, true);
  assert.equal((blocked.body as { interpretation: { engine: string } }).interpretation.engine, 'SKIPPED_POLICY_BOUNDARY');
  assert.equal(interpreterCalls, 1);

  const pii = await handler({ method: 'POST', pathname: '/api/food-support/interpret', searchParams: new URLSearchParams(), body: {
    caseId: 'web_ai_pii', text: '잡곡 보내줘 연락처는 010-1234-5678이야'
  } });
  assert.equal((pii.body as { interpretation: { engine: string } }).interpretation.engine, 'SKIPPED_PII_BOUNDARY');
  assert.equal(interpreterCalls, 1);

  for (const [caseId, text] of [
    ['web_ai_road_address', '서울시 강남구 테헤란로 1로 보내줘'],
    ['web_ai_street_address', '부산광역시 해운대구 센텀중앙로 97'],
    ['web_ai_lot_address', '서울 종로구 청운동 12-3 101호']
  ] as const) {
    const address = await handler({ method: 'POST', pathname: '/api/food-support/interpret', searchParams: new URLSearchParams(), body: {
      caseId, text
    } });
    assert.equal((address.body as { interpretation: { engine: string } }).interpretation.engine, 'SKIPPED_PII_BOUNDARY', text);
  }
  assert.equal(interpreterCalls, 1);
});

test('catalog rejects address-shaped queries before the supplier adapter', async () => {
  let searches = 0;
  const catalog = {
    async search() { searches += 1; return { status: 'LIVE' as const, products: [], exactMatch: false }; },
    async get() { throw new Error('not expected'); }
  } as unknown as SpecialOfferCatalogAdapter;
  const handler = createFoodSupportHandlers(catalog);
  for (const query of ['서울시 강남구 테헤란로 1', '부산 해운대구 센텀중앙로 97']) {
    const response = await handler({
      method: 'GET', pathname: '/api/food-support/catalog',
      searchParams: new URLSearchParams({ query })
    });
    assert.equal(response.status, 400);
    assert.equal((response.body as { error: string }).error, 'PII_NOT_ALLOWED');
  }
  assert.equal(searches, 0);
});
