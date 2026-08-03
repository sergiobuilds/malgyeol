import { GoogleAuth } from 'google-auth-library';
import type { FoodVoucherCategory } from './types.ts';

export interface VertexFoodTextInterpretation {
  normalizedQuery: string;
  requestedCategories: FoodVoucherCategory[];
  exactProductName?: string;
  quantity: number;
  substitutionsAllowed: boolean;
  needsClarification: boolean;
  ambiguityReasons: string[];
  safeUserSummary: string;
  confidence: number;
  responseId: string;
  modelVersion: string;
}

interface VertexFoodTextOptions {
  project: string;
  location: string;
  model: string;
  tokenProvider?: () => Promise<string>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

const CATEGORIES: FoodVoucherCategory[] = [
  'DOMESTIC_FRUIT', 'DOMESTIC_VEGETABLE', 'WHITE_MILK', 'FRESH_EGGS', 'MEAT',
  'MIXED_GRAINS', 'TOFU', 'FOREST_NUTS', 'WHITE_RICE', 'INSTANT_NOODLES',
  'PROCESSED_FOOD', 'FOREIGN_FOOD', 'SEAFOOD', 'ALCOHOL', 'TOBACCO',
  'GIFT_CARD', 'CASH_EQUIVALENT', 'FIREARM', 'AMMUNITION', 'ILLEGAL_DRUG',
  'HIGH_RISK_UNKNOWN', 'OUT_OF_POLICY'
];

export class VertexFoodTextInterpreter {
  private readonly fetcher: typeof fetch;
  private readonly tokenProvider: () => Promise<string>;

  constructor(private readonly options: VertexFoodTextOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.tokenProvider = options.tokenProvider ?? (async () => {
      const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
      const token = await client.getAccessToken();
      if (!token.token) throw new Error('Google access token unavailable');
      return token.token;
    });
  }

  async interpret(text: string): Promise<VertexFoodTextInterpretation> {
    const normalized = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.length > 1000) throw new Error('Invalid food text');
    const token = await this.tokenProvider();
    const endpoint = `https://${this.options.location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(this.options.project)}/locations/${encodeURIComponent(this.options.location)}/publishers/google/models/${encodeURIComponent(this.options.model)}:generateContent`;
    const response = await this.fetcher(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(boundedTimeout(this.options.timeoutMs)),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: [
          '한국어 식품지원 요청을 상품 검색 조건으로만 구조화한다.',
          '가격, 지원 자격, 예산, 정책 승인, 결제 허용 여부를 판정하지 않는다.',
          '사용자가 특정 상품명을 말하면 그대로 보존한다. 모호하면 임의 상품을 고르지 않는다.',
          '수량을 말하지 않은 탐색·질문 요청은 quantity를 0으로, 구매 요청이지만 수량이 없으면 1로 내본다.',
          '출력에는 개인정보를 포함하지 않는다.'
        ].join(' ') }] },
        contents: [{ role: 'user', parts: [{ text: normalized }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            required: ['normalizedQuery', 'requestedCategories', 'exactProductName', 'quantity', 'substitutionsAllowed', 'needsClarification', 'ambiguityReasons', 'safeUserSummary', 'confidence'],
            properties: {
              normalizedQuery: { type: 'STRING' },
              requestedCategories: { type: 'ARRAY', items: { type: 'STRING', enum: CATEGORIES } },
              exactProductName: { type: 'STRING' },
              quantity: { type: 'INTEGER' },
              substitutionsAllowed: { type: 'BOOLEAN' },
              needsClarification: { type: 'BOOLEAN' },
              ambiguityReasons: { type: 'ARRAY', items: { type: 'STRING' } },
              safeUserSummary: { type: 'STRING' },
              confidence: { type: 'NUMBER' }
            }
          }
        }
      })
    });
    if (!response.ok) throw new Error(`Vertex food text interpretation failed: ${response.status}`);
    const payload = await response.json() as Record<string, unknown>;
    const candidates = payload.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
    const raw = candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('') ?? '';
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!valid(parsed)) throw new Error('Vertex food text response schema invalid');
    return {
      normalizedQuery: parsed.normalizedQuery.trim(),
      requestedCategories: parsed.requestedCategories,
      ...(parsed.exactProductName.trim() ? { exactProductName: parsed.exactProductName.trim() } : {}),
      quantity: parsed.quantity,
      substitutionsAllowed: parsed.substitutionsAllowed,
      needsClarification: parsed.needsClarification,
      ambiguityReasons: parsed.ambiguityReasons,
      safeUserSummary: parsed.safeUserSummary,
      confidence: parsed.confidence,
      responseId: typeof payload.responseId === 'string' ? payload.responseId : '',
      modelVersion: typeof payload.modelVersion === 'string' ? payload.modelVersion : this.options.model
    };
  }
}

function boundedTimeout(value: number | undefined): number {
  return Number.isSafeInteger(value) && value !== undefined && value >= 1 && value <= 60_000 ? value : 15_000;
}

function valid(value: Record<string, unknown>): value is Record<string, unknown> & Omit<VertexFoodTextInterpretation, 'responseId' | 'modelVersion'> & { exactProductName: string } {
  return typeof value.normalizedQuery === 'string' && value.normalizedQuery.trim().length > 0 && value.normalizedQuery.length <= 500
    && Array.isArray(value.requestedCategories) && value.requestedCategories.length <= 20
    && value.requestedCategories.every(category => typeof category === 'string' && CATEGORIES.includes(category as FoodVoucherCategory))
    && typeof value.exactProductName === 'string' && value.exactProductName.length <= 500
    && Number.isSafeInteger(value.quantity) && Number(value.quantity) >= 0 && Number(value.quantity) <= 100
    && typeof value.substitutionsAllowed === 'boolean'
    && typeof value.needsClarification === 'boolean'
    && Array.isArray(value.ambiguityReasons) && value.ambiguityReasons.every(reason => typeof reason === 'string' && reason.length <= 200)
    && typeof value.safeUserSummary === 'string' && value.safeUserSummary.length <= 500
    && typeof value.confidence === 'number' && value.confidence >= 0 && value.confidence <= 1;
}
