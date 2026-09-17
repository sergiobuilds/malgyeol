import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryCareRequestRepository } from '../../src/care-support/repository.ts';
import { CareRequestService } from '../../src/care-support/service.ts';
import { CareProviderDispatcher, SandboxCareProvider } from '../../src/care-support/provider.ts';

const input = { beneficiaryRef: 'demo-senior-01', serviceCode: 'FOOD_PACKAGE' as const, itemCode: 'RICE_4KG', quantity: 1, preferredDate: '2026-09-18', confirmed: true };

test('sandbox sends a confirmed case once and preserves matching readback', async () => {
  const repo = new InMemoryCareRequestRepository();
  const service = new CareRequestService(repo);
  const request = await service.create(input);
  const adapter = new SandboxCareProvider(request.providerName);
  const dispatcher = new CareProviderDispatcher(repo, adapter);
  let sends = 0;
  const submit = adapter.submit.bind(adapter);
  adapter.submit = async (...args) => { sends++; return submit(...args); };
  await Promise.all(Array.from({ length: 10 }, () => dispatcher.submit(request.caseId)));
  assert.equal(sends, 1);
  assert.equal((await dispatcher.readback(request.caseId)).status, 'PROVIDER_ACCEPTED');
  assert.equal((await repo.get(request.caseId))?.providerRequestId, `sandbox:${request.caseId}`);
  assert.equal((await repo.events(request.caseId)).filter(e => e.type === 'PROVIDER_SUBMITTED').length, 1);
});

test('timeout after remote acceptance is never resent and recovers through readback', async () => {
  const repo = new InMemoryCareRequestRepository();
  const request = await new CareRequestService(repo).create(input);
  const adapter = new SandboxCareProvider(request.providerName);
  const submit = adapter.submit.bind(adapter);
  let sends = 0;
  adapter.submit = async (...args) => { sends++; await submit(...args); throw new Error('timeout'); };
  const dispatcher = new CareProviderDispatcher(repo, adapter);
  assert.equal((await dispatcher.submit(request.caseId)).dispatch, 'UNKNOWN');
  await dispatcher.submit(request.caseId);
  assert.equal(sends, 1);
  assert.equal((await dispatcher.readback(request.caseId)).status, 'PROVIDER_ACCEPTED');
});

test('unapproved provider cannot receive a case', async () => {
  const repo = new InMemoryCareRequestRepository();
  const request = await new CareRequestService(repo).create(input);
  await assert.rejects(new CareProviderDispatcher(repo, new SandboxCareProvider('unapproved')).submit(request.caseId), /승인된/);
});

test('never-resolving provider times out without retry', async () => {
  const repo = new InMemoryCareRequestRepository();
  const request = await new CareRequestService(repo).create(input);
  const adapter = new SandboxCareProvider(request.providerName);
  let sends = 0;
  adapter.submit = () => { sends++; return new Promise(() => {}); };
  const dispatcher = new CareProviderDispatcher(repo, adapter, Date.now, 10);
  assert.equal((await dispatcher.submit(request.caseId)).dispatch, 'UNKNOWN');
  await dispatcher.submit(request.caseId);
  assert.equal(sends, 1);
});

test('late successful response preserves operator exception', async () => {
  const repo = new InMemoryCareRequestRepository();
  const service = new CareRequestService(repo);
  const request = await service.create(input);
  const adapter = new SandboxCareProvider(request.providerName);
  const submit = adapter.submit.bind(adapter);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  adapter.submit = async (...args) => { await wait; return submit(...args); };
  const pending = new CareProviderDispatcher(repo, adapter).submit(request.caseId);
  await service.act(request.caseId, 'RAISE_EXCEPTION', 'PROVIDER_RESULT_UNKNOWN', 'OPERATOR');
  release();
  const result = await pending;
  assert.equal(result.status, 'EXCEPTION');
  assert.equal(result.exceptionOrigin, 'OPERATOR');
});

test('provided readback advances once and never regresses recipient confirmation', async () => {
  const repo = new InMemoryCareRequestRepository();
  const service = new CareRequestService(repo);
  const request = await service.create(input);
  const adapter = new SandboxCareProvider(request.providerName);
  const dispatcher = new CareProviderDispatcher(repo, adapter);
  await dispatcher.submit(request.caseId);
  const original = adapter.readback.bind(adapter);
  adapter.readback = async id => { const value = await original(id); return value ? { ...value, status: 'PROVIDED' } : undefined; };
  assert.equal((await dispatcher.readback(request.caseId)).status, 'PROVIDED');
  await service.act(request.caseId, 'CONFIRM_RECEIPT', undefined, 'RECIPIENT');
  assert.equal((await dispatcher.readback(request.caseId)).status, 'RECIPIENT_CONFIRMED');
  assert.equal((await repo.events(request.caseId)).filter(e => e.type === 'PROVIDED').length, 1);
});
