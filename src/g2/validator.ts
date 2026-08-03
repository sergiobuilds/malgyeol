import type { IntentAnalysis } from './types.ts';

export const ALLOWED_DEMO_SKU = 'DEMO_MEAL_01';
const MIN_CONFIDENCE = 0.9;
const MAX_QUANTITY = 7;
const ALLOWED_AUDIO_MIME_TYPES = new Set(['audio/wav', 'audio/webm', 'audio/ogg', 'audio/mpeg']);

export type ValidationResult =
  | { valid: true }
  | { valid: false; status: 'NEEDS_CLARIFICATION' | 'BLOCKED'; reasons: string[] };

export function validateAudio(audioBytes: Uint8Array, mimeType: string): string[] {
  const reasons: string[] = [];
  if (audioBytes.byteLength === 0) reasons.push('Audio is empty');
  if (!ALLOWED_AUDIO_MIME_TYPES.has(mimeType)) reasons.push('Unsupported audio MIME type');
  return reasons;
}

export function validateIntent(intent: Partial<IntentAnalysis>): ValidationResult {
  const ambiguityReasons: string[] = [];

  if (typeof intent.confidence !== 'number' || intent.confidence < MIN_CONFIDENCE) {
    ambiguityReasons.push('Confidence too low');
  }
  if (typeof intent.quantity !== 'number' || !Number.isInteger(intent.quantity) || intent.quantity <= 0 || intent.quantity > MAX_QUANTITY) {
    ambiguityReasons.push('Missing or invalid quantity');
  }
  if (typeof intent.substitutionsAllowed !== 'boolean') {
    ambiguityReasons.push('Missing substitutionsAllowed flag');
  }
  if (!intent.readbackSentence || typeof intent.readbackSentence !== 'string') {
    ambiguityReasons.push('Missing readback sentence');
  }
  if (Array.isArray(intent.ambiguityReasons) && intent.ambiguityReasons.length > 0) {
    ambiguityReasons.push(...intent.ambiguityReasons);
  }
  if (!intent.sku || typeof intent.sku !== 'string') {
    ambiguityReasons.push('Missing SKU');
  }

  if (ambiguityReasons.length > 0) {
    return { valid: false, status: 'NEEDS_CLARIFICATION', reasons: ambiguityReasons };
  }

  if (intent.sku !== ALLOWED_DEMO_SKU) {
    return { valid: false, status: 'BLOCKED', reasons: [`SKU ${intent.sku} is not approved`] };
  }

  return { valid: true };
}
