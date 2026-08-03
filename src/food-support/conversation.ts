import { createHash, randomUUID } from 'node:crypto';
import type {
  ConversationSession,
  ConversationTurn,
  FoodIntent,
  FoodVoucherCategory,
  ProductQuery
} from './types.ts';

export interface ParsedFoodUtterance {
  intent: FoodIntent;
  query: ProductQuery;
  requestedCategories: FoodVoucherCategory[];
  needsClarification: boolean;
  clarificationCode?: ConversationTurn['clarificationCode'];
  response: string;
  mustNotExecutePurchase: boolean;
}

export function parseFoodUtterance(text: string): ParsedFoodUtterance {
  const normalized = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const query: ProductQuery = { text: normalized };
  if (!normalized) return result('UNKNOWN', query, [], true, 'MISSING_CONTEXT', '필요한 상품을 다시 말씀해 주세요.', true);
  if (/도움|상담|사람.*연결/.test(normalized)) return result('REQUEST_HELP', query, [], false, undefined, '도움을 요청할게요.', true);
  if (/잔액|얼마.*남|예산/.test(normalized)) return result('CHECK_BUDGET', query, [], false, undefined, '남은 지원금액을 확인할게요.', true);
  if (/언제\s*와|배송.*어디|배송.*조회/.test(normalized)) return result('TRACK_ORDER', query, [], false, undefined, '배송 상태를 확인할게요.', true);
  if (/취소해|주문\s*취소/.test(normalized)) return result('CANCEL_ORDER', query, [], false, undefined, '취소할 주문을 확인할게요.', true);
  if (/지난번|전에\s*산|재주문/.test(normalized)) return result('REORDER', query, [], false, undefined, '지난 주문을 확인한 뒤 같은 상품인지 다시 확인할게요.', true);
  if (/두\s*개|2\s*개|수량.*바꿔/.test(normalized)) return result('MODIFY_CART', { ...query, quantity: 2 }, [], false, undefined, '수량을 2개로 바꿀 상품을 확인할게요.', true);
  if (/쌀\s*(?:ㅇ|ᄋ)\s*라면|쌀(?:ㅇ|ᄋ)라면/.test(normalized)) return result('DISCOVER_PRODUCTS', query, [], true, 'MALFORMED_MULTI_ITEM', '쌀과 라면을 말씀하신 건지 다시 확인해 주세요.', true);

  const requestedCategories = classifyCategories(normalized);
  const highRisk = requestedCategories.find(category => HIGH_RISK_CATEGORIES.has(category));
  if (highRisk) {
    return result('PURCHASE', query, requestedCategories, false, undefined,
      '안전상 요청을 진행할 수 없어요. 결제나 주문은 시작되지 않았습니다.', true);
  }
  if (requestedCategories.length > 1) {
    return result('DISCOVER_PRODUCTS', query, requestedCategories, true, 'MALFORMED_MULTI_ITEM',
      '한 번에 하나씩 찾아드릴게요. 어느 먹거리부터 볼까요?', true);
  }
  if (/아무거나|알아서|추천|골라/.test(normalized)) {
    if (requestedCategories.length === 1) {
      return result('DISCOVER_PRODUCTS', { ...query, category: requestedCategories[0] }, requestedCategories, false, undefined,
        '주문 가능한 상품을 몇 개 찾아드릴게요.', true);
    }
    return categoryChoice(query, 'UNBOUNDED_SUBSTITUTION');
  }
  if (requestedCategories.length === 0 && /(?:뭐|무엇|어떤|먹을\s*거).*(?:살\s*수|되|있|추천)|살\s*수\s*있.*(?:뭐|무엇|어떤)/.test(normalized)) {
    return categoryChoice(query, 'CATEGORY_CHOICE');
  }
  if (/쌀/.test(normalized) && !/잡곡|흑미|현미|보리|찹쌀/.test(normalized)) {
    return result('DISCOVER_PRODUCTS', { ...query, text: '잡곡', category: 'MIXED_GRAINS' }, requestedCategories, true, 'AMBIGUOUS_RICE', '백미는 지원금으로 사실 수 없지만, 잡곡은 가능해요. 주문 가능한 잡곡을 찾아드릴게요.', true);
  }
  if (/제일\s*싼|가장\s*싼|비교/.test(normalized)) {
    if (requestedCategories.length === 0) return categoryChoice(query, 'CATEGORY_CHOICE');
    return result('COMPARE_PRODUCTS', { ...query, category: requestedCategories[0], sort: 'LOWEST_TOTAL_PRICE' }, requestedCategories, false, undefined, '배송비를 포함한 금액으로 비교할게요.', true);
  }
  if (/싼\s*거|싼\s*것/.test(normalized)) {
    if (requestedCategories.length === 0) return categoryChoice(query, 'CATEGORY_CHOICE');
    return result('COMPARE_PRODUCTS', { ...query, category: requestedCategories[0], sort: 'LOWEST_TOTAL_PRICE' }, requestedCategories, false, undefined, '배송비를 포함해 가격이 낮은 순으로 찾아보세요.', true);
  }
  if (/살\s*수\s*있|뭐야|보여|찾아/.test(normalized)) {
    return result('DISCOVER_PRODUCTS', query, requestedCategories, false, undefined, '지원 가능한 실제 상품을 찾아볼게요.', true);
  }
  if (/납작보리쌀/.test(normalized)) query.exactName = '납작보리쌀';
  const intent: FoodIntent = /사줘|보내줘|주문/.test(normalized) ? 'PURCHASE' : 'DISCOVER_PRODUCTS';
  if (requestedCategories.length === 1) query.category = requestedCategories[0];
  return result(intent, query, requestedCategories, false, undefined,
    intent === 'PURCHASE' ? '실제 상품과 총액을 찾은 뒤 주문 전에 다시 확인할게요.' : '실제 상품을 찾아볼게요.',
    intent !== 'PURCHASE');
}

