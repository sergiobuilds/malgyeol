import { createHash } from 'node:crypto';
import type { Clock, GeminiInterpreter, NonceGenerator, OrderResult } from './types.ts';
import { validateAudio, validateIntent } from './validator.ts';

const CHALLENGE_TTL_MS = 60000;

interface PendingChallenge {
  sku: string;
  quantity: number;
  substitutionsAllowed: boolean;
  expiresAt: number;
}

export class OrderService {
  private pendingChallenges = new Map<string, PendingChallenge>();
  private readonly interpreter: GeminiInterpreter;
  private readonly clock: Clock;
  private readonly nonceGen: NonceGenerator;

  constructor(
    interpreter: GeminiInterpreter,
    clock: Clock,
    nonceGen: NonceGenerator
  ) {
    this.interpreter = interpreter;
    this.clock = clock;
    this.nonceGen = nonceGen;
  }

  async processAudio(audioBytes: Uint8Array, mimeType: string): Promise<OrderResult> {
    const audioReasons = validateAudio(audioBytes, mimeType);
    if (audioReasons.length > 0) {
      return { status: 'NEEDS_CLARIFICATION', reasons: audioReasons, readbackSentence: '주문 내용을 다시 말씀해주세요.' };
    }

    let intent;
    try {
      intent = await this.interpreter.analyzeAudio(audioBytes, mimeType);
    } catch {
      return { status: 'NEEDS_CLARIFICATION', reasons: ['Gemini interpretation failed'], readbackSentence: '주문 내용을 다시 말씀해주세요.' };
    }
    const validation = validateIntent(intent);

    if (!validation.valid) {
      const readbackSentence = validation.status === 'NEEDS_CLARIFICATION'
        ? (intent.readbackSentence || '주문 내용을 다시 말씀해주세요.')
        : undefined;
      return {
        status: validation.status,
        reasons: validation.reasons,
        ...(readbackSentence === undefined ? {} : { readbackSentence })
      };
    }

    const challenge = this.nonceGen.generate();
    if (!challenge || this.pendingChallenges.has(challenge)) {
      return { status: 'BLOCKED', reasons: ['Challenge collision'] };
    }
    const expiresAt = this.clock.now() + CHALLENGE_TTL_MS;

    this.pendingChallenges.set(challenge, {
      sku: intent.sku,
      quantity: intent.quantity,
      substitutionsAllowed: intent.substitutionsAllowed,
      expiresAt
    });

    return {
      status: 'AWAITING_CONFIRMATION',
      challenge,
      expiresAt,
      readbackSentence: intent.readbackSentence
    };
  }

  confirmOrder(challenge: string, explicitConfirmation: boolean): OrderResult {
    const pending = this.pendingChallenges.get(challenge);

    if (!pending) {
      return { status: 'BLOCKED', reasons: ['Challenge not found or already consumed'] };
    }

    this.pendingChallenges.delete(challenge);

    if (this.clock.now() > pending.expiresAt) {
      return { status: 'BLOCKED', reasons: ['Challenge expired'] };
    }

    if (!explicitConfirmation) {
      return { status: 'BLOCKED', reasons: ['User rejected the order confirmation'] };
    }

    const payload = JSON.stringify({
      version: 'benefit-consent-v1',
      challenge,
      sku: pending.sku,
      quantity: pending.quantity,
      substitutionsAllowed: pending.substitutionsAllowed,
      expiresAt: pending.expiresAt
    });
    const commitmentHash = createHash('sha256').update(payload, 'utf8').digest('hex');

    return {
      status: 'COMMITTED',
      commitmentHash,
      commitmentVersion: 'benefit-consent-v1'
    };
  }
}
