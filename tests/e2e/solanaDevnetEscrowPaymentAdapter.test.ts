import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import { PROGRAM_ID, USDC_MINT, getOrderEscrowPDA, getVaultATA } from '../../src/g5/escrowClient.ts';
import {
  SolanaDevnetEscrowPaymentAdapter,
  deriveOrderCommitment
} from '../../src/e2e/solanaDevnetEscrowPaymentAdapter.ts';

const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const CONFIRMATION = 'ab'.repeat(32);

function setup(overrides: { genesisHash?: string; vaultDelta?: number } = {}) {
  const institution = Keypair.generate();
  const merchant = Keypair.generate().publicKey;
  const delivery = Keypair.generate().publicKey;
  let initializeCalls = 0;
  let fundCalls = 0;
  let capturedCommitment: Uint8Array | undefined;

  const adapter = new SolanaDevnetEscrowPaymentAdapter({
    rpcUrl: 'https://api.devnet.solana.com',
    institutionSigner: institution,
    merchant,
    deliveryAuthority: delivery,
    programId: PROGRAM_ID,
    traceDirectory: '/tmp/benefit-settlement-test-traces'
  }, {
    getGenesisHash: async () => overrides.genesisHash ?? DEVNET_GENESIS_HASH,
    getChainTime: async () => 2_000_000_000n,
    initialize: async input => {
      initializeCalls += 1;
      capturedCommitment = input.commitment;
      assert.equal(input.amount, 1_000_000n);
      assert.equal(input.expiresAt, 2_000_000_600n);
      return 'init-signature';
    },
    fund: async input => {
      fundCalls += 1;
      assert.equal(input.amount, 1_000_000n);
      assert.equal(input.vaultAta.toBase58(), getVaultATA(input.orderPda).toBase58());
      return {
        swigAccount: Keypair.generate().publicKey.toBase58(),
        authorityPubkey: Keypair.generate().publicKey.toBase58(),
        challengeStatus: 402,
        challengeTerms: {},
        paidStatus: 200,
        paymentResponse: 'encoded-payment-response',
        devnetSettlementSignature: 'settlement-signature',
        rpcMeta: {},
        rpcSlot: 123,
        vaultDelta: overrides.vaultDelta ?? 1_000_000,
        fulfillmentCount: 1,
        challengeSha256: '1'.repeat(64),
        paymentResponseSha256: '2'.repeat(64),
        network: 'solana:devnet',
        asset: USDC_MINT.toBase58(),
        amount: '1000000',
        payTo: input.orderPda.toBase58()
      };
    }
  });

  return {
    adapter,
    calls: () => ({ initializeCalls, fundCalls }),
    commitment: () => capturedCommitment
  };
}

const input = {
  caseId: 'case_same_across_phone_policy_payment_order',
  sku: 'ACCESS-CHAIR-001',
  merchantId: 'DEMO_ACCESS_STORE',
  settlementProofBaseUnits: 1_000_000,
  confirmationCommitment: CONFIRMATION
};

test('derives a deterministic domain-separated 32-byte order commitment from case and consent', () => {
  const first = deriveOrderCommitment(input.caseId, CONFIRMATION);
  const second = deriveOrderCommitment(input.caseId, CONFIRMATION);
  assert.equal(first.length, 32);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, deriveOrderCommitment(`${input.caseId}-other`, CONFIRMATION));
  assert.throws(() => deriveOrderCommitment(input.caseId, 'not-a-digest'), /32-byte hex digest/);
});

test('initializes the escrow, funds its derived vault via x402, and exposes non-PII recovery metadata', async () => {
  const harness = setup();
  const receipt = await harness.adapter.pay(input);
  const commitment = harness.commitment();
  assert.ok(commitment);
  const [expectedPda] = getOrderEscrowPDA(commitment);

  assert.deepEqual(harness.calls(), { initializeCalls: 1, fundCalls: 1 });
  assert.equal(receipt.paymentIntentId, 'x402_devnet_3b1a1d6344d1bcd0e6786b37');
  assert.equal(receipt.settlementTransaction, 'settlement-signature');
  assert.equal(receipt.settlementProofBaseUnits, 1_000_000);
  assert.equal(receipt.orderCommitment, Buffer.from(commitment).toString('hex'));
  assert.equal(receipt.orderPda, expectedPda.toBase58());
  assert.equal(receipt.vaultAta, getVaultATA(expectedPda).toBase58());
  assert.equal(receipt.escrowProgramId, PROGRAM_ID.toBase58());
  assert.equal(receipt.mint, USDC_MINT.toBase58());
  assert.equal(receipt.initializeTransaction, 'init-signature');
  assert.equal(receipt.escrowExpiresAt, 2_000_000_600);
  assert.equal(receipt.x402Network, 'solana:devnet');
  assert.equal(receipt.x402Asset, USDC_MINT.toBase58());
  assert.equal(receipt.x402Amount, '1000000');
  assert.equal(receipt.x402PayTo, expectedPda.toBase58());
  assert.equal(receipt.rpcSlot, 123);
  assert.equal(JSON.stringify(receipt).includes(institutionSecretMarker()), false);
});

test('coalesces concurrent duplicate payment attempts for the same case', async () => {
  const harness = setup();
  const [first, second] = await Promise.all([harness.adapter.pay(input), harness.adapter.pay(input)]);
  assert.strictEqual(first, second);
  assert.deepEqual(harness.calls(), { initializeCalls: 1, fundCalls: 1 });
});

test('rejects a changed replay for an already paid caseId', async () => {
  const harness = setup();
  await harness.adapter.pay(input);
  await assert.rejects(
    harness.adapter.pay({ ...input, confirmationCommitment: 'cd'.repeat(32) }),
    /Conflicting payment replay/
  );
  assert.deepEqual(harness.calls(), { initializeCalls: 1, fundCalls: 1 });
});

test('fails closed before initialization on wrong amount or non-Devnet RPC', async () => {
  const amountHarness = setup();
  await assert.rejects(
    amountHarness.adapter.pay({ ...input, settlementProofBaseUnits: 999_999 }),
    /exactly 1 USDC/
  );
  assert.deepEqual(amountHarness.calls(), { initializeCalls: 0, fundCalls: 0 });

  const clusterHarness = setup({ genesisHash: 'mainnet-genesis' });
  await assert.rejects(clusterHarness.adapter.pay(input), /not Solana Devnet/);
  assert.deepEqual(clusterHarness.calls(), { initializeCalls: 0, fundCalls: 0 });
});

test('fails closed when x402 evidence does not prove the exact vault delta', async () => {
  const harness = setup({ vaultDelta: 0 });
  await assert.rejects(harness.adapter.pay(input), /evidence failed validation/);
  assert.deepEqual(harness.calls(), { initializeCalls: 1, fundCalls: 1 });
});

function institutionSecretMarker(): string {
  return 'secretKey';
}

test('rejects an unsupported program ID at construction', () => {
  assert.throws(() => new SolanaDevnetEscrowPaymentAdapter({
    rpcUrl: 'https://api.devnet.solana.com',
    institutionSigner: Keypair.generate(),
    merchant: Keypair.generate().publicKey,
    deliveryAuthority: Keypair.generate().publicKey,
    programId: new PublicKey('11111111111111111111111111111111'),
    traceDirectory: '/tmp/benefit-settlement-test-traces'
  }), /Unsupported escrow program ID/);
});