function categoryChoice(
  query: ProductQuery,
  code: 'CATEGORY_CHOICE' | 'UNBOUNDED_SUBSTITUTION'
): ParsedFoodUtterance {
  return result(
    'DISCOVER_PRODUCTS', query, [], true, code,
    '잡곡, 국산 과일, 채소, 흰우유, 계란, 고기, 두부, 밤·잣·호두 중에서 고르실 수 있어요. 무엇부터 볼까요?',
    true
  );
}

const HIGH_RISK_CATEGORIES = new Set<FoodVoucherCategory>([
  'FIREARM', 'AMMUNITION', 'ILLEGAL_DRUG', 'TOBACCO', 'ALCOHOL', 'GIFT_CARD'
]);

export function appendConversationTurn(
  session: ConversationSession | undefined,
  input: { caseId: string; text: string; actor?: ConversationTurn['actor']; now?: number }
): { session: ConversationSession; parsed: ParsedFoodUtterance } {
  const now = input.now ?? Date.now();
  const parsed = parseFoodUtterance(input.text);
  const turn: ConversationTurn = {
    turnId: `turn_${randomUUID()}`,
    actor: input.actor ?? 'BENEFICIARY',
    intent: parsed.intent,
    query: { ...parsed.query, text: `sha256:${createHash('sha256').update(parsed.query.text).digest('hex')}` },
    createdAt: now,
    needsClarification: parsed.needsClarification,
    ...(parsed.clarificationCode ? { clarificationCode: parsed.clarificationCode } : {})
  };
  const value: ConversationSession = session
    ? { ...session, revision: session.revision + 1, turns: [...session.turns, turn], updatedAt: now }
    : { sessionId: `session_${randomUUID()}`, caseId: input.caseId, revision: 1, turns: [turn], createdAt: now, updatedAt: now };
  return { session: value, parsed };
}

function classifyCategories(text: string): FoodVoucherCategory[] {
  const patterns: ReadonlyArray<[FoodVoucherCategory, RegExp]> = [
    ['FIREARM', /총기|권총|소총|공기총|엽총/],
    ['AMMUNITION', /탄약|총알|실탄/],
    ['ILLEGAL_DRUG', /마약|필로폰|코카인|헤로인/],
    ['TOBACCO', /담배|전자담배/],
    ['ALCOHOL', /주류|소주|맥주|술\b/],
    ['GIFT_CARD', /상품권|기프트\s*카드/],
    ['INSTANT_NOODLES', /라면/],
    ['WHITE_RICE', /백미/],
    ['MIXED_GRAINS', /잡곡|흑미|현미|보리|찹쌀|납작보리쌀/],
    ['DOMESTIC_FRUIT', /과일|사과|배|복숭아|살구/],
    ['DOMESTIC_VEGETABLE', /채소|야채|양파|감자/],
    ['WHITE_MILK', /흰우유|우유/],
    ['FRESH_EGGS', /달걀|계란|유정란/],
    ['TOFU', /두부/],
    ['SEAFOOD', /수산물|생선|조개|오징어/],
    ['FOREST_NUTS', /밤|잣|호두/],
    ['MEAT', /고기|육류|소고기|돼지고기|닭고기/]
  ];
  return patterns.flatMap(([category, pattern]) => pattern.test(text) ? [category] : []);
}

function result(
  intent: FoodIntent,
  query: ProductQuery,
  requestedCategories: FoodVoucherCategory[],
  needsClarification: boolean,
  clarificationCode: ConversationTurn['clarificationCode'] | undefined,
  response: string,
  mustNotExecutePurchase: boolean
): ParsedFoodUtterance {
  return {
    intent,
    query,
    requestedCategories,
    needsClarification,
    ...(clarificationCode ? { clarificationCode } : {}),
    response,
    mustNotExecutePurchase
  };
}
