import test from 'node:test';
import assert from 'node:assert/strict';
import { VertexAudioInterpreter } from '../../src/voice/vertexAudioInterpreter.ts';

test('Vertex audio interpreter sends inline audio and parses schema-bound purchase proposal', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const interpreter = new VertexAudioInterpreter({
    project: 'demo-project', location: 'us-central1', model: 'gemini-2.5-flash',
    tokenProvider: async () => 'token',
    fetcher: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        responseId: 'vertex-response-1', modelVersion: 'gemini-2.5-flash-001',
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          requestedCategory: 'ASSISTIVE_EQUIPMENT', requestedSku: 'ASSISTIVE_STAND_AID_01',
          quantity: 1, substitutionsAllowed: false, referencesApprovedPlan: true,
          confidence: 0.97, ambiguityReasons: [], safeUserSummary: '승인된 기립 보조기 한 개를 요청했습니다.'
        }) }] } }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const result = await interpreter.analyzeAudio(Buffer.from('audio'), 'audio/mpeg');
  assert.equal(result.requestedSku, 'ASSISTIVE_STAND_AID_01');
  assert.equal(result.responseId, 'vertex-response-1');
  assert.match(JSON.stringify(requestBody), /inlineData/);
  assert.equal(JSON.stringify(requestBody).includes('P-2026-0031'), false);
});

test('Vertex audio interpreter aborts a hung model call at the configured deadline', async () => {
  const interpreter = new VertexAudioInterpreter({
    project: 'demo-project', location: 'us-central1', model: 'gemini-test', timeoutMs: 1,
    tokenProvider: async () => 'oauth-token',
    fetcher: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      assert.ok(signal);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })
  });
  await assert.rejects(interpreter.analyzeAudio(Buffer.from('audio'), 'audio/mpeg'), error => error instanceof DOMException && error.name === 'TimeoutError');
});
