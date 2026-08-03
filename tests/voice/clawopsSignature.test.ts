import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { verifyClawOpsSignature } from '../../src/voice/clawopsSignature.ts';

test('ClawOps signature binds URL and sorted form fields', () => {
  const key = 'test-signing-key';
  const url = 'https://demo.example/clawops/voice/incoming';
  const params = { To: '07052753884', Direction: 'inbound', CallId: 'CA-1' };
  const payload = `${url}CallIdCA-1DirectioninboundTo07052753884`;
  const signature = createHmac('sha256', key).update(payload).digest('base64');

  assert.equal(verifyClawOpsSignature(key, signature, url, params), true);
  assert.equal(verifyClawOpsSignature(key, signature, `${url}/changed`, params), false);
  assert.equal(verifyClawOpsSignature(key, signature, url, { ...params, CallId: 'CA-2' }), false);
});
