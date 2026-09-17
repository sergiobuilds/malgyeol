import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpecialOfferOrderHandlers } from '../../src/http/specialOfferOrderRoutes.ts';
import {
  CallbackSpecialOfferCredentialProvider,
  HmacPaidActionApprovalVerifier,
  SpecialOfferOrderAdapter,
  type SpecialOfferCatalogAdapter
} from '../../src/food-support/specialOffer.ts';
import { isAllowedBudgetFileMode } from '../../src/food-support/budgetProvider.ts';
import { ApprovalRequestCipher, InMemoryApprovalRequestRepository } from '../../src/food-support/approvalRequests.ts';
import { InMemoryFoodBudgetLedger } from '../../src/food-support/budgetLedger.ts';

const product = {
  goodsNo: '318346', goodsCode: 'TC00318346', sellerCode: 'SC00005832', name: '모듬잡곡 700g',
  category: 'MIXED_GRAINS', origin: '국내산', originStatus: 'DOMESTIC', unitPriceKrw: 8300,
  shippingFeeKrw: 4000, inStock: true, selling: true, deliveryAvailable: true, refundable: true,
  nonRefundableConditions: '', orderCutoff: '12:00', detailUrl: '', source: 'SPECIAL_OFFER_LIVE'
} as const;
const operatorSecret = ['operator', 'secret', '1234567890'].join('-');

test('food budget secret mount permission exception rejects traversal and broad writes', () => {
  assert.equal(isAllowedBudgetFileMode('/secrets/food/budget', 0o100444), true);
  assert.equal(isAllowedBudgetFileMode('/secrets/../tmp/budget', 0o100444), false);
  assert.equal(isAllowedBudgetFileMode('/secrets/food/budget', 0o100644), false);
  assert.equal(isAllowedBudgetFileMode('/tmp/budget', 0o100600), true);
});

