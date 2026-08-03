import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryCaseRepository } from '../../src/e2e/inMemoryCaseRepository.ts';

const baseCase = {
  caseId: 'case_test_001', callSidHash: 'a'.repeat(64), beneficiaryRef: 'P-2026-0031',
  programId: 'kr-disability-personal-budget-demo', planId: 'plan-stand-aid',
  state: 'CALL_CONNECTED' as const, createdAt: 1000, updatedAt: 1000
};

test('case repository appends ordered events and consumes confirmation once', async () => {
  const repo = new InMemoryCaseRepository();
  await repo.create(baseCase);
  await repo.transition(baseCase.caseId, 'CALL_CONNECTED', 'AUDIO_CAPTURED', {}, 1001);
  await repo.transition(baseCase.caseId, 'AUDIO_CAPTURED', 'AWAITING_CONFIRMATION', { confirmationExpiresAt: 2000 }, 1002);
  const first = await repo.consumeConfirmation(baseCase.caseId, 'confirm-1', 1003);
  const replay = await repo.consumeConfirmation(baseCase.caseId, 'confirm-1', 1004);

  assert.equal(first, true);
  assert.equal(replay, false);
  assert.deepEqual((await repo.events(baseCase.caseId)).map(event => event.sequence), [1, 2, 3, 4]);
  assert.equal((await repo.get(baseCase.caseId))?.state, 'CONFIRMED');
});

test('case repository atomically rejects an expired confirmation', async () => {
  const repo = new InMemoryCaseRepository();
  await repo.create({ ...baseCase, caseId: 'case_expired_001' });
  await repo.transition('case_expired_001', 'CALL_CONNECTED', 'AWAITING_CONFIRMATION', { confirmationExpiresAt: 1100 }, 1001);
  assert.equal(await repo.consumeConfirmation('case_expired_001', 'confirm-expired', 1101), false);
  assert.equal((await repo.get('case_expired_001'))?.state, 'AWAITING_CONFIRMATION');
});

test('case repository rejects stale transitions', async () => {
  const repo = new InMemoryCaseRepository();
  await repo.create(baseCase);
  await assert.rejects(
    repo.transition(baseCase.caseId, 'INTERPRETED', 'POLICY_CHECKING', {}, 1001),
    /state conflict/i
  );
});

test('case repository lists durable cases by latest update with a bounded limit', async () => {
  const repo = new InMemoryCaseRepository();
  await repo.create({ ...baseCase, caseId: 'case_older', updatedAt: 1000 });
  await repo.create({ ...baseCase, caseId: 'case_newer', createdAt: 2000, updatedAt: 2000 });
  await repo.create({ ...baseCase, caseId: 'case_middle', createdAt: 1500, updatedAt: 1500 });
  assert.deepEqual((await repo.list(2)).map(value => value.caseId), ['case_newer', 'case_middle']);
  assert.equal((await repo.list(10_000)).length, 3);
});
