import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createClawOpsVoiceHandlers } from '../../src/voice/clawopsRoutes.ts';

function sign(key: string, url: string, params: Record<string, string>): string {
  const payload = url + Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}${v}`).join('');
  return createHmac('sha256', key).update(payload).digest('base64');
}

test('ClawOps incoming rejects forged webhook before capture', async () => {
  let captures = 0;
  const handlers = createClawOpsVoiceHandlers({
    signingKey: 'secret',
    baseUrl: 'https://demo.example',
    async capture() { captures += 1; throw new Error('not expected'); },
    async confirm() { throw new Error('not expected'); }
  });
  const response = await handlers.incoming({ signature: 'forged', params: {}, url: 'https://demo.example/clawops/voice/incoming' });
  assert.equal(response.status, 403);
  assert.equal(captures, 0);
});

test('ClawOps incoming returns Korean VoiceML with hash-key recording stop', async () => {
  const key = 'secret';
  const url = 'https://demo.example/clawops/voice/incoming';
  const params = { CallId: 'CA-1', Direction: 'inbound' };
  const handlers = createClawOpsVoiceHandlers({
    signingKey: key,
    baseUrl: 'https://demo.example',
    async capture() { throw new Error('not expected'); },
    async confirm() { throw new Error('not expected'); }
  });
  const response = await handlers.incoming({ signature: sign(key, url, params), params, url });
  assert.equal(response.status, 200);
  assert.match(response.body, /language="ko-KR"/);
  assert.match(response.body, /finishOnKey="#"/);
  assert.match(response.body, /\/clawops\/voice\/recorded/);
});
