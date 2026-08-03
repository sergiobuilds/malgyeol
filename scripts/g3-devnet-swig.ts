import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  type TransactionInstruction
} from '@solana/web3.js';
const require = createRequire(import.meta.url);
const {
  Actions,
  createEd25519AuthorityInfo,
  fetchSwig,
  findSwigPda,
  getAddAuthorityInstructions,
  getCreateSwigInstruction,
  getSignInstructions,
  getSwigWalletAddress,
  SWIG_PROGRAM_ADDRESS
} = require('@swig-wallet/classic') as typeof import('@swig-wallet/classic');

const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const keyPath = process.env.DEVNET_PAYER_KEYPAIR;
const evidencePath = process.env.G3_EVIDENCE_PATH;
if (!keyPath) throw new Error('DEVNET_PAYER_KEYPAIR is required');
if (!evidencePath) throw new Error('G3_EVIDENCE_PATH is required');

const connection = new Connection(rpcUrl, 'confirmed');
const secret = JSON.parse(await readFile(keyPath, 'utf8')) as number[];
const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
secret.fill(0);
const spender = Keypair.generate();
const escrowOwner = Keypair.generate();
const attacker = Keypair.generate();
const mint = Keypair.generate();
const decimals = 6;
const exactAmount = 1_000_000n;

async function submit(instructions: TransactionInstruction[], feePayer: Keypair, signers: Keypair[] = []): Promise<string> {
  return sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [feePayer, ...signers], {
    commitment: 'confirmed'
  });
}

const swigId = randomBytes(32);
const swigAddress = findSwigPda(swigId);
const createSwig = await getCreateSwigInstruction({
  payer: payer.publicKey,
  actions: Actions.set().all().get(),
  authorityInfo: createEd25519AuthorityInfo(payer.publicKey),
  id: swigId
});
const createSwigSignature = await submit([createSwig], payer);

let swig = await fetchSwig(connection, swigAddress);
const swigWallet = await getSwigWalletAddress(swig);
const rootRole = swig.findRolesByEd25519SignerPk(payer.publicKey)[0];
if (!rootRole) throw new Error('Root role not found after Swig creation');

const mintRent = await connection.getMinimumBalanceForRentExemption(getMintLen([]));
const createMintSignature = await submit([
  SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mint.publicKey,
    lamports: mintRent,
    space: getMintLen([]),
    programId: TOKEN_PROGRAM_ID
  }),
  createInitializeMintInstruction(mint.publicKey, decimals, payer.publicKey, null)
], payer, [mint]);

const swigAta = getAssociatedTokenAddressSync(mint.publicKey, swigWallet, true);
const escrowAta = getAssociatedTokenAddressSync(mint.publicKey, escrowOwner.publicKey);
const attackerAta = getAssociatedTokenAddressSync(mint.publicKey, attacker.publicKey);
const setupTokenSignature = await submit([
  createAssociatedTokenAccountInstruction(payer.publicKey, swigAta, swigWallet, mint.publicKey),
  createAssociatedTokenAccountInstruction(payer.publicKey, escrowAta, escrowOwner.publicKey, mint.publicKey),
  createAssociatedTokenAccountInstruction(payer.publicKey, attackerAta, attacker.publicKey, mint.publicKey),
  createMintToInstruction(mint.publicKey, swigAta, payer.publicKey, exactAmount * 2n)
], payer);

swig = await fetchSwig(connection, swigAddress);
const addAuthority = await getAddAuthorityInstructions(
  swig,
  rootRole.id,
  createEd25519AuthorityInfo(spender.publicKey),
  Actions.set().tokenDestinationLimit({
    mint: mint.publicKey,
    amount: exactAmount,
    destination: escrowAta
  }).get(),
  { payer: payer.publicKey }
);
const addAuthoritySignature = await submit(addAuthority, payer);

swig = await fetchSwig(connection, swigAddress);
const spenderRole = swig.findRolesByEd25519SignerPk(spender.publicKey)[0];
if (!spenderRole) throw new Error('Limited spender role not found');

