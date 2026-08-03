import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryFoodBudgetLedger } from '../../src/food-support/budgetLedger.ts';

const scope = { beneficiaryRef: 'beneficiary-1', programId: 'program-2026', periodKey: '2026-08' };

test('beneficiary program-period ledger reserves across cases and commits exactly once', async () => {
  const ledger = new InMemoryFoodBudgetLedger();
  const fingerprintA = 'a'.repeat(64);
  const fingerprintB = 'b'.repeat(64);
  const first = await ledger.reserve({ caseId: 'case_a', scope, allocationKrw: 100_000, amountKrw: 70_000, fingerprint: fingerprintA, now: 1 });
  assert.equal(first.status, 'RESERVED');
  const replay = await ledger.reserve({ caseId: 'case_a', scope, allocationKrw: 100_000, amountKrw: 70_000, fingerprint: fingerprintA, now: 2 });
  assert.equal(replay.status, 'EXISTING');
  const insufficient = await ledger.reserve({ caseId: 'case_b', scope, allocationKrw: 100_000, amountKrw: 40_000, fingerprint: fingerprintB, now: 3 });
  assert.deepEqual(insufficient, { status: 'INSUFFICIENT', availableKrw: 30_000 });
  assert.equal((await ledger.commit('case_a', fingerprintA, 4)).status, 'COMMITTED');
  assert.equal((await ledger.commit('case_a', fingerprintA, 5)).status, 'COMMITTED');
  const stillInsufficient = await ledger.reserve({ caseId: 'case_b', scope, allocationKrw: 100_000, amountKrw: 40_000, fingerprint: fingerprintB, now: 6 });
  assert.equal(stillInsufficient.status, 'INSUFFICIENT');
});

test('caseId cannot control another scope or changed terms and release restores availability', async () => {
  const ledger = new InMemoryFoodBudgetLedger();
  const fingerprint = 'c'.repeat(64);
  await ledger.reserve({ caseId: 'case_one', scope, allocationKrw: 50_000, amountKrw: 30_000, fingerprint, now: 1 });
  const changed = await ledger.reserve({ caseId: 'case_one', scope, allocationKrw: 50_000, amountKrw: 20_000, fingerprint: 'd'.repeat(64), now: 2 });
  assert.equal(changed.status, 'CONFLICT');
  assert.equal((await ledger.release('case_one', fingerprint, 3)).status, 'RELEASED');
  const second = await ledger.reserve({ caseId: 'case_two', scope, allocationKrw: 50_000, amountKrw: 50_000, fingerprint: 'e'.repeat(64), now: 4 });
  assert.equal(second.status, 'RESERVED');
});
