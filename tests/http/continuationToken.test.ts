import test from 'node:test';
import assert from 'node:assert/strict';
import { ContinuationTokenService } from '../../src/http/continuationToken.ts';

test('phone-to-web continuation binds caseId and expiry', () => {
  let now = 1_785_456_000_000;
  const tokens = new ContinuationTokenService('continuation-token-test-secret-long-enough', () => now);
  const issued = tokens.issue('case_phone_1', 60_000);
  assert.equal(tokens.verify('case_phone_1', issued.token), true);
  assert.equal(tokens.verify('case_phone_2', issued.token), false);
  assert.equal(tokens.verify('case_phone_1', `${issued.token.slice(0, -1)}0`), false);
  now = issued.expiresAt + 1;
  assert.equal(tokens.verify('case_phone_1', issued.token), false);
});
