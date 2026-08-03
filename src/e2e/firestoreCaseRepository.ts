import { Firestore, type DocumentData } from '@google-cloud/firestore';
import type { CaseRepository } from './caseRepository.ts';
import type { BenefitCase, CaseEvent, CaseState } from './types.ts';

interface StoredCase extends BenefitCase { sequence: number; }

export class FirestoreCaseRepository implements CaseRepository {
  constructor(private readonly db = new Firestore()) {}

  async create(value: BenefitCase): Promise<void> {
    const ref = this.db.collection('cases').doc(value.caseId);
    await this.db.runTransaction(async transaction => {
      if ((await transaction.get(ref)).exists) throw new Error('Case already exists');
      const stored: StoredCase = { ...value, sequence: 1 };
      transaction.create(ref, stored);
      transaction.create(ref.collection('events').doc(sequenceId(1)), {
        caseId: value.caseId, sequence: 1, state: value.state, at: value.createdAt, data: {}
      });
    });
  }

  async get(caseId: string): Promise<BenefitCase | undefined> {
    const snapshot = await this.db.collection('cases').doc(caseId).get();
    return snapshot.exists ? fromStored(snapshot.data() as StoredCase) : undefined;
  }

  async list(limit = 50): Promise<BenefitCase[]> {
    const bounded = !Number.isSafeInteger(limit) || limit < 1 ? 50 : Math.min(limit, 100);
    const snapshot = await this.db.collection('cases').orderBy('updatedAt', 'desc').limit(bounded).get();
    return snapshot.docs.map(document => fromStored(document.data() as StoredCase));
  }

  async events(caseId: string): Promise<CaseEvent[]> {
    const snapshot = await this.db.collection('cases').doc(caseId).collection('events').orderBy('sequence').get();
    return snapshot.docs.map(document => document.data() as CaseEvent);
  }

  async transition(caseId: string, expected: CaseState, next: CaseState, patch: Partial<BenefitCase>, at: number): Promise<BenefitCase> {
    const ref = this.db.collection('cases').doc(caseId);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error('Case not found');
      const current = snapshot.data() as StoredCase;
      if (current.state !== expected) throw new Error(`Case state conflict: expected ${expected}, got ${current.state}`);
      const sequence = current.sequence + 1;
      const updated: StoredCase = { ...current, ...clean(patch), caseId, state: next, updatedAt: at, sequence };
      transaction.set(ref, updated);
      transaction.create(ref.collection('events').doc(sequenceId(sequence)), {
        caseId, sequence, state: next, at, data: clean(patch)
      });
      return fromStored(updated);
    });
  }

  async consumeConfirmation(caseId: string, commitment: string, at: number): Promise<boolean> {
    const ref = this.db.collection('cases').doc(caseId);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error('Case not found');
      const current = snapshot.data() as StoredCase;
      if (current.state !== 'AWAITING_CONFIRMATION' || current.confirmationCommitment) return false;
      if (current.confirmationExpiresAt === undefined || at > current.confirmationExpiresAt) return false;
      const sequence = current.sequence + 1;
      const updated: StoredCase = {
        ...current,
        state: 'CONFIRMED',
        confirmationCommitment: commitment,
        updatedAt: at,
        sequence
      };
      transaction.set(ref, updated);
      transaction.create(ref.collection('events').doc(sequenceId(sequence)), {
        caseId, sequence, state: 'CONFIRMED', at, data: { confirmationCommitment: commitment }
      });
      return true;
    });
  }
}

function fromStored(value: StoredCase): BenefitCase {
  const { sequence: _sequence, ...result } = value;
  return result;
}

function clean<T extends DocumentData>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function sequenceId(sequence: number): string {
  return sequence.toString().padStart(12, '0');
}
