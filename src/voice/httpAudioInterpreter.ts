import type { InterpretedPurchase } from '../e2e/types.ts';

export interface HttpInterpretedPurchase extends InterpretedPurchase {
  providerMetadata: { provider: string; modelId: string; responseId?: string };
}

interface HttpAudioOptions {
  endpoint: string;
  bearerToken?: string;
  modelId?: string;
  providerName?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export class HttpAudioInterpreter {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: HttpAudioOptions) {
    this.fetcher = options.fetcher ?? fetch;
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost' && endpoint.hostname !== '127.0.0.1') {
      throw new Error('AI interpreter endpoint must use HTTPS');
    }
  }

  async analyzeAudio(bytes: Uint8Array, mimeType: string): Promise<HttpInterpretedPurchase> {
    if (bytes.byteLength === 0) throw new Error('Audio is empty');
    const response = await this.fetcher(this.options.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.options.bearerToken ? { authorization: `Bearer ${this.options.bearerToken}` } : {})
      },
      signal: AbortSignal.timeout(boundedTimeout(this.options.timeoutMs)),
      body: JSON.stringify({
        task: 'audio-purchase-intent',
        modelId: this.options.modelId,
        input: { mimeType, dataBase64: Buffer.from(bytes).toString('base64') },
        constraints: { neverDecide: ['eligibility', 'budget', 'policy', 'payment', 'order'], omitPersonalInformation: true }
      })
    });
    if (!response.ok) throw new Error(`AI audio interpretation failed: ${response.status}`);
    const parsed = await response.json() as Record<string, unknown>;
    if (!valid(parsed)) throw new Error('AI audio response schema invalid');
    return {
      requestedCategory: parsed.requestedCategory,
      requestedSku: parsed.requestedSku,
      quantity: parsed.quantity,
      substitutionsAllowed: parsed.substitutionsAllowed,
      referencesApprovedPlan: parsed.referencesApprovedPlan,
      confidence: parsed.confidence,
      ambiguityReasons: parsed.ambiguityReasons,
      safeUserSummary: parsed.safeUserSummary,
      providerMetadata: {
        provider: this.options.providerName ?? 'configured-http-provider',
        modelId: this.options.modelId ?? 'configured-model',
        ...(typeof parsed.responseId === 'string' && parsed.responseId ? { responseId: parsed.responseId } : {})
      }
    };
  }
}

function boundedTimeout(value: number | undefined): number {
  return Number.isSafeInteger(value) && value !== undefined && value >= 1 && value <= 60_000 ? value : 15_000;
}

function valid(value: Record<string, unknown>): value is Record<string, unknown> & InterpretedPurchase {
  return typeof value.requestedCategory === 'string'
    && typeof value.requestedSku === 'string'
    && Number.isSafeInteger(value.quantity) && (value.quantity as number) > 0
    && typeof value.substitutionsAllowed === 'boolean'
    && typeof value.referencesApprovedPlan === 'boolean'
    && typeof value.confidence === 'number'
    && Array.isArray(value.ambiguityReasons) && value.ambiguityReasons.every(reason => typeof reason === 'string')
    && typeof value.safeUserSummary === 'string';
}
