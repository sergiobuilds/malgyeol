import test from 'node:test';
import assert from 'node:assert/strict';
import { VertexFoodTextInterpreter } from '../../src/food-support/vertexFoodTextInterpreter.ts';

test('Vertex food text interpreter sends schema-bound text and returns provenance', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const interpreter = new VertexFoodTextInterpreter({
    project: 'demo-project', location: 'us-central1', model: 'gemini-test',
    tokenProvider: async () => 'oauth-token',
    fetcher: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        responseId: 'response-1', modelVersion: 'gemini-test-001',
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          normalizedQuery: '납작보리쌀', requestedCategories: ['MIXED_GRAINS'], exactProductName: '납작보리쌀',
          quantity: 1, substitutionsAllowed: false, needsClarification: false, ambiguityReasons: [],
          safeUserSummary: '납작보리쌀 한 봉지 요청', confidence: 0.96
        }) }] } }]
      });
    }
  });
  const result = await interpreter.interpret('납작보리쌀 한 봉지 사줘');
  assert.equal(result.normalizedQuery, '납작보리쌀');
  assert.equal(result.exactProductName, '납작보리쌀');
  assert.equal(result.modelVersion, 'gemini-test-001');
  assert.equal(JSON.stringify(requestBody).includes('가격, 지원 자격, 예산, 정책 승인, 결제 허용 여부를 판정하지 않는다.'), true);
});

test('Vertex food text interpreter accepts zero quantity for discovery without inventing a purchase amount', async () => {
  const interpreter = new VertexFoodTextInterpreter({
    project: 'demo-project', location: 'us-central1', model: 'gemini-test',
    tokenProvider: async () => 'oauth-token',
    fetcher: async () => Response.json({
      responseId: 'response-discovery', modelVersion: 'gemini-test-001',
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        normalizedQuery: '살 수 있는 잡곡', requestedCategories: ['MIXED_GRAINS'], exactProductName: '',
        quantity: 0, substitutionsAllowed: true, needsClarification: false, ambiguityReasons: [],
        safeUserSummary: '지원 가능한 잡곡 문의', confidence: 0.9
      }) }] } }]
    })
  });
  const result = await interpreter.interpret('살 수 있는 잡곡이 뭐야');
  assert.equal(result.quantity, 0);
  assert.equal(result.exactProductName, undefined);
});

test('Vertex food text interpreter aborts a hung model call at the configured deadline', async () => {
  const interpreter = new VertexFoodTextInterpreter({
    project: 'demo-project', location: 'us-central1', model: 'gemini-test', timeoutMs: 1,
    tokenProvider: async () => 'oauth-token',
    fetcher: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      assert.ok(signal);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })
  });
  await assert.rejects(interpreter.interpret('잡곡 찾아줘'), error => error instanceof DOMException && error.name === 'TimeoutError');
});
