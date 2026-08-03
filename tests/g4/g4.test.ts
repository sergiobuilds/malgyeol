import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerCore } from '../../src/g4/serverCore.ts';
import { TraceRepo } from '../../src/g4/traceRepo.ts';
import { hashString } from '../../src/g4/fingerprint.ts';
import { ExactSwigSvmScheme } from '../../src/g4/swigClient.ts';
import { DEVNET_NETWORK } from '../../src/g4/payKitAdapter.ts';
import { FIXED_AMOUNT, FIXED_MINT, FIXED_SKU } from '../../src/g4/types.ts';
import type { Gateway, GatewayResult, PaidJournal, PaymentIntent, RawRequest, Receipt } from '../../src/g4/types.ts';
import { address, generateKeyPairSigner } from '@solana/kit';
import type { PaymentRequirements } from '@x402/core/types';

class FakeProtocolGateway implements Gateway {
  calls = 0;
  next!: GatewayResult;
  intents: Readonly<PaymentIntent>[] = [];
  async process(_request: RawRequest, intent: Readonly<PaymentIntent>): Promise<GatewayResult> {
    this.calls += 1;
    this.intents.push(intent);
    return this.next;
  }
}

describe('G4 deterministic application core, not Devnet evidence', () => {
  let directory: string;
  let repo: TraceRepo;
  let gateway: FakeProtocolGateway;
  let fulfillments: Array<{ receipt: Receipt; key: string }>;
  let core: ServerCore;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'benefit-g4-'));
    repo = new TraceRepo(directory);
    gateway = new FakeProtocolGateway();
    fulfillments = [];
    core = new ServerCore('MERCHANT_OWNER', gateway, repo, async (receipt, key) => { fulfillments.push({ receipt, key }); });
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  test('first request preserves and hashes exact PAYMENT-REQUIRED bytes', async () => {
    const header = 'eyJ4NDAyVmVyc2lvbiI6Mn0=';
    gateway.next = { kind: 'challenge', response: '{"accepts":[]}', exactPaymentRequiredHeader: header };
    const request = validRequest('a'.repeat(32));
    const result = await core.handle(request);
    assert.strictEqual(result.status, 402);
    assert.strictEqual(result.headers['payment-required'], header);
    const intent = repo.getIntent(request.idempotencyKey);
    assert.strictEqual(intent?.paymentRequiredHeaderHash, hashString(header));
    assert.match(intent?.paymentIntentId ?? '', /^pi_[a-f0-9]{32}$/);
    assert.strictEqual(gateway.intents[0].paymentIntentId, intent?.paymentIntentId);
  });

  test('same idempotency key with changed bytes fails before gateway', async () => {
    const key = 'b'.repeat(32);
    gateway.next = { kind: 'challenge', response: 'pay', exactPaymentRequiredHeader: 'challenge' };
    assert.strictEqual((await core.handle(validRequest(key))).status, 402);
    const changed = validRequest(key, 'ORDER_2');
    assert.strictEqual((await core.handle(changed)).status, 409);
    assert.strictEqual(gateway.calls, 1);
  });

  test('paid retry creates one fixed-term receipt without raw payment credential', async () => {
    gateway.next = {
      kind: 'paid',
      settlementTransaction: 'tx_123',
      paymentResponseHeader: 'settlement-header',
      paymentCredentialHash: 'c'.repeat(64)
    };
    const request = { ...validRequest('c'.repeat(32)), paymentHeader: 'RAW_SECRET_PAYMENT_CREDENTIAL' };
    const result = await core.handle(request);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.headers['payment-response'], 'settlement-header');
    assert.strictEqual(result.headers['x-payment-response'], 'settlement-header');
    const receipt = JSON.parse(result.body.toString()) as Receipt;
    assert.strictEqual(receipt.mint, FIXED_MINT);
    assert.strictEqual(receipt.baseUnits, FIXED_AMOUNT);
    assert.strictEqual(receipt.merchant, 'MERCHANT_OWNER');
    assert.strictEqual(receipt.transaction, 'tx_123');
    assert.strictEqual(fulfillments.length, 1);
    const persisted = JSON.stringify(repo.getIntent(request.idempotencyKey));
    assert.ok(!persisted.includes('RAW_SECRET_PAYMENT_CREDENTIAL'));
    assert.ok(!persisted.includes('c'.repeat(64)));
  });

  test('duplicate and restarted core return identical receipt without gateway or fulfillment', async () => {
    const request = validRequest('d'.repeat(32));
    gateway.next = { kind: 'paid', settlementTransaction: 'tx_restart', paymentResponseHeader: 'hdr_restart', paymentCredentialHash: 'd'.repeat(64) };
    const first = await core.handle(request);
    const firstBody = first.body.toString();
    const restartedGateway = new FakeProtocolGateway();
    const restartedFulfillments: Receipt[] = [];
    const restarted = new ServerCore('MERCHANT_OWNER', restartedGateway, new TraceRepo(directory), async (receipt) => { restartedFulfillments.push(receipt); });
    const second = await restarted.handle(request);
    assert.strictEqual(second.body.toString(), firstBody);
    assert.strictEqual(second.headers['payment-response'], 'hdr_restart');
    assert.strictEqual(restartedGateway.calls, 0);
    assert.strictEqual(restartedFulfillments.length, 0);
  });

  test('concurrent duplicate invokes gateway and fulfillment exactly once', async () => {
    const request = validRequest('e'.repeat(32));
    gateway.next = { kind: 'paid', settlementTransaction: 'tx_concurrent', paymentResponseHeader: 'hdr', paymentCredentialHash: 'e'.repeat(64) };
    const results = await Promise.all([core.handle(request), core.handle(request), core.handle(request)]);
    assert.deepStrictEqual(results.map((result) => result.status), [200, 200, 200]);
    assert.strictEqual(gateway.calls, 1);
    assert.strictEqual(fulfillments.length, 1);
    assert.strictEqual(new Set(results.map((result) => result.body.toString())).size, 1);
  });

  test('rejects method, path, malformed body, extra price, wrong SKU and bad idempotency', async () => {
    const base = validRequest('f'.repeat(32));
    const cases: RawRequest[] = [
      { ...base, method: 'GET' },
      { ...base, pathname: '/other' },
      { ...base, bodyBytes: Buffer.from('{') },
      { ...base, bodyBytes: Buffer.from(JSON.stringify({ orderId: 'ORDER_1', sku: FIXED_SKU, price: '0.01' })) },
      { ...base, bodyBytes: Buffer.from(JSON.stringify({ orderId: 'ORDER_1', sku: 'ALCOHOL' })) },
      { ...base, idempotencyKey: 'bad-key' }
    ];
    for (const request of cases) assert.notStrictEqual((await core.handle(request)).status, 200);
    assert.strictEqual(gateway.calls, 0);
  });

  test('Swig client rejects every challenge-term substitution before RPC or signing', async () => {
    const authority = await generateKeyPairSigner();
    const merchant = address('67fxkr8sXc98ThKX6HnoEytCRCJJHHnsGaQV3bLB5vk3');
    const feePayer = address('3EvTC5bPzJJxf9Wsy9borauPkvm2y1WdT265iK2F7TMM');
    const scheme = new ExactSwigSvmScheme(authority, address('11111111111111111111111111111111'), {
      merchant,
      feePayer,
      paymentIntentId: 'pi_31bac78f3b8766e8664265a04361e3f1'
    }, 'http://127.0.0.1:1');
    const valid: PaymentRequirements = {
      scheme: 'exact', network: DEVNET_NETWORK, asset: FIXED_MINT, amount: String(FIXED_AMOUNT), payTo: merchant,
      maxTimeoutSeconds: 300,
      extra: { feePayer, memo: 'pi_31bac78f3b8766e8664265a04361e3f1' }
    };
    const attacks: Array<[number, PaymentRequirements]> = [
      [1, valid],
      [2, { ...valid, scheme: 'upto' }],
      [2, { ...valid, network: 'solana:mainnet' }],
      [2, { ...valid, asset: 'WRONG_MINT' }],
      [2, { ...valid, amount: String(FIXED_AMOUNT + 1) }],
      [2, { ...valid, payTo: authority.address }],
      [2, { ...valid, extra: { ...valid.extra, feePayer: authority.address } }],
      [2, { ...valid, extra: { ...valid.extra, memo: 'pi_00000000000000000000000000000000' } }]
    ];
    for (const [version, requirements] of attacks) {
      await assert.rejects(scheme.createPaymentPayload(version, requirements));
    }
  });

  test('callback failure persists PAID journal, retry drains same key without gateway repeat', async () => {
    let attempts = 0;
    const effects = new Map<string, Receipt>();
    const callback = async (receipt: Receipt, key: string) => {
      attempts += 1;
      if (attempts === 1) throw new Error('transient merchant failure');
      if (!effects.has(key)) effects.set(key, receipt);
    };
    const retryCore = new ServerCore('MERCHANT_OWNER', gateway, repo, callback);
    const request = validRequest('7'.repeat(32));
    gateway.next = { kind: 'paid', settlementTransaction: 'tx_fail', paymentResponseHeader: 'hdr_fail', paymentCredentialHash: '7'.repeat(64) };
    const first = await retryCore.handle(request);
    assert.strictEqual(first.status, 503);
    assert.strictEqual(first.headers['retry-after'], '1');
    assert.strictEqual(gateway.calls, 1);
    const persistedIntent = repo.getIntent(request.idempotencyKey)!;
    assert.strictEqual(persistedIntent.state, 'PAID');
    assert.strictEqual(repo.getJournal(persistedIntent.eventId)?.outboxState, 'PENDING');

    const restartedGateway = new FakeProtocolGateway();
    const restarted = new ServerCore('MERCHANT_OWNER', restartedGateway, new TraceRepo(directory), callback);
    const second = await restarted.handle(request);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(restartedGateway.calls, 0);
    assert.strictEqual(effects.size, 1);
    const fulfillmentKey = [...effects.keys()][0];
    assert.match(fulfillmentKey, /^ful_[a-f0-9]{64}$/);
    assert.strictEqual(repo.getJournal(persistedIntent.eventId)?.outboxState, 'DONE');
    const third = await restarted.handle(request);
    assert.strictEqual(third.body.toString(), second.body.toString());
    assert.strictEqual(attempts, 2);
  });

  test('journal-only crash recovery projects PAID and fulfills without gateway', async () => {
    const request = validRequest('8'.repeat(32));
    gateway.next = { kind: 'challenge', response: 'challenge', exactPaymentRequiredHeader: 'required' };
    assert.strictEqual((await core.handle(request)).status, 402);
    const intent = repo.getIntent(request.idempotencyKey)!;
    const receipt: Receipt = {
      eventId: intent.eventId,
      orderId: intent.orderId,
      paymentIntentId: intent.paymentIntentId,
      fingerprint: intent.fingerprint,
      mint: FIXED_MINT,
      baseUnits: FIXED_AMOUNT,
      merchant: 'MERCHANT_OWNER',
      transaction: 'tx_crash',
      paymentResponseHash: hashString('hdr_crash')
    };
    const journal: PaidJournal = {
      eventId: intent.eventId,
      receipt,
      paymentResponseHeader: 'hdr_crash',
      paidBodyHex: Buffer.from(JSON.stringify(receipt)).toString('hex'),
      settlementTransaction: receipt.transaction,
      fulfillmentKey: `ful_${hashString(`${intent.eventId}:${receipt.transaction}`)}`,
      outboxState: 'PENDING'
    };
    repo.saveJournal(journal);

    const recoveredGateway = new FakeProtocolGateway();
    const recoveredEffects = new Map<string, Receipt>();
    const recovered = new ServerCore('MERCHANT_OWNER', recoveredGateway, new TraceRepo(directory), async (value, key) => { recoveredEffects.set(key, value); });
    const result = await recovered.handle(request);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(recoveredGateway.calls, 0);
    assert.strictEqual(recoveredEffects.size, 1);
    assert.strictEqual(repo.getIntent(request.idempotencyKey)?.state, 'PAID');
    assert.strictEqual(repo.getReceipt(intent.eventId)?.transaction, 'tx_crash');
    assert.strictEqual(repo.getJournal(intent.eventId)?.outboxState, 'DONE');
  });

  test('paid journal immutable identity and monotonic DONE state reject tampering', async () => {
    const request = validRequest('9'.repeat(32));
    writeFileSync(join(directory, 'journals', `evt_${'a'.repeat(32)}.json.123e4567-e89b-12d3-a456-426614174000.tmp`), 'partial');
    gateway.next = { kind: 'paid', settlementTransaction: 'tx_tamper', paymentResponseHeader: 'hdr_tamper', paymentCredentialHash: '9'.repeat(64) };
    assert.strictEqual((await core.handle(request)).status, 200);
    const intent = repo.getIntent(request.idempotencyKey)!;
    const done = repo.getJournal(intent.eventId)!;
    assert.strictEqual(done.outboxState, 'DONE');
    assert.throws(() => repo.saveJournal({ ...done, outboxState: 'PENDING' }), /cannot return/);
    const changedReceipt = { ...done.receipt, transaction: 'tx_other' };
    assert.throws(() => repo.saveJournal({
      ...done,
      receipt: changedReceipt,
      settlementTransaction: changedReceipt.transaction,
      paidBodyHex: Buffer.from(JSON.stringify(changedReceipt)).toString('hex')
    }), /immutable fields changed/);
  });
});

function validRequest(idempotencyKey: string, orderId = 'ORDER_1'): RawRequest {
  return {
    method: 'POST',
    pathname: '/orders',
    bodyBytes: Buffer.from(JSON.stringify({ orderId, sku: FIXED_SKU })),
    idempotencyKey
  };
}
