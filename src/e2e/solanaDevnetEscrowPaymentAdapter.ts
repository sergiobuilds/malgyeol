import { createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import type { ProofPaymentAdapter } from './caseCoordinator.ts';
import {
  PROGRAM_ID,
  USDC_MINT,
  createInitializeOrderInstruction,
  getOrderEscrowPDA,
  getVaultATA
} from '../g5/escrowClient.ts';
import { fundEscrowViaX402, type EscrowFundingEvidence } from '../g5/x402EscrowFunding.ts';

const FIXED_SETTLEMENT_BASE_UNITS = 1_000_000;
const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const DEFAULT_ESCROW_TTL_SECONDS = 10n * 60n;

type PaymentInput = Parameters<ProofPaymentAdapter['pay']>[0];

export type SolanaDevnetEscrowPaymentReceipt = Awaited<ReturnType<ProofPaymentAdapter['pay']>> & {
  orderCommitment: string;
  orderPda: string;
  vaultAta: string;
  escrowProgramId: string;
  mint: string;
  initializeTransaction: string;
  escrowExpiresAt: number;
  x402ChallengeSha256: string;
  paymentResponseSha256: string;
  x402Network: string;
  x402Asset: string;
  x402Amount: string;
  x402PayTo: string;
  swigAccount: string;
  limitedAuthority: string;
  rpcSlot: number;
};

export type SolanaDevnetEscrowPaymentConfig = {
  rpcUrl: string;
  institutionSigner: Keypair;
  merchant: PublicKey;
  deliveryAuthority: PublicKey;
  programId: PublicKey;
  traceDirectory: string;
  escrowTtlSeconds?: bigint;
  connection?: Connection;
};

type Runtime = {
  getGenesisHash(connection: Connection): Promise<string>;
  getChainTime(connection: Connection): Promise<bigint>;
  initialize(input: {
    connection: Connection;
    institution: Keypair;
    merchant: PublicKey;
    deliveryAuthority: PublicKey;
    commitment: Uint8Array;
    amount: bigint;
    expiresAt: bigint;
  }): Promise<string>;
  fund(input: {
    connection: Connection;
    institution: Keypair;
    orderPda: PublicKey;
    vaultAta: PublicKey;
    amount: bigint;
    rpcUrl: string;
    traceDirectory: string;
  }): Promise<EscrowFundingEvidence>;
};

const defaultRuntime: Runtime = {
  getGenesisHash: connection => connection.getGenesisHash(),
  async getChainTime(connection) {
    const slot = await connection.getSlot('confirmed');
    const blockTime = await connection.getBlockTime(slot);
    if (blockTime === null) throw new Error('Devnet block time unavailable');
    return BigInt(blockTime);
  },
  async initialize(input) {
    const instruction = createInitializeOrderInstruction(
      input.institution.publicKey,
      input.merchant,
      input.deliveryAuthority,
      input.commitment,
      input.amount,
      input.expiresAt
    );
    return sendAndConfirmTransaction(
      input.connection,
      new Transaction().add(instruction),
      [input.institution],
      { commitment: 'confirmed' }
    );
  },
  fund: input => fundEscrowViaX402(
    input.connection,
    input.institution,
    input.orderPda,
    input.vaultAta,
    input.amount,
    input.rpcUrl,
    input.traceDirectory
  )
};

function encodeField(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

export function deriveOrderCommitment(caseId: string, confirmationCommitment: string): Buffer {
  if (!caseId.trim()) throw new Error('caseId is required');
  if (!/^[a-f0-9]{64}$/i.test(confirmationCommitment)) {
    throw new Error('confirmationCommitment must be a 32-byte hex digest');
  }
  return createHash('sha256')
    .update('benefit-settlement-order-v1\0')
    .update(encodeField(caseId))
    .update(encodeField(confirmationCommitment.toLowerCase()))
    .digest();
}

export class SolanaDevnetEscrowPaymentAdapter implements ProofPaymentAdapter {
  private readonly connection: Connection;
  private readonly completed = new Map<string, { inputDigest: string; receipt: SolanaDevnetEscrowPaymentReceipt }>();
  private readonly inFlight = new Map<string, { inputDigest: string; operation: Promise<SolanaDevnetEscrowPaymentReceipt> }>();

  constructor(
    private readonly config: SolanaDevnetEscrowPaymentConfig,
    private readonly runtime: Runtime = defaultRuntime
  ) {
    if (!config.rpcUrl.trim()) throw new Error('rpcUrl is required');
    if (!config.traceDirectory.trim()) throw new Error('traceDirectory is required');
    if (!config.programId.equals(PROGRAM_ID)) throw new Error('Unsupported escrow program ID');
    if (
      config.institutionSigner.publicKey.equals(PublicKey.default)
      || config.merchant.equals(PublicKey.default)
      || config.deliveryAuthority.equals(PublicKey.default)
    ) throw new Error('Escrow participant keys must be non-default');
    if (
      config.institutionSigner.publicKey.equals(config.merchant)
      || config.institutionSigner.publicKey.equals(config.deliveryAuthority)
      || config.merchant.equals(config.deliveryAuthority)
    ) throw new Error('Escrow participant keys must be distinct');
    const ttl = config.escrowTtlSeconds ?? DEFAULT_ESCROW_TTL_SECONDS;
    if (ttl <= 0n || ttl > 7n * 24n * 60n * 60n) throw new Error('Invalid escrow TTL');
    this.connection = config.connection ?? new Connection(config.rpcUrl, 'confirmed');
  }

  async pay(input: PaymentInput): Promise<SolanaDevnetEscrowPaymentReceipt> {
    const inputDigest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const existing = this.completed.get(input.caseId);
    if (existing) {
      if (existing.inputDigest !== inputDigest) throw new Error('Conflicting payment replay for caseId');
      return existing.receipt;
    }
    const pending = this.inFlight.get(input.caseId);
    if (pending) {
      if (pending.inputDigest !== inputDigest) throw new Error('Conflicting payment replay for caseId');
      return pending.operation;
    }

    const operation = this.execute(input);
    this.inFlight.set(input.caseId, { inputDigest, operation });
    try {
      const receipt = await operation;
      this.completed.set(input.caseId, { inputDigest, receipt });
      return receipt;
    } finally {
      this.inFlight.delete(input.caseId);
    }
  }

  private async execute(input: PaymentInput): Promise<SolanaDevnetEscrowPaymentReceipt> {
    if (input.settlementProofBaseUnits !== FIXED_SETTLEMENT_BASE_UNITS) {
      throw new Error('Settlement amount must be exactly 1 USDC');
    }
    if (!input.merchantId.trim() || !input.sku.trim()) throw new Error('Merchant and SKU are required');

    const genesisHash = await this.runtime.getGenesisHash(this.connection);
    if (genesisHash !== DEVNET_GENESIS_HASH) throw new Error('RPC is not Solana Devnet');

    const commitment = deriveOrderCommitment(input.caseId, input.confirmationCommitment);
    const [orderPda] = getOrderEscrowPDA(commitment);
    const vaultAta = getVaultATA(orderPda);
    const chainTime = await this.runtime.getChainTime(this.connection);
    const expiresAt = chainTime + (this.config.escrowTtlSeconds ?? DEFAULT_ESCROW_TTL_SECONDS);
    const amount = BigInt(FIXED_SETTLEMENT_BASE_UNITS);

    const initializeTransaction = await this.runtime.initialize({
      connection: this.connection,
      institution: this.config.institutionSigner,
      merchant: this.config.merchant,
      deliveryAuthority: this.config.deliveryAuthority,
      commitment,
      amount,
      expiresAt
    });
    if (!initializeTransaction) throw new Error('Escrow initialization was not confirmed');

    const funding = await this.runtime.fund({
      connection: this.connection,
      institution: this.config.institutionSigner,
      orderPda,
      vaultAta,
      amount,
      rpcUrl: this.config.rpcUrl,
      traceDirectory: this.config.traceDirectory
    });
    if (
      funding.challengeStatus !== 402
      || funding.paidStatus !== 200
      || !funding.paymentResponse
      || !funding.devnetSettlementSignature
      || funding.rpcSlot <= 0
      || funding.vaultDelta !== FIXED_SETTLEMENT_BASE_UNITS
      || funding.fulfillmentCount !== 1
    ) throw new Error('x402 Devnet settlement evidence failed validation');

    const orderCommitment = commitment.toString('hex');
    const paymentIntentId = `x402_devnet_${createHash('sha256')
      .update('benefit-payment-intent-v1\0')
      .update(commitment)
      .digest('hex')
      .slice(0, 24)}`;

    return Object.freeze({
      paymentIntentId,
      settlementTransaction: funding.devnetSettlementSignature,
      settlementProofBaseUnits: FIXED_SETTLEMENT_BASE_UNITS,
      orderCommitment,
      orderPda: orderPda.toBase58(),
      vaultAta: vaultAta.toBase58(),
      escrowProgramId: this.config.programId.toBase58(),
      mint: USDC_MINT.toBase58(),
      initializeTransaction,
      escrowExpiresAt: Number(expiresAt),
      x402ChallengeSha256: funding.challengeSha256,
      paymentResponseSha256: funding.paymentResponseSha256,
      x402Network: funding.network,
      x402Asset: funding.asset,
      x402Amount: funding.amount,
      x402PayTo: funding.payTo,
      swigAccount: funding.swigAccount,
      limitedAuthority: funding.authorityPubkey,
      rpcSlot: funding.rpcSlot
    });
  }
}