test('case-bound preview is non-paid and authenticated submit creates one external caseId order', async () => {
  let supplierPosts = 0;
  const supplierBodies: Array<Record<string, unknown>> = [];
  const credential = new CallbackSpecialOfferCredentialProvider(async () => 'test-credential-1234567890');
  const paidApprovals = new HmacPaidActionApprovalVerifier('p'.repeat(32));
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.method === 'POST') {
      supplierPosts += 1;
      supplierBodies.push(JSON.parse(await request.text()) as Record<string, unknown>);
    }
    return Response.json({ data: {
      order_id: '123456', order_no: '26080112345678', seller_code: product.sellerCode, order_state: 2,
      goods_no: product.goodsNo, goods_name: product.name, sum_qty: 1, goods_price: 8300,
      shipping_fee: 4000, total_price: 12300, delivery_company: '', delivery_no: '', delivery_date: null,
      buyer_memo: '현관 비밀번호 1234', shop_memo: '수령인에게 직접 연락'
    } });
  };
  const orders = new SpecialOfferOrderAdapter(credential, fetcher, 'https://specialoffer.kr', paidApprovals);
  const catalog = { async get() { return { status: 'LIVE', product }; } } as unknown as SpecialOfferCatalogAdapter;
  const handler = createSpecialOfferOrderHandlers({
    catalog,
    budgets: { async get() { return { remainingKrw: 100000, maximumPurchaseKrw: 50000 }; } },
    orders,
    paidApprovals,
    operatorSecret: operatorSecret,
    validateSession: async (_caseId, token) => token === 'session-token',
    isDuplicateCase: async () => false,
    authorizeOperator: (authorization, caseId, accessLevel) => authorization === 'Bearer scoped-ops-act'
      && caseId === 'web_real_food_01' && accessLevel === 'act',
    now: () => 1_785_577_000_000
  });
  const requestBody = {
    caseId: 'web_real_food_01', sessionAccessToken: 'session-token', goodsNo: product.goodsNo,
    quantity: 1, originalUtterance: '국내산 모듬잡곡 한 봉지 보내줘',
    recipient: { name: '합성이용자', cellphone: '010-0000-0000', zip: '00000', address: '합성 배송지 1' }
  };
  const preview = await handler({ method: 'POST', pathname: '/api/food-support/order-preview', body: requestBody });
  assert.equal(preview.status, 200);
  assert.equal(supplierPosts, 0);
  const previewBody = preview.body as { consentExpiresAt: number; previewProof: string; preview: { consentCommitment: string; totalPriceKrw: number } };
  assert.equal(previewBody.preview.totalPriceKrw, 12300);
  assert.equal(JSON.stringify(preview.body).includes('합성 배송지 1'), false);
  assert.equal(JSON.stringify(preview.body).includes('010-0000-0000'), false);

  const unauthorized = await handler({ method: 'POST', pathname: '/api/food-support/order-submit', body: {
    ...requestBody, expectedConsentCommitment: previewBody.preview.consentCommitment,
    expectedConsentExpiresAt: previewBody.consentExpiresAt, expectedTotalKrw: 12300, previewProof: previewBody.previewProof
  } });
  assert.equal(unauthorized.status, 401);
  assert.equal(supplierPosts, 0);

  const scopedSubmit = {
    method: 'POST', pathname: '/api/food-support/order-submit', authorization: 'Bearer scoped-ops-act',
    body: { ...requestBody, expectedConsentCommitment: previewBody.preview.consentCommitment,
      expectedConsentExpiresAt: previewBody.consentExpiresAt, expectedTotalKrw: 12300, previewProof: previewBody.previewProof }
  } as const;
  const wrongScope = await handler({ ...scopedSubmit, body: { ...scopedSubmit.body, caseId: 'web_other' } });
  assert.equal(wrongScope.status, 401);
  assert.equal(supplierPosts, 0);

  const submitRequest = {
    method: 'POST', pathname: '/api/food-support/order-submit', authorization: `Bearer ${operatorSecret}`,
    body: { ...requestBody, expectedConsentCommitment: previewBody.preview.consentCommitment,
      expectedConsentExpiresAt: previewBody.consentExpiresAt, expectedTotalKrw: 12300, previewProof: previewBody.previewProof }
  } as const;
  const changedExpiry = await handler({
    ...submitRequest,
    body: { ...submitRequest.body, expectedConsentExpiresAt: previewBody.consentExpiresAt - 1 }
  });
  assert.equal(changedExpiry.status, 409);
  assert.equal(supplierPosts, 0);
  const concurrent = await Promise.all([handler(submitRequest), handler(submitRequest)]);
  assert.deepEqual(concurrent.map(result => result.status).sort(), [201, 409]);
  assert.equal(supplierPosts, 1);
  assert.equal(supplierBodies[0]!.receiver_telephone, '010-0000-0000');
  const submitted = concurrent.find(result => result.status === 201)!;
  const submittedBody = submitted.body as {
    order: { caseId: string; externalOrderId: string };
    orderAccess: { token: string; expiresAt: number };
  };
  assert.equal(submittedBody.order.caseId, 'web_real_food_01');
  assert.equal(submittedBody.order.externalOrderId, '123456');
  assert.ok(submittedBody.orderAccess.expiresAt > 1_785_577_000_000);

  const publicStatus = await handler({ method: 'POST', pathname: '/api/food-support/order-status', body: {
    orderId: '123456', orderAccessToken: submittedBody.orderAccess.token
  } });
  assert.equal(publicStatus.status, 200);
  assert.equal((publicStatus.body as { caseId: string }).caseId, 'web_real_food_01');
  assert.equal(JSON.stringify(publicStatus.body).includes('합성 배송지 1'), false);
  assert.equal(JSON.stringify(publicStatus.body).includes('현관 비밀번호'), false);
  assert.equal(JSON.stringify(publicStatus.body).includes('수령인에게 직접 연락'), false);

  const tamperedStatus = await handler({ method: 'POST', pathname: '/api/food-support/order-status', body: {
    orderId: '123456', orderAccessToken: `${submittedBody.orderAccess.token}x`
  } });
  assert.equal(tamperedStatus.status, 401);

  const issuedAccess = await handler({
    method: 'POST', pathname: '/api/food-support/order-access', authorization: `Bearer ${operatorSecret}`,
    body: { caseId: 'web_real_food_01', orderId: '123456' }
  });
  assert.equal(issuedAccess.status, 200);
  assert.equal(JSON.stringify(issuedAccess.body).includes('합성 배송지 1'), false);

  const wrongCaseAccess = await handler({
    method: 'POST', pathname: '/api/food-support/order-access', authorization: `Bearer ${operatorSecret}`,
    body: { caseId: 'web_other', orderId: '123456' }
  });
  assert.equal(wrongCaseAccess.status, 404);

  const replay = await handler(submitRequest);
  assert.equal(replay.status, 201);
  assert.equal((replay.body as { replayed: boolean }).replayed, true);
  assert.equal(supplierPosts, 1);
});

