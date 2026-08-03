import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { HttpMerchantSandboxAdapter } from '../../src/merchant/httpMerchantAdapter.ts';
import { MerchantSandbox, createMerchantSandboxNodeHandler } from '../../src/merchant/sandbox.ts';
import { InMemoryMerchantSandboxStore } from '../../src/merchant/store.ts';

const input = {
  caseId: 'case_http_001', sku: 'ASSISTIVE_STAND_AID_01', quantity: 1,
  merchantId: 'DEMO_ACCESS_STORE', programAmountKrw: 380_000, paymentIntentId: 'pay_http_001'
};

async function fixture() {
  const server = createServer(createMerchantSandboxNodeHandler());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  return { base: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

test('actual HTTP sandbox creates a stable idempotent order and exposes tracking', async () => {
  const app = await fixture();
  try {
    const adapter = new HttpMerchantSandboxAdapter(app.base);
    const first = await adapter.submit(input);
    const replay = await adapter.submit(input);
    assert.equal(first.providerOrderId, replay.providerOrderId);
    assert.match(first.providerOrderId, /^SANDBOX-[A-F0-9]{16}$/);
    assert.deepEqual(await adapter.track(first.providerOrderId), { sandbox: true, providerOrderId: first.providerOrderId, state: 'ORDERED' });
  } finally { await app.close(); }
});

test('changed idempotent replay conflicts and schema rejects non-allowlisted or PII fields', async () => {
  const app = await fixture();
  try {
    const created = await fetch(`${app.base}/sandbox/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(created.status, 201);
    const conflict = await fetch(`${app.base}/sandbox/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, quantity: 2 }) });
    assert.equal(conflict.status, 409);
    const disallowed = await fetch(`${app.base}/sandbox/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, caseId: 'case_http_002', sku: 'FIREARM_01' }) });
    assert.equal(disallowed.status, 400);
    const pii = await fetch(`${app.base}/sandbox/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, caseId: 'case_http_003', phoneNumber: '01000000000' }) });
    assert.equal(pii.status, 400);
  } finally { await app.close(); }
});

test('tracking permits only one-way adjacent transitions', async () => {
  const app = await fixture();
  try {
    const adapter = new HttpMerchantSandboxAdapter(app.base);
    const order = await adapter.submit(input);
    const endpoint = `${app.base}/sandbox/orders/${order.providerOrderId}/tracking`;
    const jump = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: 'DELIVERED' }) });
    assert.equal(jump.status, 409);
    for (const state of ['PACKED', 'SHIPPED', 'DELIVERED']) {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state }) });
      assert.equal(response.status, 200);
    }
    const backwards = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: 'SHIPPED' }) });
    assert.equal(backwards.status, 409);
    assert.equal((await adapter.track(order.providerOrderId)).state, 'DELIVERED');
  } finally { await app.close(); }
});

test('shared durable store preserves order and tracking across sandbox restarts', async () => {
  const store = new InMemoryMerchantSandboxStore();
  const firstSandbox = new MerchantSandbox(store);
  const created = await firstSandbox.handle(new Request('http://sandbox.local/sandbox/orders', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input)
  }));
  assert.equal(created.status, 201);
  const order = await created.json() as { providerOrderId: string };
  const advanced = await firstSandbox.handle(new Request(`http://sandbox.local/sandbox/orders/${order.providerOrderId}/tracking`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: 'PACKED' })
  }));
  assert.equal(advanced.status, 200);

  const restartedSandbox = new MerchantSandbox(store);
  const replay = await restartedSandbox.handle(new Request('http://sandbox.local/sandbox/orders', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input)
  }));
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), {
    sandbox: true,
    provider: 'BENEFIT_RAIL_SELF_OWNED_SANDBOX',
    providerOrderId: order.providerOrderId,
    state: 'PACKED',
    replayed: true
  });
});

test('configured write secret blocks public order and tracking mutations', async () => {
  const writeSecret = 'merchant-write-secret-at-least-32-characters';
  const server = createServer(createMerchantSandboxNodeHandler(new MerchantSandbox(), writeSecret));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${base}/sandbox/orders`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input)
    })).status, 401);
    const adapter = new HttpMerchantSandboxAdapter(base, fetch, writeSecret);
    const order = await adapter.submit(input);
    assert.equal((await fetch(`${base}/sandbox/orders/${order.providerOrderId}/tracking`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: 'PACKED' })
    })).status, 401);
    assert.equal((await adapter.track(order.providerOrderId)).state, 'ORDERED');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
