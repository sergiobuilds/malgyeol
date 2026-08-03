import { Firestore } from '@google-cloud/firestore';
import type { ExternalOrderReadback } from './types.ts';
import type { PaidOrderExecutionClaim, PaidOrderExecutionRecord, PaidOrderExecutionStore, PaidOrderExpectation } from './specialOffer.ts';

interface ExecutionDocument {
  fingerprint: string;
  status: 'IN_FLIGHT' | 'COMPLETED';
  claimedAt: number;
  completedAt?: number;
  expectation?: PaidOrderExpectation;
  order?: ExternalOrderReadback;
}

export class FirestorePaidOrderExecutionStore implements PaidOrderExecutionStore {
  private readonly firestore: Firestore;

  constructor(firestore = new Firestore()) {
    this.firestore = firestore;
  }

  async claim(caseId: string, fingerprint: string, expectation: PaidOrderExpectation, now: number, leaseMs: number): Promise<PaidOrderExecutionClaim> {
    const ref = this.firestore.collection('specialOfferOrderExecutions').doc(caseId);
    return this.firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        transaction.create(ref, { fingerprint, status: 'IN_FLIGHT', claimedAt: now, expectation } satisfies ExecutionDocument);
        return { status: 'CLAIMED' } as const;
      }
      const value = parseDocument(snapshot.data());
      if (value.fingerprint !== fingerprint) return { status: 'CONFLICT' } as const;
      if (value.status === 'COMPLETED' && value.order) return { status: 'COMPLETED', order: value.order } as const;
      return { status: 'IN_FLIGHT', claimedAt: value.claimedAt, leaseExpired: now >= value.claimedAt + leaseMs } as const;
    });
  }

  async complete(caseId: string, fingerprint: string, order: ExternalOrderReadback, now: number): Promise<void> {
    const ref = this.firestore.collection('specialOfferOrderExecutions').doc(caseId);
    await this.firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error('Missing paid order execution claim');
      const value = parseDocument(snapshot.data());
      if (value.fingerprint !== fingerprint) throw new Error('Paid order execution fingerprint mismatch');
      if (value.status === 'COMPLETED') return;
      transaction.update(ref, { status: 'COMPLETED', completedAt: now, order });
    });
  }

  async getCompleted(caseId: string): Promise<ExternalOrderReadback | undefined> {
    const snapshot = await this.firestore.collection('specialOfferOrderExecutions').doc(caseId).get();
    if (!snapshot.exists) return undefined;
    const value = parseDocument(snapshot.data());
    return value.status === 'COMPLETED' ? value.order : undefined;
  }

  async get(caseId: string): Promise<PaidOrderExecutionRecord | undefined> {
    const snapshot = await this.firestore.collection('specialOfferOrderExecutions').doc(caseId).get();
    if (!snapshot.exists) return undefined;
    return parseDocument(snapshot.data());
  }
}

function parseDocument(value: unknown): ExecutionDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid paid order execution document');
  const record = value as Record<string, unknown>;
  if (typeof record.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(record.fingerprint)) throw new Error('Invalid execution fingerprint');
  if (record.status !== 'IN_FLIGHT' && record.status !== 'COMPLETED') throw new Error('Invalid execution status');
  if (!Number.isSafeInteger(record.claimedAt)) throw new Error('Invalid execution timestamp');
  if (record.status === 'COMPLETED' && (!record.order || typeof record.order !== 'object' || Array.isArray(record.order))) {
    throw new Error('Invalid completed execution order');
  }
  return record as unknown as ExecutionDocument;
}
