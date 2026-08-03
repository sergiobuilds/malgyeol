import test from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonMandateRepository } from '../../src/g3/repository.ts';
import { Coordinator } from '../../src/g3/coordinator.ts';
import { SwigInputBuilder } from '../../src/g3/swigAdapter.ts';
import type { Clock, PolicyMandate, OrderRequest, Signer, SigningEnvelope } from '../../src/g3/types.ts';

class MockSigner implements Signer {
  failNext = false;
  calls = 0;
  lastEnvelope?: SigningEnvelope;
  async sign(envelope: SigningEnvelope) {
    this.calls += 1;
    this.lastEnvelope = envelope;
    if (this.failNext) { this.failNext = false; throw new Error('Signer hardware failure'); }
    return { signature: `sig-${envelope.orderNonce}` };
  }
}

const baseMandate: PolicyMandate = {
  mandateId: 'm-123', revision: 1, fundId: 'fund-1', approvedSku: 'DEMO_MEAL_01',
  merchantId: 'merch-1', mint: 'MINT_A', escrowDestination: 'ESCROW_A', exactAmount: 500n,
  validFrom: 1000, validUntil: 2000, remainingBalance: 1500n, revoked: false
};
const baseRequest: OrderRequest = {
  mandateId: 'm-123', fundId: 'fund-1', sku: 'DEMO_MEAL_01', merchantId: 'merch-1', mint: 'MINT_A',
  destinationAccount: 'ESCROW_A', amount: 500n, consentCommitment: 'a'.repeat(64),
  orderNonce: 'b'.repeat(64)
};

class FixedClock implements Clock {
  current = 1500;
  now() { return this.current; }
}

async function setupEnv() {
  const dir = await mkdtemp(join(tmpdir(), 'g3-test-'));
  const filePath = join(dir, 'repo.json');
  const repo = new JsonMandateRepository(filePath);
  await repo.createOrUpdateMandate(baseMandate);
  const signer = new MockSigner();
  const clock = new FixedClock();
  return { dir, filePath, repo, signer, clock, coordinator: new Coordinator(repo, signer, clock) };
}

test('successful authorization creates a PII-free immutable envelope', async (t) => {
  const { dir, coordinator, repo, signer } = await setupEnv();
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.ok((await coordinator.authorizeAndSign(baseRequest)).signature);
  assert.strictEqual((await repo.readState()).mandates['m-123'].remainingBalance, 1000n);
  const envelope = signer.lastEnvelope as SigningEnvelope;
  assert.strictEqual(envelope.mandateHash.length, 64);
  assert.strictEqual((envelope as unknown as Record<string, unknown>).beneficiaryName, undefined);
  assert.strictEqual(envelope.fundId, 'fund-1');
  assert.ok(Object.isFrozen(envelope));
});

test('restart persistence prevents replay and preserves balances', async (t) => {
  const { dir, filePath, coordinator } = await setupEnv();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await coordinator.authorizeAndSign(baseRequest);
  const restarted = new JsonMandateRepository(filePath);
  await assert.rejects(new Coordinator(restarted, new MockSigner(), new FixedClock()).authorizeAndSign(baseRequest), /Replay/);
  assert.strictEqual((await restarted.readState()).mandates['m-123'].remainingBalance, 1000n);
});

test('concurrent replay yields exactly one signature', async (t) => {
  const { dir, coordinator, signer, clock } = await setupEnv();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => coordinator.authorizeAndSign(baseRequest)));
  assert.strictEqual(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.strictEqual(results.filter((result) => result.status === 'rejected').length, 4);
  assert.strictEqual(signer.calls, 1);
});

test('concurrent unique orders cannot exceed remaining balance', async (t) => {
  const { dir, coordinator, repo } = await setupEnv();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const results = await Promise.allSettled(Array.from({ length: 4 }, (_, index) => coordinator.authorizeAndSign({
    ...baseRequest,
    orderNonce: index.toString(16).padStart(64, '0')
  })));
  assert.strictEqual(results.filter((result) => result.status === 'fulfilled').length, 3);
  assert.strictEqual(results.filter((result) => result.status === 'rejected').length, 1);
  assert.strictEqual((await repo.readState()).mandates['m-123'].remainingBalance, 0n);
});

test('signer failure is terminal and cannot replay', async (t) => {
  const { dir, coordinator, signer, repo } = await setupEnv();
  t.after(() => rm(dir, { recursive: true, force: true }));
  signer.failNext = true;
  await assert.rejects(coordinator.authorizeAndSign(baseRequest), /Signer failed/);
  assert.strictEqual((await repo.readState()).nonces[baseRequest.orderNonce], 'SIGN_FAILED');
  await assert.rejects(coordinator.authorizeAndSign(baseRequest), /Replay/);
});

test('all policy mismatches fail before signer invocation', async (t) => {
  const { dir, coordinator, signer, clock } = await setupEnv();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cases: Array<[Partial<OrderRequest>, RegExp]> = [
    [{ mandateId: 'wrong' }, /Mandate not found/], [{ fundId: 'wrong' }, /fundId/], [{ sku: 'wrong' }, /SKU/], [{ merchantId: 'wrong' }, /merchant/],
    [{ mint: 'wrong' }, /mint/], [{ destinationAccount: 'wrong' }, /destination/], [{ amount: 100n }, /amount/],
    [{ consentCommitment: 'short' }, /consentCommitment/], [{ orderNonce: 'short' }, /orderNonce/]
  ];
  for (const [change, message] of cases) await assert.rejects(coordinator.authorizeAndSign({ ...baseRequest, ...change }), message);
  clock.current = 999;
  await assert.rejects(coordinator.authorizeAndSign({ ...baseRequest, orderNonce: 'c'.repeat(64) }), /not-yet-valid/);
  clock.current = 2001;
  await assert.rejects(coordinator.authorizeAndSign({ ...baseRequest, orderNonce: 'd'.repeat(64) }), /expired/);
  clock.current = Number.NaN;
  await assert.rejects(coordinator.authorizeAndSign({ ...baseRequest, orderNonce: 'e'.repeat(64) }), /Clock failure/);
  assert.strictEqual(signer.calls, 0);
});

test('revocation and exhaustion fail closed', async (t) => {
  const { dir, repo, coordinator, signer } = await setupEnv();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await repo.revokeMandate('m-123', 1);
  await assert.rejects(coordinator.authorizeAndSign(baseRequest), /revoked/);
  assert.strictEqual(signer.calls, 0);
});

test('corrupt persisted schema fails closed', async (t) => {
  const { dir, filePath, repo } = await setupEnv();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(filePath, '{"mandates":{},"nonces":{"bad":"INVALID"}}');
  await assert.rejects(repo.reserve('m-123', 1, 'a'.repeat(64), 500n, 'c'.repeat(64)), /Invalid schema/);
});

test('caller cannot forge policy fields for an existing mandate revision', async (t) => {
  const { dir, coordinator, signer } = await setupEnv();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(coordinator.authorizeAndSign({
    ...baseRequest,
    merchantId: 'attacker-merchant',
    destinationAccount: 'ATTACKER_ATA'
  }), /merchant/);
  assert.strictEqual(signer.calls, 0);
});

test('Swig limit mapping binds mint, destination and cumulative amount', () => {
  assert.deepStrictEqual(SwigInputBuilder.buildLimitFromMandate(baseMandate), {
    mint: 'MINT_A', destinationTokenAccount: 'ESCROW_A', cumulativeAmount: 500n
  });
});