const fundSpenderSignature = await submit([
  SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: spender.publicKey, lamports: 10_000_000 })
], payer);

const allowedTransfer = createTransferInstruction(swigAta, escrowAta, swigWallet, exactAmount);
const allowedSignInstructions = await getSignInstructions(swig, spenderRole.id, [allowedTransfer]);
const allowedSignature = await submit(allowedSignInstructions, spender);
const allowedTransaction = await connection.getTransaction(allowedSignature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
if (allowedTransaction?.meta?.err) throw new Error(`Allowed transfer failed: ${JSON.stringify(allowedTransaction.meta.err)}`);

swig = await fetchSwig(connection, swigAddress);
const wrongDestinationTransfer = createTransferInstruction(swigAta, attackerAta, swigWallet, exactAmount);
const blockedInstructions = await getSignInstructions(swig, spenderRole.id, [wrongDestinationTransfer]);
const blockedTransaction = new Transaction().add(...blockedInstructions);
blockedTransaction.feePayer = spender.publicKey;
blockedTransaction.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
blockedTransaction.sign(spender);
const blockedSignature = await connection.sendRawTransaction(blockedTransaction.serialize(), { skipPreflight: true });
const blockedConfirmation = await connection.confirmTransaction(blockedSignature, 'confirmed');
if (!blockedConfirmation.value.err) throw new Error('Wrong-destination transaction unexpectedly succeeded');

const [swigBalance, escrowBalance, attackerBalance] = await Promise.all([
  connection.getTokenAccountBalance(swigAta),
  connection.getTokenAccountBalance(escrowAta),
  connection.getTokenAccountBalance(attackerAta)
]);
if (escrowBalance.value.amount !== exactAmount.toString()) throw new Error('Escrow balance delta is not exact');
if (attackerBalance.value.amount !== '0') throw new Error('Blocked destination received tokens');

const evidence = {
  schema: 'g3-devnet-swig-proof-v1',
  cluster: 'devnet',
  rpc_url: rpcUrl,
  checked_at: new Date().toISOString(),
  claim_boundary: 'The mint is a product-created Devnet demo token with 6 decimals, not Circle USDC. This proof establishes real Devnet Swig authority enforcement only; x402 and pay.sh are not claimed.',
  fixed_versions: {
    swig_classic: '2.1.0',
    swig_program: String(SWIG_PROGRAM_ADDRESS),
    swig_ts_commit: '6fc9e22ec8a4b3711278e7b464c514d463c16edf'
  },
  public_accounts: {
    payer: payer.publicKey.toBase58(),
    swig_account: swigAddress.toBase58(),
    swig_wallet: swigWallet.toBase58(),
    demo_token_mint: mint.publicKey.toBase58(),
    authorized_escrow_token_account: escrowAta.toBase58(),
    blocked_destination_token_account: attackerAta.toBase58(),
    limited_spender: spender.publicKey.toBase58()
  },
  authority: {
    action: 'tokenDestinationLimit',
    mint: mint.publicKey.toBase58(),
    destination: escrowAta.toBase58(),
    cumulative_amount_base_units: exactAmount.toString()
  },
  signatures: {
    create_swig: createSwigSignature,
    create_mint: createMintSignature,
    setup_token_accounts: setupTokenSignature,
    add_limited_authority: addAuthoritySignature,
    fund_spender_fee_payer: fundSpenderSignature,
    allowed_exact_transfer: allowedSignature,
    blocked_wrong_destination: blockedSignature
  },
  readback: {
    allowed_transaction_error: allowedTransaction?.meta?.err ?? null,
    blocked_transaction_error: blockedConfirmation.value.err,
    swig_balance_base_units: swigBalance.value.amount,
    authorized_escrow_balance_base_units: escrowBalance.value.amount,
    blocked_destination_balance_base_units: attackerBalance.value.amount
  }
};
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
process.stdout.write(`${JSON.stringify({ evidencePath, swig: swigAddress.toBase58(), allowedSignature, blockedSignature })}\n`);
