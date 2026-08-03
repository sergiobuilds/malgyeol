import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceHandlers } from '../../src/voice/twilioRoutes.ts';
import { computeTwilioSignature } from '../../src/voice/twilioSignature.ts';

const authToken = 'twilio-test-secret';
const baseUrl = 'https://demo.example';

test('voice incoming rejects a forged webhook before creating a case', async () => {
  let calls = 0;
  const handlers = createVoiceHandlers({ authToken, baseUrl, capture: async () => { calls += 1; throw new Error('not called'); }, confirm: async () => { throw new Error('not called'); } });
  const response = await handlers.incoming({ signature: 'forged', params: { CallSid: 'CA1' } });
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test('voice incoming returns authenticated recording TwiML', async () => {
  const handlers = createVoiceHandlers({ authToken, baseUrl, capture: async () => { throw new Error('not called'); }, confirm: async () => { throw new Error('not called'); } });
  const url = `${baseUrl}/voice/incoming`;
  const params = { CallSid: 'CA1' };
  const signature = computeTwilioSignature(authToken, url, params);
  const response = await handlers.incoming({ signature, params });
  assert.equal(response.status, 200);
  assert.match(response.body, /voice\/recorded/);
});
