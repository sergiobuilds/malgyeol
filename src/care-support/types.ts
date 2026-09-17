export type CareServiceCode = 'FOOD_PACKAGE' | 'DAILY_NECESSITIES' | 'MEAL_DELIVERY';

export type CareRequestStatus =
  | 'REQUESTED'
  | 'PROVIDER_SUBMITTED'
  | 'PROVIDER_ACCEPTED'
  | 'PROVIDED'
  | 'RECIPIENT_CONFIRMED'
  | 'EXCEPTION';

export interface CareCatalogItem {
  itemCode: string;
  serviceCode: CareServiceCode;
  name: string;
  unit: string;
  providerName: string;
  availability: 'AVAILABLE' | 'LIMITED' | 'UNAVAILABLE';
}

export interface CarePlanEnrollment {
  beneficiaryRef: string;
  displayName: string;
  allowedServices: CareServiceCode[];
  remainingOccurrences: Record<CareServiceCode, number>;
  activeUntil: string;
}

export interface CareRequest {
  caseId: string;
  evidenceClass: 'SYNTHETIC_DEMO';
  beneficiaryRef: string;
  beneficiaryDisplayName: string;
  serviceCode: CareServiceCode;
  itemCode: string;
  itemName: string;
  quantity: number;
  preferredDate: string;
  providerName: string;
  status: CareRequestStatus;
  exceptionReason?: string;
  exceptionOrigin?: 'SYSTEM' | 'OPERATOR' | 'RECIPIENT';
  createdAt: number;
  updatedAt: number;
  idempotencyKey?: string;
  providerRequestId?: string;
  dispatch?: 'SENDING' | 'ACKNOWLEDGED' | 'UNKNOWN';
}

export interface CareRequestEvent {
  sequence: number;
  caseId: string;
  type: CareRequestStatus | 'CONFIRMED';
  actor: 'RECIPIENT' | 'SYSTEM' | 'PROVIDER' | 'OPERATOR';
  at: number;
  detail: string;
}
