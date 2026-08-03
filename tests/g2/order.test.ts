import test from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { OrderService } from '../../src/g2/orderService.ts';
import { ALLOWED_DEMO_SKU } from '../../src/g2/validator.ts';
import type { GeminiInterpreter, IntentAnalysis } from '../../src/g2/types.ts';

const AUDIO = new Uint8Array([82, 73, 70, 70]);

class MockClock {
  public currentTime = 10000000;
  now() { return this.currentTime; }
}

class MockNonceGen {
  public nextNonce = 'test-nonce-123';
  generate() { return this.nextNonce; }
}

class MockInterpreter implements GeminiInterpreter {
  public nextIntent!: Partial<IntentAnalysis>;
  async analyzeAudio(_bytes: Uint8Array, _mime: string) {
    return this.nextIntent as IntentAnalysis;
  }
}

test('OrderService - clear Korean meal order success and explicit confirmation', async () => {
  const clock = new MockClock();
  const nonceGen = new MockNonceGen();
  const interpreter = new MockInterpreter();
  const service = new OrderService(interpreter, clock, nonceGen);

  interpreter.nextIntent = {
    sku: ALLOWED_DEMO_SKU,
    quantity: 1,
    substitutionsAllowed: false,
    confidence: 0.95,
    ambiguityReasons: [],
    readbackSentence: '도시락 1개 주문이 맞으신가요?'
  };

  const result = await service.processAudio(AUDIO, 'audio/webm');
  assert.strictEqual(result.status, 'AWAITING_CONFIRMATION');
  assert.strictEqual(result.challenge, 'test-nonce-123');
  assert.strictEqual(result.readbackSentence, '도시락 1개 주문이 맞으신가요?');

  const confirmResult = service.confirmOrder('test-nonce-123', true);
  assert.strictEqual(confirmResult.status, 'COMMITTED');
  assert.ok(confirmResult.commitmentHash);
  assert.strictEqual(confirmResult.commitmentHash.length, 64); // SHA-256 hex length
  assert.strictEqual(confirmResult.commitmentVersion, 'benefit-consent-v1');
});

test('OrderService - ambiguous substitute fails closed into NEEDS_CLARIFICATION', async () => {
  const clock = new MockClock();
  const nonceGen = new MockNonceGen();
  const interpreter = new MockInterpreter();
  const service = new OrderService(interpreter, clock, nonceGen);

  interpreter.nextIntent = {
    sku: ALLOWED_DEMO_SKU,
    quantity: 1,
    substitutionsAllowed: true,
    confidence: 0.75,
    ambiguityReasons: ['Audio muffled, substitute intent unclear'],
    readbackSentence: '대체 상품을 원하시는지 다시 말씀해주세요.'
  };

  const result = await service.processAudio(AUDIO, 'audio/webm');
  assert.strictEqual(result.status, 'NEEDS_CLARIFICATION');
  assert.ok(result.reasons?.includes('Confidence too low'));
});

test('OrderService - forbidden SKU results in BLOCKED', async () => {
  const clock = new MockClock();
  const nonceGen = new MockNonceGen();
  const interpreter = new MockInterpreter();
  const service = new OrderService(interpreter, clock, nonceGen);

  interpreter.nextIntent = {
    sku: 'ALCOHOL_01',
    quantity: 1,
    substitutionsAllowed: false,
    confidence: 0.99,
    ambiguityReasons: [],
    readbackSentence: '술 1개 주문이 맞으신가요?'
  };

  const result = await service.processAudio(AUDIO, 'audio/webm');
  assert.strictEqual(result.status, 'BLOCKED');
  assert.ok(result.reasons?.some(r => r.includes('not approved')));
});

test('OrderService - rejection becomes BLOCKED', async () => {
  const clock = new MockClock();
  const nonceGen = new MockNonceGen();
  const interpreter = new MockInterpreter();
  const service = new OrderService(interpreter, clock, nonceGen);

  interpreter.nextIntent = {
    sku: ALLOWED_DEMO_SKU,
    quantity: 1,
    substitutionsAllowed: false,
    confidence: 0.95,
    ambiguityReasons: [],
    readbackSentence: '도시락 1개 주문이 맞으신가요?'
  };

  await service.processAudio(AUDIO, 'audio/webm');
  const confirmResult = service.confirmOrder('test-nonce-123', false);

  assert.strictEqual(confirmResult.status, 'BLOCKED');
  assert.strictEqual(confirmResult.commitmentHash, undefined);
});

test('OrderService - expired challenge becomes BLOCKED', async () => {
  const clock = new MockClock();
  const nonceGen = new MockNonceGen();
  const interpreter = new MockInterpreter();
  const service = new OrderService(interpreter, clock, nonceGen);

  interpreter.nextIntent = {
    sku: ALLOWED_DEMO_SKU, quantity: 1, substitutionsAllowed: false,
    confidence: 0.95, ambiguityReasons: [], readbackSentence: '주문 확인'
  };

  await service.processAudio(AUDIO, 'audio/webm');

  clock.currentTime += 60001; // Advance past 60s TTL

  const confirmResult = service.confirmOrder('test-nonce-123', true);
  assert.strictEqual(confirmResult.status, 'BLOCKED');
});

test('OrderService - Sensitive field absence in commitment payload generation', async () => {
  const clock = new MockClock();
  const nonceGen = new MockNonceGen();
  const interpreter = new MockInterpreter();
  const service = new OrderService(interpreter, clock, nonceGen);

  // Even if an attacker tried to inject private data into the intent,
  // the validation and payload generation code strictly plucks only sku and quantity.
  interpreter.nextIntent = {
    sku: ALLOWED_DEMO_SKU,
    quantity: 1,
    substitutionsAllowed: false,
    confidence: 0.95,
    ambiguityReasons: [],
    readbackSentence: '주문',
    // @ts-ignore - Simulating rogue property from underlying parser layer
    name: 'John Doe',
    phone: '010-1234-5678'
  };

  await service.processAudio(AUDIO, 'audio/webm');
  const confirmResult = service.confirmOrder('test-nonce-123', true);

  const expectedPayload = JSON.stringify({
    version: 'benefit-consent-v1',
    challenge: 'test-nonce-123',
    sku: ALLOWED_DEMO_SKU,
    quantity: 1,
    substitutionsAllowed: false,
    expiresAt: 10060000
  });
  const expectedHash = createHash('sha256').update(expectedPayload, 'utf8').digest('hex');

  assert.strictEqual(confirmResult.commitmentHash, expectedHash);
});

test('OrderService - empty audio fails closed before Gemini is called', async () => {
  const clock = new MockClock();
  const nonceGen = new MockNonceGen();
  const interpreter = new MockInterpreter();
  const service = new OrderService(interpreter, clock, nonceGen);

  const result = await service.processAudio(new Uint8Array(), 'audio/webm');
  assert.strictEqual(result.status, 'NEEDS_CLARIFICATION');
  assert.deepStrictEqual(result.reasons, ['Audio is empty']);
});

test('OrderService - Gemini failure fails closed', async () => {
  const clock = new MockClock();
  const nonceGen = new MockNonceGen();
  const interpreter: GeminiInterpreter = {
    async analyzeAudio() { throw new Error('provider unavailable'); }
  };
  const service = new OrderService(interpreter, clock, nonceGen);

  const result = await service.processAudio(AUDIO, 'audio/wav');
  assert.strictEqual(result.status, 'NEEDS_CLARIFICATION');
  assert.deepStrictEqual(result.reasons, ['Gemini interpretation failed']);
});