test('phone direct submit checks the same preview, holds the case budget and orders without an approval inbox', async () => {
  let supplierPosts = 0;
  let rollups = 0;
  const paidApprovals = new HmacPaidActionApprovalVerifier('d'.repeat(32));
  const orders = new SpecialOfferOrderAdapter(
    new CallbackSpecialOfferCredentialProvider(async () => 'test-credential-1234567890'),
    async (raw, init) => {
      const request = new Request(raw, init);
      if (request.method === 'POST') supplierPosts += 1;
      return Response.json({ data: {
        order_id: '777001', order_no: '26080312345678', seller_code: product.sellerCode, order_state: 2,
        goods_no: product.goodsNo, goods_name: product.name, sum_qty: 1, goods_price: 8300,
        shipping_fee: 4000, total_price: 12300, delivery_company: '', delivery_no: '', delivery_date: null
      } });
    },
    'https://specialoffer.kr',
    paidApprovals
  );
  const budgetLedger = new InMemoryFoodBudgetLedger();
  const handler = createSpecialOfferOrderHandlers({
    catalog: { async get() { return { status: 'LIVE', product }; } } as unknown as SpecialOfferCatalogAdapter,
    budgets: { async get() { return { remainingKrw: 50_000, maximumPurchaseKrw: 30_000 }; } },
    orders, paidApprovals, operatorSecret: operatorSecret,
    validateSession: async (_caseId, token) => token === 'phone-session',
    isDuplicateCase: async () => false,
    budgetLedger,
    resolveBudgetScope: async () => ({ beneficiaryRef: 'beneficiary-01', programId: 'food-pilot-2026', periodKey: '2026-08' }),
    rollupOrder: async () => { rollups += 1; },
    now: () => 1_785_577_000_000
  });
  const body = {
    caseId: 'phone_direct_01', sessionAccessToken: 'phone-session', goodsNo: product.goodsNo,
    quantity: 1, originalUtterance: '모듬잡곡 한 봉지 보내줘',
    recipient: { name: '합성이용자', cellphone: '010-0000-0000', zip: '00000', address: '합성 배송지 1' }
  };
  const preview = await handler({ method: 'POST', pathname: '/api/food-support/order-preview', body });
  const value = preview.body as { consentExpiresAt: number; previewProof: string; preview: { consentCommitment: string; totalPriceKrw: number } };
  const directRequest = {
    method: 'POST', pathname: '/api/food-support/order-submit-direct',
    authorization: `Bearer ${operatorSecret}`,
    body: {
      ...body,
      expectedConsentExpiresAt: value.consentExpiresAt,
      expectedConsentCommitment: value.preview.consentCommitment,
      expectedTotalKrw: value.preview.totalPriceKrw,
      previewProof: value.previewProof
    }
  } as const;
  const unauthorized = await handler({ method: directRequest.method, pathname: directRequest.pathname, body: directRequest.body });
  assert.equal(unauthorized.status, 401);
  assert.equal(supplierPosts, 0);
  const submitted = await handler(directRequest);
  assert.equal(submitted.status, 201);
  assert.equal((submitted.body as any).order.externalOrderId, '777001');
  assert.equal(supplierPosts, 1);
  assert.equal(rollups, 1);
  assert.equal((await budgetLedger.get('phone_direct_01'))?.status, 'COMMITTED');
});

