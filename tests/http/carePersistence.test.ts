import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteCareRequestRepository } from '../../src/care-support/sqliteRepository.ts';
import { CareRequestService } from '../../src/care-support/service.ts';
import { CarePhoneCoordinator } from '../../src/care-support/phone.ts';
import { CareProviderDispatcher, SandboxCareProvider } from '../../src/care-support/provider.ts';

const input = { beneficiaryRef: 'demo-senior-01', serviceCode: 'FOOD_PACKAGE' as const, itemCode: 'RICE_4KG', quantity: 1, preferredDate: '2026-09-18', confirmed: true };

test('two connections enforce cumulative plan quantity and idempotency atomically', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'care-ledger-'));
  const a = new SqliteCareRequestRepository(join(dir, 'ledger.sqlite'));
  const b = new SqliteCareRequestRepository(join(dir, 'ledger.sqlite'));
  t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true }); });
  const services = [new CareRequestService(a), new CareRequestService(b)];
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => services[i % 2]!.create({ ...input, idempotencyKey: `req-${i}` })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
  assert.equal((await a.list()).length, 2);
  const replay = await services[0]!.create({ ...input, idempotencyKey: 'req-0' });
  assert.equal((await b.list()).length, 2);
  await assert.rejects(services[0]!.create({ ...input, quantity: 2, idempotencyKey: 'req-0' }), /내용이 다릅니다/);
  assert.equal((await b.events(replay.caseId)).length, 2);
});

test('pending call and confirmed case survive restart with no repeat request or send', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'care-restart-'));
  const path = join(dir, 'ledger.sqlite');
  let repo = new SqliteCareRequestRepository(path);
  let phone = new CarePhoneCoordinator(new CareRequestService(repo));
  phone.begin('restart-call');
  const pending = phone.select('restart-call', '쌀');
  repo.close();
  repo = new SqliteCareRequestRepository(path);
  phone = new CarePhoneCoordinator(new CareRequestService(repo));
  const confirmed = await phone.confirm('restart-call', pending.token!, '1');
  assert.equal(confirmed.caseId, pending.caseId);
  const adapter = new SandboxCareProvider('찾아가는 푸드마켓');
  let sends = 0;
  adapter.submit = async () => { sends++; throw new Error('timeout'); };
  await new CareProviderDispatcher(repo, adapter).submit(confirmed.caseId!);
  repo.close();
  repo = new SqliteCareRequestRepository(path);
  t.after(() => { repo.close(); rmSync(dir, { recursive: true }); });
  phone = new CarePhoneCoordinator(new CareRequestService(repo));
  await phone.confirm('restart-call', pending.token!, '1');
  await new CareProviderDispatcher(repo, adapter).submit(confirmed.caseId!);
  assert.equal((await repo.list()).length, 1);
  assert.equal(sends, 1);
  assert.equal((await repo.get(confirmed.caseId!))?.dispatch, 'UNKNOWN');
});

test('roles reject wrong transitions and calendar dates are validated', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'care-roles-'));
  const repo = new SqliteCareRequestRepository(join(dir, 'ledger.sqlite'));
  t.after(() => { repo.close(); rmSync(dir, { recursive: true }); });
  const service = new CareRequestService(repo);
  await assert.rejects(service.create({ ...input, preferredDate: '2026-02-31' }), /희망일/);
  await assert.rejects(service.create({ ...input, confirmed: false }), /확인/);
  const request = await service.create(input);
  await assert.rejects(service.act(request.caseId, 'MARK_PROVIDED', undefined, 'RECIPIENT'), /권한/);
  await assert.rejects(service.act(request.caseId, 'CONFIRM_RECEIPT', undefined, 'PROVIDER'), /권한/);
  await service.act(request.caseId, 'PROVIDER_ACCEPT', undefined, 'PROVIDER');
  await service.act(request.caseId, 'MARK_PROVIDED', undefined, 'PROVIDER');
  await service.act(request.caseId, 'CONFIRM_RECEIPT', undefined, 'RECIPIENT');
  assert.equal((await service.get(request.caseId))?.status, 'RECIPIENT_CONFIRMED');
});
