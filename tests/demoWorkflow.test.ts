import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DemoWorkflowStore } from '../src/demo-workflow/store.ts';
import { DemoWorkflowService } from '../src/demo-workflow/service.ts';
import { createMockProvider, demoRequirements } from '../src/demo-workflow/mockProvider.ts';
import { demoRoutesForService } from '../src/demo-workflow/routes.ts';
import type { DemoProvider, InquiryOutcome, Requirements } from '../src/demo-workflow/types.ts';
const now = Date.parse('2026-09-18T01:00:00Z');
function setup(provider = createMockProvider('success', () => now), path = ':memory:') { const store = new DemoWorkflowStore(path); return { store, service: new DemoWorkflowService(store, provider, () => now, 100) }; }
function approve(service: DemoWorkflowService, callId = 'call1', requirements = demoRequirements(now)) { service.begin(callId, 'trusted-demo-citizen'); service.update(callId, requirements, '확인된 시연 요구'); const seed = service.prepareSeed(callId); service.approve(callId, seed.seedHash!, seed.nonce, '1'); return seed; }
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const turn = () => new Promise<void>(r => setImmediate(r));
test('multi-slot interview accumulates, seed approval is bound to exact call/hash/nonce/expiry', async () => {
 let clock = now; const store = new DemoWorkflowStore(); const provider = createMockProvider('success', () => clock); let inquiries = 0; const original = provider.inquire; provider.inquire = async (...args) => { inquiries++; return original(...args); };
 const service = new DemoWorkflowService(store, provider, () => clock);
 service.begin('call1', 'citizen1'); service.update('call1', { item: '식사', quantity: 1, region: '서울 서초구' }, '식사 한 개');
 assert.deepEqual(service.status('call1').requirements, { item: '식사', quantity: 1, region: '서울 서초구' });
 await assert.rejects(service.run('call1'), /APPROVAL/); assert.equal(inquiries, 0);
 service.update('call1', demoRequirements(now), '나머지 조건'); const old = service.prepareSeed('call1');
 service.begin('call2', 'citizen2'); assert.throws(() => service.approve('call2', old.seedHash!, old.nonce, '1'), /IDENTITY/);
 service.update('call1', { quantity: 2 }, '두 개로 수정'); assert.throws(() => service.approve('call1', old.seedHash!, old.nonce, '1'), /IDENTITY/);
 const next = service.prepareSeed('call1'); clock += 300_001; assert.throws(() => service.approve('call1', next.seedHash!, next.nonce, '1'), /EXPIRED/); assert.equal(inquiries, 0); store.close();
});
test('success journals all steps, stops unneeded inquiry and does exactly one receipt-bound submission', async () => {
 const provider = createMockProvider('success', () => now); let submissions = 0; const submit = provider.submit; provider.submit = async (...a) => { submissions++; return submit(...a); };
 const { service, store } = setup(provider); approve(service); await service.run('call1'); await service.run('call1');
 const c = store.read('call1')!; assert.equal(c.phase, 'READY'); assert.equal(submissions, 1); assert.equal(c.ev1?.pass, true); assert.equal(c.ev2?.pass, true);
 assert.deepEqual(c.events.filter(e => e.stage === 'Run1.started').map(e => (e.data as { task: { institutionId: string } }).task.institutionId), ['A', 'B']);
 const stages = c.events.map(e => e.stage); for (const stage of ['Seed.approved', 'Run1.response', 'Run2.plan', 'EV1', 'Run3.intent', 'Run3.receipt', 'Run4.recorded', 'EV2']) assert.ok(stages.includes(stage));
 assert.ok(stages.indexOf('EV1') < stages.indexOf('Run3.intent')); assert.ok(stages.indexOf('Run4.recorded') < stages.indexOf('EV2'));
 assert.doesNotMatch(c.callback!.message, /배송이 출발|오고 있습니다/); assert.match(c.callback!.message, /모의 지원 신청이 접수/); store.close();
});
test('parallel inquiries preserve higher priority despite fast alternative', async () => {
 const base = createMockProvider('success', () => now); const preferred = deferred<InquiryOutcome>(); let active = 0, peak = 0; const started: string[] = [];
 const provider: DemoProvider = { ...base, institutions: [{ id: 'B', name: '허구 B' }], inquire: async (task, seed) => {
  active++; peak = Math.max(peak, active); started.push(task.item);
  if (task.priority === 0) { const value = await preferred.promise; active--; return value; }
  active--; return { kind: 'available', proof: { mode: 'SIMULATION', ref: 'fixture://lower', observedAt: new Date(now).toISOString() }, terms: { item: task.item, quantity: 1, costKrw: 0, receivingMethod: 'delivery', dietaryRestrictions: [], promisedBy: seed.requirements.neededBy } };
 } };
 const { service, store } = setup(provider); const r = demoRequirements(now); r.alternatives = ['즉석밥']; approve(service, 'call1', r); const run = service.run('call1'); await turn(); assert.equal(peak, 2); assert.equal(store.read('call1')!.receipt, undefined);
 preferred.resolve({ kind: 'available', proof: { mode: 'SIMULATION', ref: 'fixture://top', observedAt: new Date(now).toISOString() }, terms: { item: r.item, quantity: 1, costKrw: 0, receivingMethod: 'delivery', dietaryRestrictions: [], promisedBy: r.neededBy } });
 await run; assert.equal(store.read('call1')!.plan?.terms.item, r.item); assert.equal(started.length, 2); store.close();
});
test('no answer is not unavailability; bad next proof is unverified; conditions outside seed never submit', async () => {
 for (const kind of ['no-answer', 'bad-proof', 'cost'] as const) {
  const base = createMockProvider('no-answer', () => now); let submissions = 0;
  const provider: DemoProvider = { ...base, inquire: async task => kind === 'no-answer' ? { kind: 'no-answer', retryAt: new Date(now + 60_000).toISOString() } : kind === 'bad-proof' ? ({ kind: 'unavailable', reason: 'none', next: { at: 'bad' } } as unknown as InquiryOutcome) : { kind: 'available', terms: { item: task.item, quantity: 1, costKrw: 100, receivingMethod: 'delivery', dietaryRestrictions: [], promisedBy: demoRequirements(now).neededBy }, proof: { mode: 'SIMULATION', ref: 'fixture://terms', observedAt: new Date(now).toISOString() } }, submit: async (...args) => { submissions++; return base.submit(...args); } };
  const { service, store } = setup(provider); approve(service); await service.run('call1'); const c = store.read('call1')!; assert.equal(submissions, 0); assert.equal(c.ev1?.pass, false);
  if (kind !== 'cost') assert.match(c.callback!.message, /불가로 판단하지/); store.close();
 }
});
test('EV2 rejects receipt mismatch and interrupted execution never resubmits after SQLite restart', async () => {
 const base = createMockProvider('success', () => now); const provider: DemoProvider = { ...base, submit: async (plan, key) => { const result = await base.submit(plan, key); if ('kind' in result) return result; return { ...result, planHash: 'wrong' }; } };
 const { service, store } = setup(provider); approve(service); await service.run('call1'); assert.equal(store.read('call1')!.phase, 'UNKNOWN'); assert.equal(store.read('call1')!.ev2?.pass, false); assert.throws(() => service.claimCallback('call1'), /NOT_READY/); store.close();
 const dir = mkdtempSync(join(tmpdir(), 'demo-workflow-')); const path = join(dir, 'db.sqlite');
 try {
  const a = setup(undefined, path); approve(a.service); a.store.update('call1', c => { c!.phase = 'RUNNING'; c!.runId = 'interrupted'; return { next: c!, result: undefined }; }); a.store.close();
  let submitted = false; const p = createMockProvider('success', () => now); p.submit = async () => { submitted = true; throw new Error('must not submit'); }; const b = setup(p, path);
  assert.equal(b.service.recoverInterruptedRuns(), 1); assert.equal((await b.service.run('call1')).phase, 'UNKNOWN'); assert.equal(submitted, false); assert.ok(b.store.read('call1')!.events.some(e => e.stage === 'Run.recovery')); b.store.close();
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('unavailable callback proposes verified next time, schedules only actual digit1 and confirms transport separately', async () => {
 const { service, store } = setup(createMockProvider('unavailable', () => now)); approve(service); await service.run('call1'); assert.equal(store.read('call1')!.reservation, undefined);
 const claimed = service.claimCallback('call1'); assert.ok(claimed.job); assert.ok(claimed.job.nextOpportunity); assert.match(claimed.job.message, /다음 접수/); assert.equal(service.claimCallback('call1').job, null);
 service.answerCallback('call1', claimed.job.id, '1'); assert.equal(store.read('call1')!.reservation?.status, 'SCHEDULED');
 assert.equal(service.completeCallback('call1', claimed.job.id, { answered: true, acknowledged: true, completed: true, receiptRef: 'fake-transport://receipt' }).delivered, true); store.close();
});
test('HTTP authorization, multi-field update and DTMF approval contract', async () => {
 const { service, store } = setup(); const secret = 's'.repeat(32); const handler = demoRoutesForService(service, secret);
 const post = (action: string, body: Record<string, unknown>) => handler('POST', new URL(`http://localhost/internal/demo-workflow/${action}`), `Bearer ${secret}`, body);
 assert.equal((await handler('POST', new URL('http://localhost/internal/demo-workflow/begin'), '', { callId: 'call1', citizenRef: 'c' }))?.status, 403);
 await post('begin', { callId: 'call1', citizenRef: 'c' }); await post('interview', { callId: 'call1', patch: demoRequirements(now), evidenceQuote: '시연 요구 확인' });
 const response = await post('seed', { callId: 'call1' }); const c = response?.body as { nonce: string; seedHash: string; readback: string };
 assert.match(c.readback, /식이 제한/); const yes = await post('approve', { callId: 'call1', nonce: c.nonce, seedHash: c.seedHash, digit: '1' }); assert.equal((yes?.body as { approved: boolean }).approved, true); store.close();
});
test('expired next opportunity is not offered as future reservation; pickup result states pickup', async () => {
 const base = createMockProvider('unavailable', () => now);
 const expired: DemoProvider = { ...base, inquire: async () => ({ kind: 'unavailable', reason: '모의 소진', proof: { mode: 'SIMULATION', ref: 'fixture://no', observedAt: new Date(now).toISOString() }, next: { at: new Date(now - 1000).toISOString(), timezone: 'Asia/Seoul', instructions: 'expired instructions', proof: { mode: 'SIMULATION', ref: 'fixture://expired', observedAt: new Date(now).toISOString() } } }) };
 const a = setup(expired); approve(a.service); await a.service.run('call1'); const job = a.service.claimCallback('call1').job!;
 assert.equal(job.nextOpportunity, undefined); assert.doesNotMatch(job.message, /expired instructions|다음 접수는/); assert.match(job.message, /예약 시각은 정하지/); a.store.close();
 const b = setup(); const r = demoRequirements(now); r.receivingMethod = 'pickup'; approve(b.service, 'call1', r); await b.service.run('call1'); assert.match(b.store.read('call1')!.callback!.message, /방문 수령 예정/); b.store.close();
});