test('ambiguous phone direct order can be reconciled without an approval request', async () => {
  let clock = 1_785_577_000_000;
  let supplierPosts = 0;
  let reconciledRollups = 0;
  const paidApprovals = new HmacPaidActionApprovalVerifier('r'.repeat(32));
  const responseBody = { data: {
    order_id: '777002', order_no: '26080312345679', seller_code: product.sellerCode, order_state: 2,
    goods_no: product.goodsNo, goods_name: product.name, sum_qty: 1, goods_price: 8300,
    shipping_fee: 4000, total_price: 12300, delivery_company: '', delivery_no: '', delivery_date: null
  } };
  const orders = new SpecialOfferOrderAdapter(
    new CallbackSpecialOfferCredentialProvider(async () => 'test-credential-1234567890'),
    async (raw, init) => {
      const request = new Request(raw, init);
      if (request.method === 'POST') {
        supplierPosts += 1;
        throw new Error('ambiguous supplier timeout');
      }
      return Response.json(responseBody);
    },
    'https://specialoffer.kr', paidApprovals
  );
  const budgetLedger = new InMemoryFoodBudgetLedger();
  const handler = createSpecialOfferOrderHandlers({
    catalog: { async get() { return { status: 'LIVE', product }; } } as unknown as SpecialOfferCatalogAdapter,
    budgets: { async get() { return { remainingKrw: 50_000, maximumPurchaseKrw: 30_000 }; } },
    orders, paidApprovals, operatorSecret: operatorSecret,
    validateSession: async (_caseId, token) => token === 'phone-session', isDuplicateCase: async () => false,
    budgetLedger,
    resolveBudgetScope: async () => ({ beneficiaryRef: 'beneficiary-02', programId: 'food-pilot-2026', periodKey: '2026-08' }),
    rollupReconciledOrder: async () => { reconciledRollups += 1; },
    now: () => clock
  });
  const body = {
    caseId: 'phone_direct_02', sessionAccessToken: 'phone-session', goodsNo: product.goodsNo,
    quantity: 1, originalUtterance: '모듬잡곡 한 봉지 보내줘',
    recipient: { name: '합성이용자', cellphone: '010-0000-0000', zip: '00000', address: '합성 배송지 2' }
  };
  const preview = await handler({ method: 'POST', pathname: '/api/food-support/order-preview', body });
  const value = preview.body as { consentExpiresAt: number; previewProof: string; preview: { consentCommitment: string; totalPriceKrw: number } };
  const submitted = await handler({
    method: 'POST', pathname: '/api/food-support/order-submit-direct', authorization: `Bearer ${operatorSecret}`,
    body: {
      ...body, expectedConsentExpiresAt: value.consentExpiresAt,
      expectedConsentCommitment: value.preview.consentCommitment,
      expectedTotalKrw: value.preview.totalPriceKrw, previewProof: value.previewProof
    }
  });
  assert.equal(submitted.status, 409);
  assert.deepEqual(
    { status: (submitted.body as any).status, reason: (submitted.body as any).reason },
    { status: 'ORDER_RECONCILIATION_REQUIRED', reason: 'AMBIGUOUS_RESPONSE' }
  );
  assert.equal(supplierPosts, 1);
  assert.equal((await budgetLedger.get('phone_direct_02'))?.status, 'RESERVED');

  const unauthorized = await handler({
    method: 'POST', pathname: '/api/food-support/order-reconcile-direct',
    body: { caseId: 'phone_direct_02', orderId: '777002' }
  });
  assert.equal(unauthorized.status, 401);
  clock += 2 * 60_000 + 1;
  const reconciled = await handler({
    method: 'POST', pathname: '/api/food-support/order-reconcile-direct', authorization: `Bearer ${operatorSecret}`,
    body: { caseId: 'phone_direct_02', orderId: '777002' }
  });
  assert.equal(reconciled.status, 200);
  assert.equal((reconciled.body as any).order.externalOrderId, '777002');
  assert.equal((await budgetLedger.get('phone_direct_02'))?.status, 'COMMITTED');
  assert.equal(reconciledRollups, 1);
  assert.equal(supplierPosts, 1);
});

