import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDERS,
  createCloudRunProviderAdapter,
  createMerchantProviderAdapter,
  createSolanaDevnetProviderAdapter,
  createTwilioProviderAdapter,
  createVertexProviderAdapter,
  createX402ProviderAdapter,
  runProviderGate
} from '../../src/providers/providerContracts.ts';

const factories = [
  createTwilioProviderAdapter,
  createVertexProviderAdapter,
  createX402ProviderAdapter,
  createSolanaDevnetProviderAdapter,
  createMerchantProviderAdapter,
  createCloudRunProviderAdapter
] as const;

test('all provider blocker adapters emit the common schema from a nonzero subprocess', async () => {
  const adapters = factories.map(factory => factory(false));
  const results = await Promise.all(adapters.map(adapter => adapter.preflight('case_synthetic_u1', 'purchase')));
  assert.deepEqual(adapters.map(adapter => adapter.provider), PROVIDERS);
  for (const result of results) {
    assert.equal(result.status, 'BLOCKED');
    if (result.status !== 'BLOCKED') continue;
    assert.equal(result.blocker.code, 'BLOCKED_EXTERNAL_DEPENDENCY');
    assert.equal(result.blocker.caseId, 'case_synthetic_u1');
    assert.equal(result.blocker.operation, 'purchase');
    assert.notEqual(result.blocker.subprocess.exitCode, 0);
    assert.match(result.blocker.subprocess.stderrSha256, /^[a-f0-9]{64}$/);
  }
});

test('one blocked provider prevents every live side effect before execution starts', async () => {
  let calls = 0;
  const adapters = factories.map((factory, index) => factory(index !== 2));
  const sideEffects = Object.fromEntries(PROVIDERS.map(provider => [provider, async () => { calls += 1; return provider; }]));
  const result = await runProviderGate({
    caseId: 'case_synthetic_atomic',
    operation: 'purchase',
    adapters,
    sideEffects
  });
  assert.equal(result.status, 'BLOCKED_EXTERNAL_DEPENDENCY');
  assert.equal(result.sideEffectsStarted, 0);
  assert.equal(calls, 0);
  assert.deepEqual(result.blockers.map(value => value.provider), ['x402']);
});

test('live adapters execute each explicitly supplied operation once after all preflights pass', async () => {
  const adapters = factories.map(factory => factory(true));
  const calls = new Map<string, number>();
  const sideEffects = Object.fromEntries(PROVIDERS.map(provider => [provider, async () => {
    calls.set(provider, (calls.get(provider) ?? 0) + 1);
    return `${provider}-receipt`;
  }]));
  const result = await runProviderGate({
    caseId: 'case_synthetic_live',
    operation: 'purchase',
    adapters,
    sideEffects
  });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.sideEffectsStarted, PROVIDERS.length);
  assert.equal(result.blockers.length, 0);
  assert.deepEqual([...calls.values()], PROVIDERS.map(() => 1));
});
