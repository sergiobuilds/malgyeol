import { Firestore, type DocumentData, type Transaction } from '@google-cloud/firestore';
import type { CanonicalCaseRepository, CanonicalLedgerTransaction } from './repository.ts';
import type { CanonicalCaseAggregate, CanonicalCaseEvent, CanonicalIdempotencyRecord } from './types.ts';

export class FirestoreCanonicalCaseRepository implements CanonicalCaseRepository {
  constructor(private readonly db = new Firestore()) {}

  async runTransaction<T>(caseId: string, operation: (transaction: CanonicalLedgerTransaction) => Promise<T>): Promise<T> {
    validateCaseId(caseId);
    const caseRef = this.db.collection('canonicalCases').doc(caseId);
    return this.db.runTransaction(async firestoreTransaction => operation(
      new FirestoreLedgerTransaction(firestoreTransaction, caseRef)
    ));
  }

  async getAggregate(caseId: string): Promise<CanonicalCaseAggregate | undefined> {
    validateCaseId(caseId);
    const snapshot = await this.db.collection('canonicalCases').doc(caseId).get();
    return snapshot.exists ? snapshot.data() as CanonicalCaseAggregate : undefined;
  }

  async getEvent(caseId: string, eventId: string): Promise<CanonicalCaseEvent | undefined> {
    validateCaseId(caseId);
    const snapshot = await this.db.collection('canonicalCases').doc(caseId).collection('events').doc(eventId).get();
    return snapshot.exists ? snapshot.data() as CanonicalCaseEvent : undefined;
  }

  async events(caseId: string): Promise<CanonicalCaseEvent[]> {
    validateCaseId(caseId);
    const snapshot = await this.db.collection('canonicalCases').doc(caseId).collection('events').orderBy('sequence').get();
    return snapshot.docs.map(document => document.data() as CanonicalCaseEvent);
  }
}

class FirestoreLedgerTransaction implements CanonicalLedgerTransaction {
  constructor(
    private readonly transaction: Transaction,
    private readonly caseRef: FirebaseFirestore.DocumentReference
  ) {}

  async getAggregate(): Promise<CanonicalCaseAggregate | undefined> {
    const snapshot = await this.transaction.get(this.caseRef);
    return snapshot.exists ? snapshot.data() as CanonicalCaseAggregate : undefined;
  }
  async getIdempotency(key: string): Promise<CanonicalIdempotencyRecord | undefined> {
    const snapshot = await this.transaction.get(this.caseRef.collection('idempotency').doc(documentId(key)));
    return snapshot.exists ? snapshot.data() as CanonicalIdempotencyRecord : undefined;
  }
  async getEvent(eventId: string): Promise<CanonicalCaseEvent | undefined> {
    const snapshot = await this.transaction.get(this.caseRef.collection('events').doc(documentId(eventId)));
    return snapshot.exists ? snapshot.data() as CanonicalCaseEvent : undefined;
  }
  setAggregate(value: CanonicalCaseAggregate, create: boolean): void {
    if (create) this.transaction.create(this.caseRef, clean(value));
    else this.transaction.set(this.caseRef, clean(value));
  }
  createEvent(value: CanonicalCaseEvent): void {
    this.transaction.create(this.caseRef.collection('events').doc(documentId(value.eventId)), clean(value));
  }
  createIdempotency(value: CanonicalIdempotencyRecord): void {
    this.transaction.create(this.caseRef.collection('idempotency').doc(documentId(value.idempotencyKeyHash)), clean(value));
  }
}

function clean<T extends DocumentData>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function documentId(value: string): string {
  return value.replace(/^sha256:/, 'sha256_');
}

function validateCaseId(value: string): void {
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(value)) throw new Error('Invalid canonical caseId');
}
