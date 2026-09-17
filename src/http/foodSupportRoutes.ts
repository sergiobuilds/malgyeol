import { createHash } from 'node:crypto';
import { appendConversationTurn } from '../food-support/conversation.ts';
import { evaluateFoodSupportPolicy, FOOD_VOUCHER_POLICY } from '../food-support/policy.ts';
import { SpecialOfferHttpError, type SpecialOfferCatalogAdapter } from '../food-support/specialOffer.ts';
import { InMemoryConversationRepository, type ConversationRepository } from '../food-support/conversationRepository.ts';
import type { CartLine, FoodProduct, FoodSupportBudget } from '../food-support/types.ts';
import type { FoodTextInterpretation } from '../food-support/httpFoodTextInterpreter.ts';
import { containsLikelyPii } from '../food-support/privacy.ts';

export interface SafeJourneyEvent {
  source: 'PHONE' | 'WEB' | 'ROLE';
  event: string;
  at: number;
  sequence: number;
  role?: 'caregiver' | 'ops' | 'merchant';
  queryHash?: string;
}

export interface FoodSupportRouteRequest {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  body?: Record<string, unknown>;
}

export interface FoodSupportRouteResponse {
  status: number;
  body: unknown;
}

export class FoodSupportInputError extends Error {}

export function createFoodSupportHandlers(
  catalog: SpecialOfferCatalogAdapter,
  validateContinuation?: (caseId: string, token: string | undefined) => Promise<boolean>,
  conversations: ConversationRepository = new InMemoryConversationRepository(),
  loadBudget?: (caseId: string) => Promise<FoodSupportBudget | undefined>,
  isDuplicateCase?: (caseId: string) => Promise<boolean>,
  loadJourney?: (caseId: string) => Promise<SafeJourneyEvent[]>,
  issueFoodAccess?: (caseId: string, sessionId: string) => { token: string; expiresAt: number },
  validateFoodAccess?: (caseId: string, token: string | undefined) => boolean,
  interpretFoodText?: (text: string) => Promise<FoodTextInterpretation>
) {
  return async (request: FoodSupportRouteRequest): Promise<FoodSupportRouteResponse> => {
    if (request.method === 'GET' && request.pathname === '/api/food-support/program') {
      return { status: 200, body: FOOD_VOUCHER_POLICY };
    }
    if (request.method === 'POST' && request.pathname === '/api/food-support/interpret') {
      const caseId = requiredIdentifier(request.body?.caseId, 'caseId');
      const text = requiredText(request.body?.text, 'text', 1000);
      if (validateContinuation && !caseId.startsWith('web_')) {
        const token = optionalText(request.body?.continuationToken, 'continuationToken', 256);
        if (!await validateContinuation(caseId, token || undefined)) {
          return { status: 403, body: { error: 'Invalid or expired phone-to-web continuation' } };
        }
      }
      const value = appendConversationTurn(await conversations.get(caseId), { caseId, text });
      await conversations.save(value.session);
      const access = issueFoodAccess?.(caseId, value.session.sessionId);
      const deterministicBlocked = value.parsed.requestedCategories.some(category => [
        'FIREARM', 'AMMUNITION', 'ILLEGAL_DRUG', 'TOBACCO', 'ALCOHOL', 'GIFT_CARD', 'CASH_EQUIVALENT', 'HIGH_RISK_UNKNOWN'
      ].includes(category));
      let interpretation: FoodTextInterpretation | undefined;
      const piiBlocked = containsLikelyPii(text);
      if (interpretFoodText && !deterministicBlocked && !piiBlocked) {
        try { interpretation = await interpretFoodText(text); } catch { interpretation = undefined; }
      }
      return {
        status: 200,
        body: {
          caseId,
          sessionId: value.session.sessionId,
          turnCount: value.session.turns.length,
          ...(access ? { sessionAccessToken: access.token, sessionAccessExpiresAt: access.expiresAt } : {}),
          ...(interpretation ? { interpretation: {
            ...interpretation,
            engine: 'CONFIGURED_AI_PROVIDER',
            policyAuthority: false,
            inputHash: `sha256:${createTextHash(text)}`
          } } : { interpretation: {
            engine: deterministicBlocked
              ? 'SKIPPED_POLICY_BOUNDARY'
              : piiBlocked
                ? 'SKIPPED_PII_BOUNDARY'
                : interpretFoodText ? 'AI_PROVIDER_UNAVAILABLE' : 'DETERMINISTIC_ONLY',
            policyAuthority: false
          } }),
          ...value.parsed
        }
      };
    }
    if (request.method === 'GET' && request.pathname === '/api/food-support/catalog') {
      const query = request.searchParams.get('query')?.trim() ?? '';
      const exactName = request.searchParams.get('exactName')?.trim();
      if (containsLikelyPii(query) || (exactName && containsLikelyPii(exactName))) {
        return { status: 400, body: { error: 'PII_NOT_ALLOWED' } };
      }
      const result = await catalog.search({ query, ...(exactName ? { exactName } : {}) });
      if (result.status === 'CREDENTIAL_GATED') return { status: 503, body: result };
      const products = result.products.filter(isPublicOrderCandidate);
      return { status: 200, body: { ...result, products, exactMatch: result.exactMatch && products.length > 0 } };
    }
    if (request.method === 'GET' && request.pathname === '/api/food-support/catalog-item') {
      const goodsNo = requiredIdentifier(request.searchParams.get('goodsNo'), 'goodsNo');
      let result: Awaited<ReturnType<SpecialOfferCatalogAdapter['get']>>;
      try {
        result = await catalog.get(goodsNo);
      } catch (error) {
        if (error instanceof SpecialOfferHttpError && error.status === 404) {
          return { status: 404, body: { error: 'PRODUCT_NOT_ORDERABLE' } };
        }
        throw error;
      }
      if (result.status === 'CREDENTIAL_GATED') return { status: 503, body: result };
      if (!isPublicOrderCandidate(result.product)) return { status: 404, body: { error: 'PRODUCT_NOT_ORDERABLE' } };
      return { status: 200, body: { status: 'LIVE', product: result.product } };
    }
    if (request.method === 'GET' && request.pathname === '/api/food-support/journey') {
      const caseId = requiredIdentifier(request.searchParams.get('caseId'), 'caseId');
      const token = optionalText(request.searchParams.get('continuationToken'), 'continuationToken', 256);
      if (!validateContinuation || !await validateContinuation(caseId, token || undefined)) {
        return { status: 403, body: { error: 'Invalid or expired phone-to-web continuation' } };
      }
      if (!loadJourney) return { status: 503, body: { error: 'Journey is not configured' } };
      const events = await loadJourney(caseId);
      return { status: 200, body: { caseId, events } };
    }
    if (request.method === 'POST' && request.pathname === '/api/food-support/order-readiness') {
      const caseId = requiredIdentifier(request.body?.caseId, 'caseId');
      const goodsNo = requiredIdentifier(request.body?.goodsNo, 'goodsNo');
      const quantity = requiredInteger(request.body?.quantity, 'quantity', 1, 100);
      const originalUtterance = requiredText(request.body?.originalUtterance, 'originalUtterance', 1000);
      if (!await authorizedFoodSession(caseId, request.body, validateContinuation, validateFoodAccess)) return { status: 403, body: { error: 'Invalid or expired food session access' } };
      if (!loadBudget) return { status: 503, body: { status: 'BUDGET_CREDENTIAL_GATED' } };
      const budget = await loadBudget(caseId);
      if (!budget) return { status: 503, body: { status: 'BUDGET_CREDENTIAL_GATED' } };
      const catalogResult = await catalog.get(goodsNo);
      if (catalogResult.status === 'CREDENTIAL_GATED') return { status: 503, body: { status: 'CREDENTIAL_GATED' } };
      const product = catalogResult.product;
      const duplicateCase = isDuplicateCase ? await isDuplicateCase(caseId) : false;
      const decision = evaluateFoodSupportPolicy({
        lines: [{ lineId: 'readiness', product, quantity, quotedUnitPriceKrw: product.unitPriceKrw }],
        budget, originalUtterance, duplicateCase
      });
      return {
        status: 200,
        body: {
          status: decision.decision === 'APPROVED' ? 'PAID_ACTION_REQUIRED' : decision.decision,
          caseId,
          product: {
            goodsNo: product.goodsNo, sellerCode: product.sellerCode, name: product.name,
            origin: product.origin, quantity, unitPriceKrw: product.unitPriceKrw,
            shippingFeeKrw: product.shippingFeeKrw,
            totalPriceKrw: product.unitPriceKrw * quantity + product.shippingFeeKrw,
            refundable: product.refundable, nonRefundableConditions: product.nonRefundableConditions
          },
          budgetCheck: { sufficient: budget.remainingKrw >= decision.approvedAmountKrw && budget.maximumPurchaseKrw >= decision.approvedAmountKrw },
          policyDecision: decision,
          recipientStatus: 'RECIPIENT_REQUIRED',
          supplierPostCalls: 0
        }
      };
    }
    if (request.method === 'POST' && request.pathname === '/api/food-support/policy') {
      const caseId = requiredIdentifier(request.body?.caseId, 'caseId');
      const originalUtterance = requiredText(request.body?.originalUtterance, 'originalUtterance', 1000);
      const lines = parseCartLines(request.body?.lines);
      if (!await authorizedFoodSession(caseId, request.body, validateContinuation, validateFoodAccess)) return { status: 403, body: { error: 'Invalid or expired food session access' } };
      if (!loadBudget) return { status: 503, body: { status: 'BUDGET_CREDENTIAL_GATED' } };
      const budget = await loadBudget(caseId);
      if (!budget) return { status: 503, body: { status: 'BUDGET_CREDENTIAL_GATED' } };
      const authoritative = await Promise.all(lines.map(line => catalog.get(line.product.goodsNo)));
      if (authoritative.some(value => value.status === 'CREDENTIAL_GATED')) return { status: 503, body: { status: 'CREDENTIAL_GATED' } };
      const trustedLines = lines.map((line, index) => ({
        ...line,
        product: (authoritative[index] as { status: 'LIVE'; product: FoodProduct }).product
      }));
      const duplicateCase = isDuplicateCase ? await isDuplicateCase(caseId) : false;
      const result = evaluateFoodSupportPolicy({ lines: trustedLines, budget, originalUtterance, duplicateCase });
      return { status: 200, body: result };
    }
    return { status: 404, body: { error: 'Not found' } };
  };
}

