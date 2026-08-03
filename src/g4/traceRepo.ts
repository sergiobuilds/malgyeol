import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PaidJournal, PaymentIntent, Receipt } from './types.ts';

export class Mutex {
  private readonly locks = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    while (this.locks.has(key)) await this.locks.get(key);
    let releasePromise = () => {};
    const promise = new Promise<void>((resolve) => { releasePromise = resolve; });
    this.locks.set(key, promise);
    return () => {
      if (this.locks.get(key) === promise) this.locks.delete(key);
      releasePromise();
    };
  }
}

export class TraceRepo {
  private readonly dataDir: string;
  private readonly mutex = new Mutex();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    mkdirSync(join(dataDir, 'intents'), { recursive: true, mode: 0o700 });
    mkdirSync(join(dataDir, 'receipts'), { recursive: true, mode: 0o700 });
    mkdirSync(join(dataDir, 'transactions'), { recursive: true, mode: 0o700 });
    mkdirSync(join(dataDir, 'journals'), { recursive: true, mode: 0o700 });
  }

  lock(): Promise<() => void> {
    return this.mutex.acquire('__global__');
  }

  private atomicWrite(filePath: string, data: unknown): void {
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, filePath);
  }

  saveIntent(idempotencyKey: string, intent: PaymentIntent): void {
    validateIntent(intent);
    this.atomicWrite(join(this.dataDir, 'intents', `${idempotencyKey}.json`), intent);
  }

  getIntent(idempotencyKey: string): PaymentIntent | undefined {
    const path = join(this.dataDir, 'intents', `${idempotencyKey}.json`);
    if (!existsSync(path)) return undefined;
    const value = JSON.parse(readFileSync(path, 'utf8'));
    validateIntent(value);
    return value;
  }

  saveReceipt(receipt: Receipt): void {
    validateReceipt(receipt);
    const transactionIndex = join(this.dataDir, 'transactions', `${receipt.transaction}.json`);
    if (existsSync(transactionIndex)) {
      const existing = JSON.parse(readFileSync(transactionIndex, 'utf8')) as { eventId?: unknown };
      if (existing.eventId !== receipt.eventId) throw new Error('Settlement transaction already belongs to another event');
    }
    this.atomicWrite(join(this.dataDir, 'receipts', `${receipt.eventId}.json`), receipt);
    this.atomicWrite(transactionIndex, { eventId: receipt.eventId, transaction: receipt.transaction });
  }

  getReceipt(eventId: string): Receipt | undefined {
    const path = join(this.dataDir, 'receipts', `${eventId}.json`);
    if (!existsSync(path)) return undefined;
    const value = JSON.parse(readFileSync(path, 'utf8'));
    validateReceipt(value);
    return value;
  }

  saveJournal(journal: PaidJournal): void {
    validatePaidJournal(journal);
    const path = join(this.dataDir, 'journals', `${journal.eventId}.json`);
    if (existsSync(path)) {
      const existing = JSON.parse(readFileSync(path, 'utf8'));
      validatePaidJournal(existing);
      assertSameJournalIdentity(existing, journal);
      if (existing.outboxState === 'DONE' && journal.outboxState !== 'DONE') throw new Error('Paid journal cannot return to PENDING');
    } else {
      for (const file of readdirSync(join(this.dataDir, 'journals'))) {
        if (/^evt_[a-f0-9]{32}\.json\.[a-f0-9-]{36}\.tmp$/.test(file)) continue;
        if (!/^evt_[a-f0-9]{32}\.json$/.test(file)) throw new Error('Unexpected paid journal filename');
        const existing = JSON.parse(readFileSync(join(this.dataDir, 'journals', file), 'utf8'));
        validatePaidJournal(existing);
        if (existing.settlementTransaction === journal.settlementTransaction) {
          throw new Error('Settlement transaction already belongs to another event');
        }
      }
    }
    this.atomicWrite(path, journal);
  }

  getJournal(eventId: string): PaidJournal | undefined {
    if (!/^evt_[a-f0-9]{32}$/.test(eventId)) throw new Error('Invalid journal eventId');
    const path = join(this.dataDir, 'journals', `${eventId}.json`);
    if (!existsSync(path)) return undefined;
    const value = JSON.parse(readFileSync(path, 'utf8'));
    validatePaidJournal(value);
    return value;
  }

  markJournalDone(eventId: string): PaidJournal {
    const journal = this.getJournal(eventId);
    if (!journal) throw new Error('Paid journal missing');
    if (journal.outboxState === 'DONE') return journal;
    const done = { ...journal, outboxState: 'DONE' as const };
    this.saveJournal(done);
    return done;
  }
}

function validateHex(value: unknown, field: string): void {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`Invalid ${field}`);
}

