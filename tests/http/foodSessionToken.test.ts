import test from 'node:test';
import assert from 'node:assert/strict';
import { FoodSessionTokenService } from '../../src/http/foodSessionToken.ts';

test('food session token binds case, session and expiry', () => {
  let now = 1_000;
  const service = new FoodSessionTokenService('f'.repeat(32), () => now);
  const issued = service.issue('web_case_one', 'session_one', 1_000);
  assert.equal(service.verify('web_case_one', issued.token), true);
  assert.equal(service.verify('web_case_two', issued.token), false);
  assert.equal(service.verify('web_case_one', `${issued.token}0`), false);
  now = 2_001;
  assert.equal(service.verify('web_case_one', issued.token), false);
});