function isPublicOrderCandidate(product: FoodProduct): boolean {
  return FOOD_VOUCHER_POLICY.allowedCategories.includes(product.category)
    && product.originStatus === 'DOMESTIC'
    && product.inStock
    && product.selling
    && product.deliveryAvailable;
}

function createTextHash(value: string): string {
  return createHash('sha256').update(value.normalize('NFKC').trim()).digest('hex');
}

async function authorizedFoodSession(
  caseId: string,
  body: Record<string, unknown> | undefined,
  validateContinuation: ((caseId: string, token: string | undefined) => Promise<boolean>) | undefined,
  validateFoodAccess: ((caseId: string, token: string | undefined) => boolean) | undefined
): Promise<boolean> {
  const sessionToken = optionalText(body?.sessionAccessToken, 'sessionAccessToken', 2048);
  if (validateFoodAccess?.(caseId, sessionToken || undefined)) return true;
  const continuationToken = optionalText(body?.continuationToken, 'continuationToken', 256);
  return Boolean(validateContinuation && await validateContinuation(caseId, continuationToken || undefined));
}

function parseCartLines(value: unknown): CartLine[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new FoodSupportInputError('Invalid lines');
  return value.map((candidate, index) => {
    const input = record(candidate, `lines[${index}]`);
    const product = parseProduct(input.product, `lines[${index}].product`);
    const quantity = requiredInteger(input.quantity, `lines[${index}].quantity`, 1, 100);
    const quotedUnitPriceKrw = requiredInteger(input.quotedUnitPriceKrw, `lines[${index}].quotedUnitPriceKrw`, -1_000_000_000, 1_000_000_000);
    return {
      lineId: requiredIdentifier(input.lineId, `lines[${index}].lineId`),
      product,
      quantity,
      quotedUnitPriceKrw
    };
  });
}