function validateIntent(value: unknown): asserts value is PaymentIntent {
  if (!value || typeof value !== 'object') throw new Error('Invalid intent');
  const data = value as Record<string, unknown>;
  if (typeof data.eventId !== 'string' || !/^evt_[a-f0-9]{32}$/.test(data.eventId)) throw new Error('Invalid eventId');
  if (typeof data.paymentIntentId !== 'string' || !/^pi_[a-f0-9]{32}$/.test(data.paymentIntentId)) throw new Error('Invalid paymentIntentId');
  if (!['CREATED', '402_ISSUED', 'PAID', 'REJECTED'].includes(String(data.state))) throw new Error('Invalid state');
  if (typeof data.orderId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(data.orderId)) throw new Error('Invalid orderId');
  validateHex(data.fingerprint, 'fingerprint');
  if (data.paymentRequiredHeaderHash !== undefined) validateHex(data.paymentRequiredHeaderHash, 'paymentRequiredHeaderHash');
  if (data.paymentResponseHash !== undefined) validateHex(data.paymentResponseHash, 'paymentResponseHash');
  if (data.state === 'PAID' && (typeof data.paymentResponseHeader !== 'string' || typeof data.settlementTransaction !== 'string' || typeof data.paidBodyHex !== 'string')) {
    throw new Error('Invalid paid intent');
  }
}

function validateReceipt(value: unknown): asserts value is Receipt {
  if (!value || typeof value !== 'object') throw new Error('Invalid receipt');
  const data = value as Record<string, unknown>;
  if (typeof data.eventId !== 'string' || !/^evt_[a-f0-9]{32}$/.test(data.eventId)) throw new Error('Invalid receipt eventId');
  if (typeof data.orderId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(data.orderId)) throw new Error('Invalid receipt orderId');
  if (typeof data.paymentIntentId !== 'string' || !/^pi_[a-f0-9]{32}$/.test(data.paymentIntentId)) throw new Error('Invalid receipt paymentIntentId');
  validateHex(data.fingerprint, 'receipt fingerprint');
  validateHex(data.paymentResponseHash, 'receipt paymentResponseHash');
  if (typeof data.mint !== 'string' || typeof data.baseUnits !== 'number' || !Number.isSafeInteger(data.baseUnits) || data.baseUnits <= 0) throw new Error('Invalid receipt asset');
  if (typeof data.merchant !== 'string' || data.merchant.length < 1 || data.merchant.length > 64) throw new Error('Invalid receipt merchant');
  if (typeof data.transaction !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.transaction)) throw new Error('Invalid receipt transaction');
}

function validatePaidJournal(value: unknown): asserts value is PaidJournal {
  if (!value || typeof value !== 'object') throw new Error('Invalid paid journal');
  const data = value as Record<string, unknown>;
  if (typeof data.eventId !== 'string' || !/^evt_[a-f0-9]{32}$/.test(data.eventId)) throw new Error('Invalid journal eventId');
  validateReceipt(data.receipt);
  const receipt = data.receipt as Receipt;
  if (receipt.eventId !== data.eventId) throw new Error('Journal receipt event mismatch');
  if (typeof data.paymentResponseHeader !== 'string' || data.paymentResponseHeader.length < 1 || data.paymentResponseHeader.length > 4096) throw new Error('Invalid journal payment response');
  if (typeof data.paidBodyHex !== 'string' || !/^[a-f0-9]{2,16384}$/.test(data.paidBodyHex) || data.paidBodyHex.length % 2 !== 0) throw new Error('Invalid journal body');
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(data.paidBodyHex, 'hex').toString('utf8')); } catch { throw new Error('Invalid journal body JSON'); }
  if (JSON.stringify(decoded) !== JSON.stringify(receipt)) throw new Error('Journal body does not bind exact receipt');
  if (data.settlementTransaction !== receipt.transaction) throw new Error('Journal transaction mismatch');
  if (typeof data.fulfillmentKey !== 'string' || !/^ful_[a-f0-9]{64}$/.test(data.fulfillmentKey)) throw new Error('Invalid fulfillment key');
  if (data.outboxState !== 'PENDING' && data.outboxState !== 'DONE') throw new Error('Invalid journal outbox state');
}

function assertSameJournalIdentity(left: PaidJournal, right: PaidJournal): void {
  const immutable = (journal: PaidJournal) => JSON.stringify({
    eventId: journal.eventId,
    receipt: journal.receipt,
    paymentResponseHeader: journal.paymentResponseHeader,
    paidBodyHex: journal.paidBodyHex,
    settlementTransaction: journal.settlementTransaction,
    fulfillmentKey: journal.fulfillmentKey
  });
  if (immutable(left) !== immutable(right)) throw new Error('Paid journal immutable fields changed');
}
