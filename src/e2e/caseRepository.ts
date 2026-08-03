import type { BenefitCase, CaseEvent, CaseState } from './types.ts';

export interface CaseRepository {
  create(value: BenefitCase): Promise<void>;
  get(caseId: string): Promise<BenefitCase | undefined>;
  list(limit?: number): Promise<BenefitCase[]>;
  events(caseId: string): Promise<CaseEvent[]>;
  transition(
    caseId: string,
    expected: CaseState,
    next: CaseState,
    patch: Partial<BenefitCase>,
    at: number
  ): Promise<BenefitCase>;
  consumeConfirmation(caseId: string, commitment: string, at: number): Promise<boolean>;
}