function parseProduct(value: unknown, name: string): FoodProduct {
  const input = record(value, name);
  const refundable = input.refundable;
  if (refundable !== true && refundable !== false && refundable !== 'CONDITIONAL') throw new FoodSupportInputError(`Invalid ${name}.refundable`);
  const originStatus = input.originStatus;
  if (originStatus !== 'DOMESTIC' && originStatus !== 'FOREIGN' && originStatus !== 'UNKNOWN') throw new FoodSupportInputError(`Invalid ${name}.originStatus`);
  const source = input.source;
  if (source !== 'SPECIAL_OFFER_LIVE' && source !== 'TEST_FIXTURE') throw new FoodSupportInputError(`Invalid ${name}.source`);
  return {
    goodsNo: requiredIdentifier(input.goodsNo, `${name}.goodsNo`),
    goodsCode: optionalText(input.goodsCode, `${name}.goodsCode`, 128),
    sellerCode: optionalText(input.sellerCode, `${name}.sellerCode`, 128),
    name: requiredText(input.name, `${name}.name`, 500),
    category: requiredText(input.category, `${name}.category`, 100) as FoodProduct['category'],
    origin: optionalText(input.origin, `${name}.origin`, 200),
    originStatus,
    unitPriceKrw: requiredInteger(input.unitPriceKrw, `${name}.unitPriceKrw`, -1_000_000_000, 1_000_000_000),
    shippingFeeKrw: requiredInteger(input.shippingFeeKrw, `${name}.shippingFeeKrw`, 0, 1_000_000_000),
    inStock: requiredBoolean(input.inStock, `${name}.inStock`),
    selling: requiredBoolean(input.selling, `${name}.selling`),
    deliveryAvailable: requiredBoolean(input.deliveryAvailable, `${name}.deliveryAvailable`),
    refundable,
    nonRefundableConditions: optionalText(input.nonRefundableConditions, `${name}.nonRefundableConditions`, 1000),
    orderCutoff: optionalText(input.orderCutoff, `${name}.orderCutoff`, 100),
    detailUrl: optionalText(input.detailUrl, `${name}.detailUrl`, 1000),
    source
  };
}

function parseBudget(value: unknown): FoodSupportBudget {
  const input = record(value, 'budget');
  return {
    remainingKrw: requiredInteger(input.remainingKrw, 'budget.remainingKrw', 0, 1_000_000_000),
    maximumPurchaseKrw: requiredInteger(input.maximumPurchaseKrw, 'budget.maximumPurchaseKrw', 0, 1_000_000_000)
  };
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FoodSupportInputError(`Invalid ${name}`);
  return value as Record<string, unknown>;
}

function requiredIdentifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new FoodSupportInputError(`Invalid ${name}`);
  return value;
}

function requiredText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new FoodSupportInputError(`Invalid ${name}`);
  return value.trim();
}

function optionalText(value: unknown, name: string, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) throw new FoodSupportInputError(`Invalid ${name}`);
  return value.trim();
}

function requiredInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new FoodSupportInputError(`Invalid ${name}`);
  return value;
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new FoodSupportInputError(`Invalid ${name}`);
  return value;
}
