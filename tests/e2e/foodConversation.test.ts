import test from 'node:test';
import assert from 'node:assert/strict';
import { appendConversationTurn, parseFoodUtterance } from '../../src/food-support/conversation.ts';

test('Korean food utterances separate discovery, purchase and operational intents', () => {
  const cases = [
    ['살 수 있는 쌀이 뭐야', 'DISCOVER_PRODUCTS', true],
    ['제일 싼 잡곡으로', 'COMPARE_PRODUCTS', true],
    ['지난번에 산 걸로', 'REORDER', true],
    ['두 개 보내줘', 'MODIFY_CART', true],
    ['언제 와', 'TRACK_ORDER', true],
    ['취소해줘', 'CANCEL_ORDER', true],
    ['잡곡 보내줘', 'PURCHASE', false]
  ] as const;
  for (const [utterance, intent, mustNotExecutePurchase] of cases) {
    const result = parseFoodUtterance(utterance);
    assert.equal(result.intent, intent, utterance);
    assert.equal(result.mustNotExecutePurchase, mustNotExecutePurchase, utterance);
  }
});

test('ambiguous requests get a useful next choice instead of a refusal', () => {
  const rice = parseFoodUtterance('쌀 사줘');
  assert.equal(rice.intent, 'DISCOVER_PRODUCTS');
  assert.equal(rice.clarificationCode, 'AMBIGUOUS_RICE');
  assert.equal(rice.query.category, 'MIXED_GRAINS');
  assert.equal(rice.query.text, '잡곡');
  assert.equal(rice.mustNotExecutePurchase, true);

  const malformed = parseFoodUtterance('쌀 ㅇ라면 보내줘');
  assert.equal(malformed.clarificationCode, 'MALFORMED_MULTI_ITEM');
  assert.equal(malformed.mustNotExecutePurchase, true);

  const any = parseFoodUtterance('아무거나 보내줘');
  assert.equal(any.clarificationCode, 'UNBOUNDED_SUBSTITUTION');
  assert.equal(any.mustNotExecutePurchase, true);
  assert.match(any.response, /잡곡.*국산 과일.*무엇부터/);

  const recommendation = parseFoodUtterance('과일 아무거나 추천해 줘');
  assert.equal(recommendation.needsClarification, false);
  assert.equal(recommendation.query.category, 'DOMESTIC_FRUIT');

  const available = parseFoodUtterance('내가 뭐를 살 수 있어?');
  assert.equal(available.clarificationCode, 'CATEGORY_CHOICE');
  assert.match(available.response, /계란.*두부/);
});

test('exact flat barley request is represented as a query and never a fabricated product', () => {
  const result = parseFoodUtterance('납작보리쌀 사줘');
  assert.equal(result.intent, 'PURCHASE');
  assert.equal(result.query.exactName, '납작보리쌀');
  assert.deepEqual(result.requestedCategories, ['MIXED_GRAINS']);
  assert.equal('product' in result, false);
});

test('multi-item language asks which item to handle first and firearm language remains blocked', () => {
  const multi = parseFoodUtterance('잡곡이랑 라면 보내줘');
  assert.equal(multi.intent, 'DISCOVER_PRODUCTS');
  assert.deepEqual(multi.requestedCategories, ['INSTANT_NOODLES', 'MIXED_GRAINS']);
  assert.match(multi.response, /어느 먹거리부터/);
  const firearm = parseFoodUtterance('총기 사줘');
  assert.deepEqual(firearm.requestedCategories, ['FIREARM']);
});

test('high-risk purchase language is non-executable before catalog or policy work', () => {
  for (const text of ['총기 구입해줘', '탄약 주문해', '담배 사줘', '소주 보내줘', '상품권 사줘']) {
    const parsed = parseFoodUtterance(text);
    assert.equal(parsed.intent, 'PURCHASE');
    assert.equal(parsed.mustNotExecutePurchase, true);
    assert.match(parsed.response, /결제나 주문은 시작되지 않았습니다/);
  }
});

test('everyday recommendation wording stays helpful while preserving the purchase boundary', () => {
  const cases = [
    ['뭐 살 수 있어', 'CATEGORY_CHOICE'],
    ['먹을 거 뭐 있어', 'CATEGORY_CHOICE'],
    ['아무거나 추천해 줘', 'UNBOUNDED_SUBSTITUTION'],
    ['싼 거 보여줘', 'CATEGORY_CHOICE']
  ] as const;
  for (const [utterance, code] of cases) {
    const parsed = parseFoodUtterance(utterance);
    assert.equal(parsed.clarificationCode, code, utterance);
    assert.match(parsed.response, /무엇부터 볼까요/);
    assert.equal(parsed.mustNotExecutePurchase, true);
  }
  for (const utterance of ['과일 추천해 줘', '계란 아무거나 보여줘', '제일 싼 두부 찾아줘']) {
    const parsed = parseFoodUtterance(utterance);
    assert.equal(parsed.needsClarification, false, utterance);
    assert.ok(parsed.query.category, utterance);
  }
});

test('conversation session retains one caseId across turns without storing phone number', () => {
  const first = appendConversationTurn(undefined, { caseId: 'case_food_session', text: '잡곡 찾아줘', now: 100 });
  const second = appendConversationTurn(first.session, { caseId: 'case_food_session', text: '제일 싼 걸로', now: 200 });
  assert.equal(second.session.caseId, 'case_food_session');
  assert.equal(second.session.sessionId, first.session.sessionId);
  assert.equal(second.session.turns.length, 2);
  assert.equal(JSON.stringify(second.session).includes('phone'), false);
  assert.equal(JSON.stringify(second.session).includes('잡곡 찾아줘'), false);
  assert.match(second.session.turns[0]!.query.text, /^sha256:[a-f0-9]{64}$/);
});
