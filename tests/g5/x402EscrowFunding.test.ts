import { test } from 'node:test';
import assert from 'node:assert';
import { PublicKey } from '@solana/web3.js';
import { getOrderEscrowPDA, getVaultATA } from '../../src/g5/escrowClient.ts';
import { validateEscrowFundingRequest } from '../../src/g5/x402EscrowFunding.ts';

test('x402 escrow funding rejects a vault not derived from the order PDA', () => {
  const [orderPda] = getOrderEscrowPDA(new Uint8Array(32).fill(7));
  const wrongVault = getVaultATA(getOrderEscrowPDA(new Uint8Array(32).fill(8))[0]);

  assert.throws(
    () => validateEscrowFundingRequest(orderPda, wrongVault, 1_000_000n),
    /Escrow vault does not match order PDA/
  );
  assert.ok(wrongVault instanceof PublicKey);
});
