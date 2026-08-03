import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicFoodOrderProofReader, readPublicFoodOrderProof } from '../../src/http/publicFoodOrderProof.ts';

test('public food order proof exposes only the fixed live order PII-free projection', async () => {
  let requested = '';
  const result = await readPublicFoodOrderProof({
    async getByOrderId(orderId: string) {
      requested = orderId;
      return { status: 'LIVE' as const, order: {
        externalOrderId: '585492', externalOrderNo: '26080121204025', sellerCode: 'SC00005832', goodsNo: '318346',
        goodsName: '모듬잡곡 700g', quantity: 1, goodsPriceKrw: 8300, shippingFeeKrw: 4000,
        totalPriceKrw: 12300, providerOrderState: 2, deliveryState: 'PREPARING' as const,
        source: 'SPECIAL_OFFER_LIVE' as const
      } };
    }
  }, 1_785_630_000_000);
  assert.equal(requested, '585492');
  assert.deepEqual(result, { status: 200, body: {
    externalOrderId: '585492', externalOrderNo: '26080121204025', goodsName: '모듬잡곡 700g', quantity: 1,
    totalPriceKrw: 12300, deliveryState: 'PREPARING', hasTracking: false,
    source: 'SPECIAL_OFFER_LIVE', refreshedAt: 1_785_630_000_000
  } });
  const serialized = JSON.stringify(result);
  for (const forbidden of ['sellerCode', 'goodsNo', 'beneficiary', 'recipient', 'address', 'phone']) assert.equal(serialized.includes(forbidden), false);
});

test('public food order proof fails closed on wrong supplier identity', async () => {
  const result = await readPublicFoodOrderProof({
    async getByOrderId() {
      return { status: 'LIVE' as const, order: {
        externalOrderId: 'other', externalOrderNo: 'x', sellerCode: 'seller', goodsName: '잡곡', quantity: 1,
        goodsPriceKrw: 1, shippingFeeKrw: 0, totalPriceKrw: 1, providerOrderState: 2,
        deliveryState: 'PREPARING' as const, source: 'SPECIAL_OFFER_LIVE' as const
      } };
    }
  });
  assert.deepEqual(result, { status: 502, body: { error: 'SUPPLIER_READBACK_MISMATCH' } });
});

test('public proof reader coalesces concurrent reads and caches only a verified result', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let now = 100;
  const reader = createPublicFoodOrderProofReader({
    async getByOrderId() {
      calls += 1;
      await gate;
      return { status: 'LIVE' as const, order: {
        externalOrderId: '585492', externalOrderNo: '26080121204025', sellerCode: 'SC00005832', goodsNo: '318346',
        goodsName: '모듬잡곡 700g', quantity: 1, goodsPriceKrw: 8300, shippingFeeKrw: 4000,
        totalPriceKrw: 12300, providerOrderState: 2, deliveryState: 'PREPARING' as const,
        source: 'SPECIAL_OFFER_LIVE' as const
      } };
    }
  }, { ttlMs: 60, now: () => now });
  const first = reader();
  const concurrent = reader();
  release();
  assert.deepEqual(await first, await concurrent);
  assert.equal(calls, 1);
  await reader();
  assert.equal(calls, 1);
  now = 161;
  await reader();
  assert.equal(calls, 2);
});
