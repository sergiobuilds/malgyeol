import type { CareRequest, CareRequestEvent } from './types.ts';
import type { CareCall } from './phone.ts';
import type { ProviderReceipt } from './provider.ts';

export interface CareLedger {
  requests: Record<string, CareRequest>;
  history: Record<string, CareRequestEvent[]>;
  calls: Record<string, CareCall>;
  providerReceipts?: Record<string, ProviderReceipt>;
}

export function appendEvent(ledger: CareLedger, request: CareRequest, event: Omit<CareRequestEvent, 'sequence'>) {
  ledger.requests[request.caseId] = structuredClone(request);
  const events = ledger.history[request.caseId] ?? [];
  events.push({ ...event, sequence: events.length + 1 });
  ledger.history[request.caseId] = events;
}

export interface CareRequestRepository {
  transaction<T>(operation: (ledger: CareLedger) => T): T;
  get(caseId: string): Promise<CareRequest | undefined>;
  list(): Promise<CareRequest[]>;
  save(request: CareRequest, event: Omit<CareRequestEvent, 'sequence'>): Promise<void>;
  events(caseId: string): Promise<CareRequestEvent[]>;
}

export class InMemoryCareRequestRepository implements CareRequestRepository {
  private ledger: CareLedger = { requests: {}, history: {}, calls: {} };

  transaction<T>(operation: (ledger: CareLedger) => T): T {
    const draft = structuredClone(this.ledger);
    const result = operation(draft);
    this.ledger = draft;
    return structuredClone(result);
  }

  async get(caseId: string): Promise<CareRequest | undefined> {
    const value = this.ledger.requests[caseId];
    return value ? structuredClone(value) : undefined;
  }

  async list(): Promise<CareRequest[]> {
    return Object.values(this.ledger.requests)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(value => structuredClone(value));
  }

  async save(request: CareRequest, event: Omit<CareRequestEvent, 'sequence'>): Promise<void> {
    this.transaction(ledger => appendEvent(ledger, request, event));
  }

  async events(caseId: string): Promise<CareRequestEvent[]> {
    return structuredClone(this.ledger.history[caseId] ?? []);
  }
}
