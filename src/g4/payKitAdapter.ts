import { createSolanaRpc } from '@solana/kit';
import { x402Facilitator } from '@x402/core/facilitator';
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader
} from '@x402/core/http';
import type { Network, PaymentPayload, PaymentRequired, PaymentRequirements } from '@x402/core/types';
import { toFacilitatorSvmSigner } from '@x402/svm';
import { ExactSvmScheme as ExactSvmFacilitator } from '@x402/svm/exact/facilitator';
import { InvalidProofError } from '@solana/pay-kit';
import type { PayKitConfig, ProtocolAdapter } from '@solana/pay-kit';
import type { Gate } from '@solana/pay-kit';
import { FIXED_AMOUNT, FIXED_MINT } from './types.ts';

export const SWIG_PROGRAM = 'swigypWHEksbC64pWKwah1WTeh9JXwx8H1rJHLdbQMB';
export const DEVNET_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as Network;
export const INTERNAL_PAYMENT_INTENT_HEADER = 'x-bsr-payment-intent';
const MAX_TIMEOUT_SECONDS = 300;

export function createMemoBoundX402Adapter(config: PayKitConfig): ProtocolAdapter {
  if (config.network !== 'solana_devnet') throw new Error('G4 adapter is Devnet-only');
  const facilitator = new x402Facilitator().register(
    DEVNET_NETWORK,
    new ExactSvmFacilitator(
      toFacilitatorSvmSigner(config.operator.signer.signer, { defaultRpcUrl: config.rpcUrl }),
      undefined,
      {
        enableSmartWalletVerification: true,
        smartWalletAllowedPrograms: [SWIG_PROGRAM],
        smartWalletMaxComputeUnits: 200_000,
        smartWalletMaxPriorityFeeMicroLamports: 10_000
      }
    )
  );
  const challengeByRequest = new WeakMap<Request, Promise<PaymentRequirements>>();

  function intentFrom(request: Request): string {
    const intent = request.headers.get(INTERNAL_PAYMENT_INTENT_HEADER);
    if (!intent || !/^pi_[a-f0-9]{32}$/.test(intent)) throw new Error('Missing trusted payment intent');
    return intent;
  }

  function requirementsFor(gate: Gate, request: Request): PaymentRequirements {
    const baseUnits = gate.total().baseUnits();
    if (baseUnits !== BigInt(FIXED_AMOUNT)) throw new Error('Gate amount drift');
    if (gate.payTo !== config.operator.recipient) throw new Error('Gate recipient drift');
    return {
      amount: String(FIXED_AMOUNT),
      asset: FIXED_MINT,
      extra: {
        feePayer: config.operator.signer.pubkey,
        memo: intentFrom(request)
      },
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
      network: DEVNET_NETWORK,
      payTo: config.operator.recipient,
      scheme: 'exact'
    };
  }

  async function challengeRequirements(gate: Gate, request: Request): Promise<PaymentRequirements> {
    const existing = challengeByRequest.get(request);
    if (existing) return existing;
    const pending = (async () => {
      const base = requirementsFor(gate, request);
      const { value } = await createSolanaRpc(config.rpcUrl).getLatestBlockhash().send();
      return {
        ...base,
        extra: {
          ...base.extra,
          lastValidBlockHeight: value.lastValidBlockHeight.toString(),
          recentBlockhash: value.blockhash
        }
      };
    })();
    challengeByRequest.set(request, pending);
    return pending;
  }

  return {
    protocol: 'x402',
    scheme: 'exact',
    async acceptsEntry(gate, request) {
      return { ...(await challengeRequirements(gate, request)), protocol: 'x402' };
    },
    async challengeHeaders(gate, request) {
      const paymentRequired: PaymentRequired = {
        accepts: [await challengeRequirements(gate, request)],
        resource: { url: new URL(request.url).pathname },
        x402Version: 2
      };
      return { 'payment-required': encodePaymentRequiredHeader(paymentRequired) };
    },
    detect(request) {
      return request.headers.has('payment-signature') || request.headers.has('x-payment');
    },
    async verifyAndSettle(gate, request) {
      const raw = request.headers.get('payment-signature') ?? request.headers.get('x-payment');
      if (!raw) throw new InvalidProofError('missing_x402_payment_header');
      let payload: PaymentPayload;
      try { payload = decodePaymentSignatureHeader(raw); } catch (error) {
        throw new InvalidProofError('invalid_x402_payment_header', error instanceof Error ? error.message : String(error));
      }
      const requirements = requirementsFor(gate, request);
      const verification = await facilitator.verify(payload, requirements);
      if (!verification.isValid) throw new InvalidProofError(verification.invalidReason ?? 'invalid_proof', verification.invalidMessage);
      const settlement = await facilitator.settle(payload, requirements);
      if (!settlement.success) throw new InvalidProofError(settlement.errorReason ?? 'settlement_failed', settlement.errorMessage);
      const responseHeader = encodePaymentResponseHeader(settlement);
      return {
        gateName: gate.name,
        payer: settlement.payer ?? verification.payer,
        protocol: 'x402',
        raw,
        scheme: 'exact',
        settlementHeaders: {
          'payment-response': responseHeader,
          'x-payment-response': responseHeader
        },
        transaction: settlement.transaction
      };
    }
  };
}
