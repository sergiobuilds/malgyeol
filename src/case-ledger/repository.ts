import type { CanonicalCaseAggregate, CanonicalCaseEvent, CanonicalIdempotencyRecord } from './types.ts';

export interface CanonicalLedgerTransaction {
  getAggregate(): Promise<CanonicalCaseAggregate | undefined>;
  getIdempotency(idempotencyKeyHash: string): Promise<CanonicalIdempotencyRecord | undefined>;
  getEvent(eventId: string): Promise<CanonicalCaseEvent | undefined>;
  setAggregate(value: CanonicalCaseAggregate, create: boolean): void;
  createEvent(value: CanonicalCaseEvent): void;
  createIdempotency(value: CanonicalIdempotencyRecord): void;
}

export interface CanonicalCaseRepository {
  runTransaction<T>(caseId: string, operation: (transaction: CanonicalLedgerTransaction) => Promise<T>): Promise<T>;
  getAggregate(caseId: string): Promise<CanonicalCaseAggregate | undefined>;
  getEvent(caseId: string, eventId: string): Promise<CanonicalCaseEvent | undefined>;
  events(caseId: string): Promise<CanonicalCaseEvent[]>;
}
