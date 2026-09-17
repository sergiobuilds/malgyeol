export type ProgramId =
  | "foodbank-market"
  | "mobile-market"
  | "just-dream"
  | "care-sos";
export interface Source {
  url: string;
  title: string;
  checkedAt: string;
}
export interface ProgramOffering {
  programId: ProgramId;
  categories: string[];
  eligibility: string[];
  steps: string[];
  access: string[];
  hours: string;
  sources: Source[];
}
export interface Institution {
  id: string;
  name: string;
  address: string;
  district: string;
  roles: string[];
  contacts: { purpose: string; phone: string }[];
  programs: ProgramOffering[];
  sources: Source[];
}
export type NeedStatus =
  | "open"
  | "contacting"
  | "awaiting-choice"
  | "connected"
  | "needs-attention"
  | "stopped";
export interface CitizenProfile {
  name: string;
  address: string;
  age?: number;
  household?: string;
  mobility?: string;
  contactPreference?: string;
}
export interface RequestDetails {
  quantity?: string;
  requestedDate?: string;
  deliveryMethod?: string;
}
export interface Need {
  id: string;
  description: string;
  category: string;
  status: NeedStatus;
  constraints: string[];
  requestDetails?: RequestDetails;
  result?: string;
  choice?: string;
}
export interface ConsentInput {
  purpose: string;
  institutionIds: string[];
  sharedFields: string[];
  allowCoordination: boolean;
}
export interface CreateRequestInput {
  summary: string;
  district: string;
  constraints: string[];
  needs: {
    description: string;
    category: string;
    constraints?: string[];
    requestDetails?: RequestDetails;
  }[];
  citizenRef: string;
  citizenProfile?: CitizenProfile;
}
export interface SupportRequest {
  id: string;
  citizenRef: string;
  citizenProfile?: CitizenProfile;
  summary: string;
  district: string;
  constraints: string[];
  needs: Need[];
  consent?: ConsentInput;
  revision: number;
  createdAt: string;
  updatedAt: string;
  inquiries: Inquiry[];
  attempts: CallAttempt[];
  callbacks: {
    status: "completed" | "no-answer" | "failed";
    summary: string;
    at: string;
  }[];
}
export interface InquiryInput {
  needId: string;
  institutionId: string;
  programId: ProgramId;
  contactPurpose: string;
  questions: string[];
}
export interface Inquiry extends InquiryInput {
  id: string;
  revision: number;
  status:
    | "prepared"
    | "calling"
    | "answered"
    | "no-answer"
    | "failed"
    | "unknown"
    | "cancelled";
  answer?: AnswerInput;
}
export interface CallAttempt {
  id: string;
  inquiryId: string;
  requestId: string;
  idempotencyKey: string;
  status: "started" | "completed" | "no-answer" | "failed" | "unknown";
  startedAt: string;
  endedAt?: string;
  providerCallId?: string;
}
export interface AttemptResult {
  status: "completed" | "no-answer" | "failed" | "unknown";
  providerCallId?: string;
}
export interface AnswerInput {
  outcome: "available" | "declined" | "alternative";
  summary: string;
  conditions: string[];
  nextAction: string;
  requiresChoice: boolean;
}
export interface CoordinationEvent {
  id: string;
  requestId: string;
  type: string;
  at: string;
  detail: string;
  revision: number;
}
