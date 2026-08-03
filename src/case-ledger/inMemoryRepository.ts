import type { CanonicalCaseRepository, CanonicalLedgerTransaction } from './repository.ts';
import type { CanonicalCaseAggregate, CanonicalCaseEvent, CanonicalIdempotencyRecord } from './types.ts';

interface StoredCase {
  aggregate?: CanonicalCaseAggregate;
  events: Map<string, CanonicalCaseEvent>;
  idempotency: Map<string, CanonicalIdempotencyRecord>;
}

export class InMemoryCanonicalCaseRepository implements CanonicalCaseRepository {
  private readonly values = new Map<string, StoredCase>();
  private queue: Promise<void> = Promise.resolve();

  async runTransaction<T>(caseId: string, operation: (transaction: CanonicalLedgerTransaction) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      const current = cloneStored(this.values.get(caseId) ?? { events: new Map(), idempotency: new Map() });
      const transaction = new InMemoryTransaction(current);
      const result = await operation(transaction);
      this.values.set(caseId, current);
      return result;
    });
  }

  async getAggregate(caseId: string): Promise<CanonicalCaseAggregate | undefined> {
    const value = this.values.get(caseId)?.aggregate;
    return value ? structuredClone(value) : undefined;
  }

  async getEvent(caseId: string, eventId: string): Promise<CanonicalCaseEvent | undefined> {
    const value = this.values.get(caseId)?.events.get(eventId);
    return value ? structuredClone(value) : undefined;
  }

  async events(caseId: string): Promise<CanonicalCaseEvent[]> {
    return [...(this.values.get(caseId)?.events.values() ?? [])]
      .sort((left, right) => left.sequence - right.sequence)
      .map(value => structuredClone(value));
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
}

class InMemoryTransaction implements CanonicalLedgerTransaction {
  constructor(private readonly value: StoredCase) {}

  async getAggregate(): Promise<CanonicalCaseAggregate | undefined> {
    return this.value.aggregate ? structuredClone(this.value.aggregate) : undefined;
  }
  async getIdempotency(key: string): Promise<CanonicalIdempotencyRecord | undefined> {
    const value = this.value.idempotency.get(key);
    return value ? structuredClone(value) : undefined;
  }
  async getEvent(eventId: string): Promise<CanonicalCaseEvent | undefined> {
    const value = this.value.events.get(eventId);
    return value ? structuredClone(value) : undefined;
  }
  setAggregate(value: CanonicalCaseAggregate, create: boolean): void {
    if (create && this.value.aggregate) throw new Error('Canonical case already exists');
    this.value.aggregate = structuredClone(value);
  }
  createEvent(value: CanonicalCaseEvent): void {
    if (this.value.events.has(value.eventId)) throw new Error('Canonical event already exists');
    if ([...this.value.events.values()].some(event => event.sequence === value.sequence)) throw new Error('Canonical event sequence already exists');
    this.value.events.set(value.eventId, structuredClone(value));
  }
  createIdempotency(value: CanonicalIdempotencyRecord): void {
    if (this.value.idempotency.has(value.idempotencyKeyHash)) throw new Error('Canonical idempotency key already exists');
    this.value.idempotency.set(value.idempotencyKeyHash, structuredClone(value));
  }
}

function cloneStored(value: StoredCase): StoredCase {
  return {
    ...(value.aggregate ? { aggregate: structuredClone(value.aggregate) } : {}),
    events: new Map([...value.events].map(([key, event]) => [key, structuredClone(event)])),
    idempotency: new Map([...value.idempotency].map(([key, record]) => [key, structuredClone(record)]))
  };
}
