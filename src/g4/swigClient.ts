import {
  getSetComputeUnitLimitInstruction,
  setTransactionMessageComputeUnitPrice
} from '@solana-program/compute-budget';
import { fetchMint, findAssociatedTokenPda, getTransferCheckedInstruction } from '@solana-program/token-2022';
import {
  addSignersToTransactionMessage,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  prependTransactionMessageInstruction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash
} from '@solana/kit';
import type { Address, Instruction, KeyPairSigner } from '@solana/kit';
import { fetchSwig, getSignInstructions, getSwigWalletAddress } from '@swig-wallet/kit';
import type { PaymentPayload, PaymentRequirements, SchemeNetworkClient } from '@x402/core/types';
import { DEVNET_NETWORK } from './payKitAdapter.ts';
import { FIXED_AMOUNT, FIXED_MINT } from './types.ts';

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' as Address;

export interface ExpectedPaymentTerms {
  merchant: Address;
  feePayer: Address;
  paymentIntentId: string;
}

export class ExactSwigSvmScheme implements SchemeNetworkClient {
  readonly scheme = 'exact';
  private readonly authority: KeyPairSigner;
  private readonly swigAccount: Address;
  private readonly expected: ExpectedPaymentTerms;
  private readonly rpcUrl: string;

  constructor(authority: KeyPairSigner, swigAccount: Address, expected: ExpectedPaymentTerms, rpcUrl: string) {
    this.authority = authority;
    this.swigAccount = swigAccount;
    this.expected = Object.freeze({ ...expected });
    this.rpcUrl = rpcUrl;
  }

  async createPaymentPayload(x402Version: number, requirements: PaymentRequirements): Promise<Pick<PaymentPayload, 'x402Version' | 'payload'>> {
    this.assertRequirements(x402Version, requirements);
    const rpc = createSolanaRpc(this.rpcUrl);
    const mint = FIXED_MINT as Address;
    const swig = await fetchSwig(rpc as never, this.swigAccount);
    const swigWallet = await getSwigWalletAddress(swig);
    const roles = swig.findRolesByEd25519SignerPk(this.authority.address);
    const role = roles.find((candidate) => !candidate.actions.isRoot());
    if (!role) throw new Error('A non-root Swig authority is required');
    if (!role.actions.canSpendToken(mint, BigInt(FIXED_AMOUNT))) throw new Error('Swig role cannot spend exact USDC amount');

    const mintInfo = await fetchMint(rpc, mint);
    const tokenProgram = mintInfo.programAddress;
    const [sourceAta] = await findAssociatedTokenPda({ mint, owner: swigWallet, tokenProgram });
    const [destinationAta] = await findAssociatedTokenPda({ mint, owner: this.expected.merchant, tokenProgram });
    const balance = await rpc.getTokenAccountBalance(sourceAta).send();
    if (BigInt(balance.value.amount) < BigInt(FIXED_AMOUNT)) throw new Error('Swig Devnet USDC balance is below 1 USDC');

    const transfer = getTransferCheckedInstruction({
      source: sourceAta,
      mint,
      destination: destinationAta,
      authority: swigWallet,
      amount: BigInt(FIXED_AMOUNT),
      decimals: mintInfo.data.decimals
    }, { programAddress: tokenProgram });
    const signInstructions = await getSignInstructions(swig, role.id, [transfer as never]) as Instruction[];
    const memo: Instruction = {
      programAddress: MEMO_PROGRAM,
      accounts: [],
      data: new TextEncoder().encode(this.expected.paymentIntentId)
    };
    const recent = requirements.extra?.recentBlockhash;
    const height = requirements.extra?.lastValidBlockHeight;
    const lifetime = typeof recent === 'string' && typeof height === 'string'
      ? { blockhash: recent as never, lastValidBlockHeight: BigInt(height) }
      : (await rpc.getLatestBlockhash().send()).value;

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (value) => setTransactionMessageComputeUnitPrice(10_000n, value),
      (value) => setTransactionMessageFeePayer(this.expected.feePayer, value),
      (value) => prependTransactionMessageInstruction(getSetComputeUnitLimitInstruction({ units: 200_000 }), value),
      (value) => appendTransactionMessageInstructions([...signInstructions, memo], value),
      (value) => setTransactionMessageLifetimeUsingBlockhash(lifetime, value),
      (value) => addSignersToTransactionMessage([this.authority], value)
    );
    const signed = await partiallySignTransactionMessageWithSigners(message);
    return { x402Version, payload: { transaction: getBase64EncodedWireTransaction(signed) } };
  }

  private assertRequirements(x402Version: number, requirements: PaymentRequirements): void {
    if (x402Version !== 2) throw new Error('Only x402 v2 is allowed');
    if (requirements.scheme !== 'exact' || requirements.network !== DEVNET_NETWORK) throw new Error('Wrong x402 scheme or network');
    if (requirements.asset !== FIXED_MINT || requirements.amount !== String(FIXED_AMOUNT)) throw new Error('Wrong asset or amount');
    if (requirements.payTo !== this.expected.merchant) throw new Error('Wrong merchant');
    if (requirements.extra?.feePayer !== this.expected.feePayer) throw new Error('Wrong fee payer');
    if (requirements.extra?.memo !== this.expected.paymentIntentId) throw new Error('Wrong payment intent memo');
  }
}