test('mobile approval request encrypts recipient data and scoped ops executes the same preview once', async () => {
  let supplierPosts = 0;
  const credential = new CallbackSpecialOfferCredentialProvider(async () => 'test-credential-1234567890');
  const paidApprovals = new HmacPaidActionApprovalVerifier('p'.repeat(32));
  const fetcher: typeof fetch = async (raw, init) => {
    const request = new Request(raw, init);
    if (request.method === 'POST') supplierPosts += 1;
    return Response.json({ data: {
      order_id: '654321', order_no: '26080212345678', seller_code: product.sellerCode, order_state: 2,
      goods_no: product.goodsNo, goods_name: product.name, sum_qty: 1, goods_price: 8300,
      shipping_fee: 4000, total_price: 12300, delivery_company: '', delivery_no: '', delivery_date: null
    } });
  };
  const approvals = new InMemoryApprovalRequestRepository();
  const cipher = new ApprovalRequestCipher(Buffer.alloc(32, 7).toString('base64'));
  const handler = createSpecialOfferOrderHandlers({
    catalog: { async get() { return { status: 'LIVE', product }; } } as unknown as SpecialOfferCatalogAdapter,
    budgets: { async get() { return { remainingKrw: 100000, maximumPurchaseKrw: 50000 }; } },
    orders: new SpecialOfferOrderAdapter(credential, fetcher, 'https://specialoffer.kr', paidApprovals),
    paidApprovals, operatorSecret: operatorSecret,
    validateSession: async (_caseId, token) => token === 'session-token', isDuplicateCase: async () => false,
    authorizeOperator: (authorization, caseId, accessLevel) => caseId === 'web_approval_01'
      && (authorization === 'Bearer role-act' || (accessLevel === 'read' && authorization === 'Bearer role-read')),
    approvalRequests: approvals, approvalCipher: cipher, now: () => 1_785_577_000_000
  });
  const requestBody = {
    caseId: 'web_approval_01', sessionAccessToken: 'session-token', goodsNo: product.goodsNo,
    quantity: 1, originalUtterance: '모듬잡곡 보내줘',
    recipient: { name: '실제수령인', cellphone: '010-1111-2222', zip: '12345', address: '서울시 비공개 주소' }
  };
  const preview = await handler({ method: 'POST', pathname: '/api/food-support/order-preview', body: requestBody });
  const previewBody = preview.body as { consentExpiresAt: number; previewProof: string; preview: { consentCommitment: string; totalPriceKrw: number } };
  const approvalBody = {
    ...requestBody, expectedConsentCommitment: previewBody.preview.consentCommitment,
    expectedConsentExpiresAt: previewBody.consentExpiresAt, expectedTotalKrw: previewBody.preview.totalPriceKrw,
    previewProof: previewBody.previewProof
  };
  const requested = await handler({ method: 'POST', pathname: '/api/food-support/approval-request', body: approvalBody });
  assert.equal(requested.status, 201);
  assert.equal(supplierPosts, 0);
  const serialized = JSON.stringify(requested.body);
  assert.equal(serialized.includes('실제수령인'), false);
  assert.equal(serialized.includes('010-1111-2222'), false);
  assert.equal(serialized.includes('서울시 비공개 주소'), false);
  assert.equal(serialized.includes('encryptedPayload'), false);
  const requestId = (requested.body as { requestId: string }).requestId;
  const stored = await approvals.get(requestId);
  assert.ok(stored?.encryptedPayload.startsWith('v1.'));
  assert.equal(stored?.encryptedPayload.includes('실제수령인'), false);

  const deniedList = await handler({ method: 'POST', pathname: '/api/food-support/approval-list', authorization: 'Bearer role-read', body: { caseId: 'web_other' } });
  assert.equal(deniedList.status, 401);
  const listed = await handler({ method: 'POST', pathname: '/api/food-support/approval-list', authorization: 'Bearer role-read', body: { caseId: 'web_approval_01' } });
  assert.equal((listed.body as { requests: unknown[] }).requests.length, 1);
  const readOnlyExecute = await handler({ method: 'POST', pathname: '/api/food-support/approval-execute', authorization: 'Bearer role-read', body: { caseId: 'web_approval_01', requestId } });
  assert.equal(readOnlyExecute.status, 401);
  const executed = await handler({ method: 'POST', pathname: '/api/food-support/approval-execute', authorization: 'Bearer role-act', body: { caseId: 'web_approval_01', requestId } });
  assert.equal(executed.status, 201);
  assert.equal(supplierPosts, 1);
  assert.equal((executed.body as any).request.status, 'SUBMITTED');
  assert.equal((executed.body as any).request.externalOrderId, '654321');
  const repeated = await handler({ method: 'POST', pathname: '/api/food-support/approval-execute', authorization: 'Bearer role-act', body: { caseId: 'web_approval_01', requestId } });
  assert.equal(repeated.status, 409);
  assert.equal(supplierPosts, 1);

  const ciphertext = cipher.encrypt({ secret: 'recipient' });
  assert.throws(() => cipher.decrypt(`${ciphertext}x`), /Invalid approval ciphertext|authenticate/);
});

