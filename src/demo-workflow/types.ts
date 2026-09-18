export type ExperienceMode = 'standard' | 'audience';
export interface Requirements {
  item: string; quantity: number; region: string; neededBy: string; maxCostKrw: number;
  dietaryRestrictions: string[]; alternatives: string[]; receivingMethod: 'delivery' | 'pickup';
  noMatchPreference: 'offer_callback' | 'stop'; consent: { contact: boolean; submit: boolean; callback: boolean };
}
export interface Seed { version: number; hash: string; requirements: Requirements; approvedAt?: number; approvalRef?: string; }
export interface Proof { mode: 'SIMULATION'; ref: string; observedAt: string; }
export interface Terms { item: string; quantity: number; costKrw: number; receivingMethod: Requirements['receivingMethod']; dietaryRestrictions: string[]; promisedBy: string; }
export interface NextOpportunity { at: string; timezone: string; instructions: string; proof: Proof; }
export type InquiryOutcome = { kind: 'available'; terms: Terms; proof: Proof } | { kind: 'unavailable'; reason: string; proof: Proof; next?: NextOpportunity } | { kind: 'no-answer'; retryAt: string };
export interface InquiryTask { id: string; institutionId: string; institutionName: string; item: string; priority: number; }
export interface Plan { hash: string; seedHash: string; task: InquiryTask; terms: Terms; proof: Proof; }
export interface Receipt { id: string; planHash: string; institutionId: string; terms: Terms; proof: Proof; }
export interface Verdict { pass: boolean; reasons: string[]; seedHash: string; planHash?: string; }
export interface StepEvidence { id: string; at: number; stage: string; data: unknown; }
export interface CallbackJob {
  id: string; status: 'PENDING' | 'CLAIMED' | 'DELIVERED' | 'UNKNOWN'; message: string;
  claimAt?: number; answer?: '1' | '2'; receiptRef?: string; next?: NextOpportunity;
}
export interface DemoCase {
  id: string; callId: string; citizenRef: string; revision: number; experienceMode?: ExperienceMode; requirements: Partial<Requirements>;
  phase: 'INTERVIEW' | 'SEED_READY' | 'APPROVED' | 'RUNNING' | 'READY' | 'UNKNOWN';
  challenge?: { nonce: string; hash: string; expiresAt: number; readback: string };
  seed?: Seed; runId?: string; inquiries: Record<string, InquiryOutcome>; plan?: Plan;
  ev1?: Verdict; receipt?: Receipt; ev2?: Verdict; callback?: CallbackJob;
  reservation?: { at: string; timezone: string; consentRef: string; status: 'SCHEDULED' | 'CANCELLED' | 'RECHECK_DUE' };
  events: StepEvidence[];
}
export interface DemoProvider {
  readonly mode: 'SIMULATION'; institutions: { id: string; name: string }[];
  inquire(task: InquiryTask, seed: Seed, signal: AbortSignal): Promise<InquiryOutcome>;
  submit(plan: Plan, key: string): Promise<Receipt | { kind: 'unknown'; ref: string }>;
}
