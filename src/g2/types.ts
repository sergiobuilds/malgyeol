export interface IntentAnalysis {
  sku: string;
  quantity: number;
  substitutionsAllowed: boolean;
  confidence: number;
  ambiguityReasons: string[];
  readbackSentence: string;
}

export type OrderStatus = 'NEEDS_CLARIFICATION' | 'AWAITING_CONFIRMATION' | 'COMMITTED' | 'BLOCKED';

export interface OrderResult {
  status: OrderStatus;
  challenge?: string;
  expiresAt?: number;
  readbackSentence?: string;
  reasons?: string[];
  commitmentHash?: string;
  commitmentVersion?: 'benefit-consent-v1';
}

export interface IntentInterpreter {
  analyzeAudio(audioBytes: Uint8Array, mimeType: string): Promise<IntentAnalysis>;
}

export interface Clock {
  now(): number;
}

export interface NonceGenerator {
  generate(): string;
}
