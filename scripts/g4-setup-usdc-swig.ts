import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
const require = createRequire(import.meta.url);
const {
  Actions,
  createEd25519AuthorityInfo,
  fetchSwig,
  findSwigPda,
  getAddAuthorityInstructions,
  getCreateSwigInstruction,
  getSwigWalletAddress
} = require('@swig-wallet/classic') as typeof import('@swig-wallet/classic');
import {
  ACTION_HEADER_LENGTH,
  Permission,
  getActionHeaderDecoder,
  getTokenDestinationLimitDecoder
} from '@swig-wallet/coder';
import { FIXED_AMOUNT, FIXED_MINT } from '../src/g4/types.ts';

const payerPath = process.env.DEVNET_PAYER_KEY_PATH;
const authorityPath = process.env.SWIG_AUTHORITY_KEY_PATH;
const merchantText = process.env.MERCHANT_ADDRESS;
const evidencePath = process.env.G4_SWIG_SETUP_EVIDENCE_PATH;
const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
if (!payerPath || !authorityPath || !merchantText || !evidencePath) throw new Error('Missing required G4 Swig setup environment');

const payerBytes = JSON.parse(await readFile(payerPath, 'utf8')) as number[];
const authorityBytes = JSON.parse(await readFile(authorityPath, 'utf8')) as number[];
const payer = Keypair.fromSecretKey(Uint8Array.from(payerBytes));
const authority = Keypair.fromSecretKey(Uint8Array.from(authorityBytes));
payerBytes.fill(0); authorityBytes.fill(0);
const merchant = new PublicKey(merchantText);
const mint = new PublicKey(FIXED_MINT);
const connection = new Connection(rpcUrl, 'confirmed');

const payerAta = getAssociatedTokenAddressSync(mint, payer.publicKey);
const payerAtaInfo = await connection.getAccountInfo(payerAta, 'confirmed');
if (!payerAtaInfo) {
  throw new Error(`Circle Devnet USDC is required before setup; payer ATA ${payerAta.toBase58()} does not exist`);
}
const payerToken = await getAccount(connection, payerAta);
if (payerToken.amount < BigInt(FIXED_AMOUNT)) {
  throw new Error(`Circle Devnet USDC balance ${payerToken.amount} is below required ${FIXED_AMOUNT}`);
}

const swigId = randomBytes(32);
const swigAddress = findSwigPda(swigId);
const createInstruction = await getCreateSwigInstruction({
  payer: payer.publicKey,
  actions: Actions.set().all().get(),
  authorityInfo: createEd25519AuthorityInfo(payer.publicKey),
  id: swigId
});
const createSignature = await sendAndConfirmTransaction(connection, new Transaction().add(createInstruction), [payer], { commitment: 'confirmed' });
let swig = await fetchSwig(connection, swigAddress);
const swigWallet = await getSwigWalletAddress(swig);
const rootRole = swig.findRolesByEd25519SignerPk(payer.publicKey)[0];
if (!rootRole?.actions.isRoot()) throw new Error('Swig root role missing');

const swigAta = await getOrCreateAssociatedTokenAccount(connection, payer, mint, swigWallet, true);
const merchantAta = await getOrCreateAssociatedTokenAccount(connection, payer, mint, merchant);
const fundSignature = await sendAndConfirmTransaction(connection, new Transaction().add(
  createTransferCheckedInstruction(payerAta, mint, swigAta.address, payer.publicKey, FIXED_AMOUNT, 6, [], TOKEN_PROGRAM_ID)
), [payer], { commitment: 'confirmed' });

swig = await fetchSwig(connection, swigAddress);
const addAuthority = await getAddAuthorityInstructions(
  swig,
  rootRole.id,
  createEd25519AuthorityInfo(authority.publicKey),
  Actions.set().tokenDestinationLimit({ mint, amount: BigInt(FIXED_AMOUNT), destination: merchantAta.address }).get(),
  { payer: payer.publicKey }
);
const authoritySignature = await sendAndConfirmTransaction(connection, new Transaction().add(...addAuthority), [payer], { commitment: 'confirmed' });
swig = await fetchSwig(connection, swigAddress);
const limitedRole = swig.findRolesByEd25519SignerPk(authority.publicKey).find((role) => !role.actions.isRoot());
if (!limitedRole || !limitedRole.actions.canSpendToken(mint, BigInt(FIXED_AMOUNT))) throw new Error('Limited USDC role was not created');
const persistedDestinationLimit = decodeTokenDestinationLimit(limitedRole.actions.bytes(), limitedRole.actions.count);
if (!persistedDestinationLimit) throw new Error('Persisted role is not TokenDestinationLimit');
if (new PublicKey(persistedDestinationLimit.mint).toBase58() !== mint.toBase58()) throw new Error('Persisted role mint drift');
if (new PublicKey(persistedDestinationLimit.destination).toBase58() !== merchantAta.address.toBase58()) throw new Error('Persisted role destination drift');
if (persistedDestinationLimit.amount !== BigInt(FIXED_AMOUNT)) throw new Error('Persisted role amount drift');

const evidence = {
  schema: 'g4-usdc-swig-setup-v1', cluster: 'devnet', checked_at: new Date().toISOString(),
  payer: payer.publicKey.toBase58(), merchant: merchant.toBase58(), merchant_token_account: merchantAta.address.toBase58(),
  swig_account: swigAddress.toBase58(), swig_wallet: swigWallet.toBase58(), swig_usdc_account: swigAta.address.toBase58(),
  limited_authority: authority.publicKey.toBase58(), limited_role_id: limitedRole.id,
  mint: FIXED_MINT, amount_base_units: String(FIXED_AMOUNT), permission: 'TokenDestinationLimit',
  destination_verified_from_persisted_role: merchantAta.address.toBase58(),
  signatures: { create_swig: createSignature, fund_swig_usdc: fundSignature, add_limited_authority: authoritySignature },
  secrets_persisted_in_evidence: false
};
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
process.stdout.write(`${JSON.stringify({ evidencePath, swigAccount: swigAddress.toBase58(), merchant: merchant.toBase58() })}\n`);

function decodeTokenDestinationLimit(raw: Uint8Array, count: number) {
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const header = getActionHeaderDecoder().decode(raw.slice(cursor, cursor + ACTION_HEADER_LENGTH));
    cursor += ACTION_HEADER_LENGTH;
    const payload = raw.slice(cursor, header.boundary);
    cursor = header.boundary;
    if (header.permission === Permission.TokenDestinationLimit) return getTokenDestinationLimitDecoder().decode(payload);
  }
  return undefined;
}
