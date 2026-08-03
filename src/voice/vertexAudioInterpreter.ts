import { GoogleAuth } from 'google-auth-library';
import type { InterpretedPurchase } from '../e2e/types.ts';

export interface VertexInterpretedPurchase extends InterpretedPurchase {
  responseId: string;
  modelVersion: string;
}

interface VertexOptions {
  project: string;
  location: string;
  model: string;
  tokenProvider?: () => Promise<string>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export class VertexAudioInterpreter {
  private readonly fetcher: typeof fetch;
  private readonly tokenProvider: () => Promise<string>;

  constructor(private readonly options: VertexOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.tokenProvider = options.tokenProvider ?? (async () => {
      const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
      const token = await client.getAccessToken();
      if (!token.token) throw new Error('Google access token unavailable');
      return token.token;
    });
  }

  async analyzeAudio(bytes: Uint8Array, mimeType: string): Promise<VertexInterpretedPurchase> {
    if (bytes.byteLength === 0) throw new Error('Audio is empty');
    const token = await this.tokenProvider();
    const endpoint = `https://${this.options.location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(this.options.project)}/locations/${encodeURIComponent(this.options.location)}/publishers/google/models/${encodeURIComponent(this.options.model)}:generateContent`;
    const body = {
      contents: [{ role: 'user', parts: [
        { text: '합성 참여자의 구매 요청만 구조화하라. 가격, 자격, 잔액, 장애 상태는 판정하지 마라.' },
        { inlineData: { mimeType, data: Buffer.from(bytes).toString('base64') } }
      ] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          required: ['requestedCategory', 'requestedSku', 'quantity', 'substitutionsAllowed', 'referencesApprovedPlan', 'confidence', 'ambiguityReasons', 'safeUserSummary'],
          properties: {
            requestedCategory: { type: 'STRING' }, requestedSku: { type: 'STRING' }, quantity: { type: 'INTEGER' },
            substitutionsAllowed: { type: 'BOOLEAN' }, referencesApprovedPlan: { type: 'BOOLEAN' },
            confidence: { type: 'NUMBER' }, ambiguityReasons: { type: 'ARRAY', items: { type: 'STRING' } },
            safeUserSummary: { type: 'STRING' }
          }
        }
      }
    };
    const response = await this.fetcher(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(boundedTimeout(this.options.timeoutMs)),
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Vertex audio interpretation failed: ${response.status}`);
    const payload = await response.json() as Record<string, unknown>;
    const candidates = payload.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
    const text = candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('') ?? '';
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!valid(parsed)) throw new Error('Vertex response schema invalid');
    return {
      requestedCategory: parsed.requestedCategory,
      requestedSku: parsed.requestedSku,
      quantity: parsed.quantity,
      substitutionsAllowed: parsed.substitutionsAllowed,
      referencesApprovedPlan: parsed.referencesApprovedPlan,
      confidence: parsed.confidence,
      ambiguityReasons: parsed.ambiguityReasons,
      safeUserSummary: parsed.safeUserSummary,
      responseId: typeof payload.responseId === 'string' ? payload.responseId : '',
      modelVersion: typeof payload.modelVersion === 'string' ? payload.modelVersion : this.options.model
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
