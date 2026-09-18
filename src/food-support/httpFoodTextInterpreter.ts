import type { FoodVoucherCategory } from './types.ts';

export interface FoodTextInterpretation {
  normalizedQuery: string;
  requestedCategories: FoodVoucherCategory[];
  exactProductName?: string;
  quantity: number;
  substitutionsAllowed: boolean;
  needsClarification: boolean;
  ambiguityReasons: string[];
  safeUserSummary: string;
  confidence: number;
  providerMetadata: { provider: string; modelId: string; responseId?: string };
}

interface HttpFoodTextOptions {
  endpoint: string;
  bearerToken?: string;
  modelId?: string;
  providerName?: string;
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

export class HttpFoodTextInterpreter {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: HttpFoodTextOptions) {
    this.fetcher = options.fetcher ?? fetch;
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost' && endpoint.hostname !== '127.0.0.1') {
      throw new Error('AI interpreter endpoint must use HTTPS');
    }
  }

  async interpret(text: string): Promise<FoodTextInterpretation> {
    const normalized = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.length > 1000) throw new Error('Invalid food text');
    const response = await this.fetcher(this.options.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.options.bearerToken ? { authorization: `Bearer ${this.options.bearerToken}` } : {})
      },
      signal: AbortSignal.timeout(boundedTimeout(this.options.timeoutMs)),
      body: JSON.stringify({
        task: 'food-intent',
        modelId: this.options.modelId,
        input: { text: normalized },
        constraints: {
          allowedCategories: CATEGORIES,
          neverDecide: ['eligibility', 'budget', 'policy', 'payment', 'order'],
          preserveExactProductName: true,
          omitPersonalInformation: true
        }
      })
    });
    if (!response.ok) throw new Error(`AI food text interpretation failed: ${response.status}`);
    const parsed = await response.json() as Record<string, unknown>;
    if (!valid(parsed)) throw new Error('AI food text response schema invalid');
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

function valid(value: Record<string, unknown>): value is Record<string, unknown> & Omit<FoodTextInterpretation, 'providerMetadata' | 'exactProductName'> & { exactProductName: string } {
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
