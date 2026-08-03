import type { CaseRepository } from './caseRepository.ts';
import type { BenefitCase, CaseEvent, CaseState } from './types.ts';

export class InMemoryCaseRepository implements CaseRepository {
  private readonly cases = new Map<string, BenefitCase>();
  private readonly eventLog = new Map<string, CaseEvent[]>();
  private queue: Promise<void> = Promise.resolve();

  async create(value: BenefitCase): Promise<void> {
    await this.serial(async () => {
      if (this.cases.has(value.caseId)) throw new Error('Case already exists');
      this.cases.set(value.caseId, structuredClone(value));
      this.eventLog.set(value.caseId, [{
        caseId: value.caseId,
        sequence: 1,
        state: value.state,
        at: value.createdAt,
        data: {}
      }]);
    });
  }

  async get(caseId: string): Promise<BenefitCase | undefined> {
    const value = this.cases.get(caseId);
    return value ? structuredClone(value) : undefined;
  }

  async list(limit = 50): Promise<BenefitCase[]> {
    return [...this.cases.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, boundedLimit(limit))
      .map(value => structuredClone(value));
  }

  async events(caseId: string): Promise<CaseEvent[]> {
    return structuredClone(this.eventLog.get(caseId) ?? []);
  }

  async transition(caseId: string, expected: CaseState, next: CaseState, patch: Partial<BenefitCase>, at: number): Promise<BenefitCase> {
    return this.serial(async () => {
      const current = this.cases.get(caseId);
      if (!current) throw new Error('Case not found');
      if (current.state !== expected) throw new Error(`Case state conflict: expected ${expected}, got ${current.state}`);
      const updated: BenefitCase = { ...current, ...structuredClone(patch), caseId, state: next, updatedAt: at };
      this.cases.set(caseId, updated);
      this.append(caseId, next, at, patch as Record<string, unknown>);
      return structuredClone(updated);
    });
  }

  async consumeConfirmation(caseId: string, commitment: string, at: number): Promise<boolean> {
    return this.serial(async () => {
      const current = this.cases.get(caseId);
      if (!current) throw new Error('Case not found');
      if (current.state === 'CONFIRMED' || current.confirmationCommitment) return false;
      if (current.state !== 'AWAITING_CONFIRMATION') return false;
      if (current.confirmationExpiresAt === undefined || at > current.confirmationExpiresAt) return false;
      const updated: BenefitCase = { ...current, state: 'CONFIRMED', confirmationCommitment: commitment, updatedAt: at };
      this.cases.set(caseId, updated);
      this.append(caseId, 'CONFIRMED', at, { confirmationCommitment: commitment });
      return true;
    });
  }

  private append(caseId: string, state: CaseState, at: number, data: Record<string, unknown>): void {
    const events = this.eventLog.get(caseId);
    if (!events) throw new Error('Case event log not found');
    events.push({ caseId, sequence: events.length + 1, state, at, data: structuredClone(data) });
  }

  private async serial<T>(operation: () => Promise<T> | T): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
}

function boundedLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return 50;
  return Math.min(value, 100);
}
