import { createHash } from 'node:crypto';
import { configure, createPayKit, usd } from '@solana/pay-kit';
import type { KeyPairSigner } from '@solana/kit';
import type { Gateway, GatewayResult, PaymentIntent, RawRequest } from './types.ts';
import { createMemoBoundX402Adapter, INTERNAL_PAYMENT_INTENT_HEADER } from './payKitAdapter.ts';

type PayKitInstance = Awaited<ReturnType<typeof createPayKit>>;

export class PayKitGateway implements Gateway {
  private readonly pay: PayKitInstance;

  private constructor(pay: PayKitInstance) {
    this.pay = pay;
  }

  static async create(operatorSigner: KeyPairSigner, merchant: string, rpcUrl: string): Promise<PayKitGateway> {
    const config = await configure({
      accept: ['x402'],
      network: 'devnet',
      operator: { feePayer: true, recipient: merchant, signer: operatorSigner },
      rpcUrl,
      stablecoins: ['USDC']
    });
    const adapter = createMemoBoundX402Adapter(config);
    const pay = await createPayKit({
      adapters: [adapter],
      config,
      pricing: { mealOrder: { amount: usd('1.00'), accept: ['x402'] } }
    });
    return new PayKitGateway(pay);
  }

  async process(req: RawRequest, intent: Readonly<PaymentIntent>): Promise<GatewayResult> {
    const headers = new Headers({
      'content-type': 'application/json',
      'idempotency-key': req.idempotencyKey,
      [INTERNAL_PAYMENT_INTENT_HEADER]: intent.paymentIntentId
    });
    if (req.paymentHeader) {
      headers.set('payment-signature', req.paymentHeader);
      headers.set('x-payment', req.paymentHeader);
    }
    const request = new Request(`http://merchant.local${req.pathname}`, {
      method: req.method,
      headers,
      body: req.bodyBytes.toString('utf8')
    });
    const result = await this.pay.requirePayment(request, 'mealOrder');
    if ('respond' in result) return { kind: 'rejected', reason: 'Unexpected interactive response' };
    if (result.status === 402) {
      const header = result.response.headers.get('payment-required');
      if (!header) throw new Error('PayKit emitted no PAYMENT-REQUIRED header');
      return { kind: 'challenge', response: Buffer.from(await result.response.text()), exactPaymentRequiredHeader: header };
    }
    if (result.payment.protocol !== 'x402' || result.payment.scheme !== 'exact' || !result.payment.transaction) {
      throw new Error('Unexpected settled payment');
    }
    const paymentResponseHeader = result.payment.settlementHeaders['payment-response'];
    if (!paymentResponseHeader) throw new Error('Missing standard PAYMENT-RESPONSE');
    return {
      kind: 'paid',
      settlementTransaction: result.payment.transaction,
      paymentResponseHeader,
      paymentCredentialHash: createHash('sha256').update(result.payment.raw ?? '').digest('hex')
    };
  }
}