test('expired approval requires a fresh preview and explicit reconfirmation before replacement and rollup', async () => {
  let clock = 1_785_577_000_000;
  let supplierPosts = 0;
  const credential = new CallbackSpecialOfferCredentialProvider(async () => 'test-credential-1234567890');
  const paidApprovals = new HmacPaidActionApprovalVerifier('p'.repeat(32));
  const approvals = new InMemoryApprovalRequestRepository();
  const ledger = new InMemoryFoodBudgetLedger();
  const rollups: Array<{ caseId: string; orderId: string }> = [];
  const fetcher: typeof fetch = async () => {
    supplierPosts += 1;
    return Response.json({ data: {
      order_id: '777777', order_no: '26080277777777', seller_code: product.sellerCode, order_state: 2,
      goods_no: product.goodsNo, goods_name: product.name, sum_qty: 1, goods_price: 8300,
      shipping_fee: 4000, total_price: 12300
    } });
  };
  const handler = createSpecialOfferOrderHandlers({
    catalog: { async get() { return { status: 'LIVE', product }; } } as unknown as SpecialOfferCatalogAdapter,
    budgets: { async get() { return { remainingKrw: 100_000, maximumPurchaseKrw: 50_000 }; } },
    orders: new SpecialOfferOrderAdapter(credential, fetcher, 'https://specialoffer.kr', paidApprovals),
    paidApprovals, operatorSecret: operatorSecret,
    validateSession: async (_caseId, token) => token === 'fresh-session', isDuplicateCase: async () => false,
    authorizeOperator: (authorization, caseId, accessLevel) => authorization === 'Bearer role-act' && caseId === 'case_refresh' && accessLevel === 'act',
    approvalRequests: approvals,
    approvalCipher: new ApprovalRequestCipher(Buffer.alloc(32, 8).toString('base64')),
    budgetLedger: ledger,
    resolveBudgetScope: async () => ({ beneficiaryRef: 'beneficiary-1', programId: 'program-2026', periodKey: '2026-08' }),
    rollupOrder: async ({ prepared, order }) => { rollups.push({ caseId: prepared.caseId, orderId: order.externalOrderId }); },
    now: () => clock
  });
  const orderBody = {
    caseId: 'case_refresh', sessionAccessToken: 'fresh-session', goodsNo: product.goodsNo,
    quantity: 1, originalUtterance: '모듬잡곡 보내줘',
    recipient: { name: '수령인', cellphone: '010-1111-2222', zip: '12345', address: '서울시 비공개 주소' }
  };
  const preview = await handler({ method: 'POST', pathname: '/api/food-support/order-preview', body: orderBody });
  const p = preview.body as any;
  const requested = await handler({ method: 'POST', pathname: '/api/food-support/approval-request', body: {
    ...orderBody, expectedConsentExpiresAt: p.consentExpiresAt,
    expectedConsentCommitment: p.preview.consentCommitment, expectedTotalKrw: p.preview.totalPriceKrw, previewProof: p.previewProof
  } });
  const oldId = (requested.body as { requestId: string }).requestId;
  clock = p.consentExpiresAt + 1;
  const refreshPreview = await handler({ method: 'POST', pathname: '/api/food-support/approval-refresh-preview', body: {
    requestId: oldId, sessionAccessToken: 'fresh-session'
  } });
  assert.equal(refreshPreview.status, 200);
  assert.equal(supplierPosts, 0);
  const rp = refreshPreview.body as any;
  const denied = await handler({ method: 'POST', pathname: '/api/food-support/approval-refresh-confirm', body: {
    requestId: oldId, sessionAccessToken: 'fresh-session', userReconfirmed: false
  } });
  assert.equal(denied.status, 409);
  const replaced = await handler({ method: 'POST', pathname: '/api/food-support/approval-refresh-confirm', body: {
    requestId: oldId, sessionAccessToken: 'fresh-session', userReconfirmed: true,
    expectedConsentExpiresAt: rp.consentExpiresAt, expectedConsentCommitment: rp.preview.consentCommitment,
    expectedTotalKrw: rp.preview.totalPriceKrw, previewProof: rp.previewProof
  } });
  assert.equal(replaced.status, 201);
  assert.equal((await approvals.get(oldId))?.status, 'REPLACED');
  const newRequest = (replaced.body as any).request;
  assert.equal(newRequest.status, 'PENDING');
  const executed = await handler({
    method: 'POST', pathname: '/api/food-support/approval-execute', authorization: 'Bearer role-act',
    body: { caseId: 'case_refresh', requestId: newRequest.requestId }
  });
  assert.equal(executed.status, 201);
  assert.equal(supplierPosts, 1);
  assert.deepEqual(rollups, [{ caseId: 'case_refresh', orderId: '777777' }]);
  assert.equal((await ledger.get('case_refresh'))?.status, 'COMMITTED');
});
