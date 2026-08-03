import type { Gateway, PaidJournal, PaymentIntent, RawRequest, Receipt } from './types.ts';
import { FIXED_AMOUNT, FIXED_MINT, FIXED_SKU } from './types.ts';
import { generateFingerprint, generateIntentIds, hashString } from './fingerprint.ts';
import { TraceRepo } from './traceRepo.ts';

export interface CoreResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer | string;
}

export class ServerCore {
  private readonly merchant: string;
  private readonly gateway: Gateway;
  private readonly repo: TraceRepo;
  private readonly fulfill: (receipt: Receipt, fulfillmentKey: string) => Promise<void>;

  constructor(merchant: string, gateway: Gateway, repo: TraceRepo, fulfill: (receipt: Receipt, fulfillmentKey: string) => Promise<void>) {
    this.merchant = merchant;
    this.gateway = gateway;
    this.repo = repo;
    this.fulfill = fulfill;
  }

  async handle(req: RawRequest): Promise<CoreResponse> {
    if (req.method !== 'POST') return response(405, 'Method Not Allowed');
    if (req.pathname !== '/orders') return response(404, 'Not Found');
    if (!/^[a-f0-9]{32,64}$/.test(req.idempotencyKey)) return response(400, 'Invalid idempotency key');

    let body: unknown;
    try { body = JSON.parse(req.bodyBytes.toString('utf8')); } catch { return response(400, 'Invalid JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return response(400, 'Invalid body');
    const record = body as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.join(',') !== 'orderId,sku') return response(400, 'Body must contain exactly orderId and sku');
    if (typeof record.orderId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(record.orderId)) return response(400, 'Invalid orderId');
    if (record.sku !== FIXED_SKU) return response(403, 'SKU is not approved');

    const fingerprint = generateFingerprint(req.method, req.pathname, req.bodyBytes, req.idempotencyKey);
    const ids = generateIntentIds(record.orderId, fingerprint);
    const unlock = await this.repo.lock();
    try {
      let intent = this.repo.getIntent(req.idempotencyKey);
      if (intent && intent.fingerprint !== fingerprint) return response(409, 'Idempotency conflict');
      if (!intent) {
        intent = { ...ids, state: 'CREATED', orderId: record.orderId, fingerprint };
        this.repo.saveIntent(req.idempotencyKey, intent);
      }
      const recovered = this.repo.getJournal(intent.eventId);
      if (recovered) return await this.resumePaid(req.idempotencyKey, intent, recovered);
      if (intent.state === 'PAID') throw new Error('PAID intent has no canonical paid journal');

      const result = await this.gateway.process(req, Object.freeze({ ...intent }));
      if (result.kind === 'challenge') {
        intent.state = '402_ISSUED';
        intent.paymentRequiredHeaderHash = hashString(result.exactPaymentRequiredHeader);
        this.repo.saveIntent(req.idempotencyKey, intent);
        return { status: 402, headers: { 'content-type': 'application/json', 'payment-required': result.exactPaymentRequiredHeader }, body: result.response };
      }
      if (result.kind === 'rejected') {
        intent.state = 'REJECTED';
        this.repo.saveIntent(req.idempotencyKey, intent);
        return response(402, result.reason);
      }

      const paymentResponseHash = hashString(result.paymentResponseHeader);
      const receipt: Receipt = {
        eventId: intent.eventId,
        orderId: intent.orderId,
        paymentIntentId: intent.paymentIntentId,
        fingerprint: intent.fingerprint,
        mint: FIXED_MINT,
        baseUnits: FIXED_AMOUNT,
        merchant: this.merchant,
        transaction: result.settlementTransaction,
        paymentResponseHash
      };
      const paidBody = Buffer.from(JSON.stringify(receipt), 'utf8');
      const journal: PaidJournal = {
        eventId: intent.eventId,
        receipt,
        paymentResponseHeader: result.paymentResponseHeader,
        paidBodyHex: paidBody.toString('hex'),
        settlementTransaction: result.settlementTransaction,
        fulfillmentKey: `ful_${hashString(`${intent.eventId}:${result.settlementTransaction}`)}`,
        outboxState: 'PENDING'
      };
      this.repo.saveJournal(journal);
      this.repo.saveReceipt(receipt);
      intent.state = 'PAID';
      intent.paymentResponseHeader = result.paymentResponseHeader;
      intent.paymentResponseHash = paymentResponseHash;
      intent.settlementTransaction = result.settlementTransaction;
      intent.paidBodyHex = paidBody.toString('hex');
      this.repo.saveIntent(req.idempotencyKey, intent);
      return await this.resumePaid(req.idempotencyKey, intent, journal);
    } finally {
      unlock();
    }
  }

  private async resumePaid(idempotencyKey: string, intent: PaymentIntent, journal: PaidJournal): Promise<CoreResponse> {
    assertJournalMatches(intent, journal, this.merchant);
    this.repo.saveReceipt(journal.receipt);
    if (intent.state !== 'PAID'
      || intent.paymentResponseHeader !== journal.paymentResponseHeader
      || intent.settlementTransaction !== journal.settlementTransaction
      || intent.paidBodyHex !== journal.paidBodyHex) {
      intent.state = 'PAID';
      intent.paymentResponseHeader = journal.paymentResponseHeader;
      intent.paymentResponseHash = journal.receipt.paymentResponseHash;
      intent.settlementTransaction = journal.settlementTransaction;
      intent.paidBodyHex = journal.paidBodyHex;
      this.repo.saveIntent(idempotencyKey, intent);
    }
    if (journal.outboxState === 'PENDING') {
      try {
        await this.fulfill(Object.freeze({ ...journal.receipt }), journal.fulfillmentKey);
        this.repo.markJournalDone(journal.eventId);
      } catch {
        return response(503, 'Order fulfillment is pending', { 'retry-after': '1' });
      }
    }
    return cachedPaid(journal.paymentResponseHeader, journal.paidBodyHex);
  }
}

function response(status: number, body: string, headers: Record<string, string> = {}): CoreResponse {
  return { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers }, body };
}

function cachedPaid(header: string, bodyHex: string): CoreResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json', 'payment-response': header, 'x-payment-response': header },
    body: Buffer.from(bodyHex, 'hex')
  };
}

function assertJournalMatches(intent: PaymentIntent, journal: PaidJournal, merchant: string): void {
  const receipt = journal.receipt;
  if (journal.eventId !== intent.eventId
    || receipt.eventId !== intent.eventId
    || receipt.orderId !== intent.orderId
    || receipt.paymentIntentId !== intent.paymentIntentId
    || receipt.fingerprint !== intent.fingerprint
    || receipt.merchant !== merchant
    || receipt.mint !== FIXED_MINT
    || receipt.baseUnits !== FIXED_AMOUNT) {
    throw new Error('Paid journal does not match immutable order intent');
  }
}
