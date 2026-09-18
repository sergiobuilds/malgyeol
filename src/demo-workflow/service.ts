import { randomUUID } from 'node:crypto';
import { DemoWorkflowStore } from './store.ts';
import { evaluate, hash, missing, patchValid, readback, spokenTime, text, validNext, validOutcome, shortReadback } from './contracts.ts';
import type { DemoCase, DemoProvider, InquiryOutcome, InquiryTask, Plan, Requirements, Seed, ExperienceMode } from './types.ts';
export class DemoError extends Error { constructor(message: string, readonly status = 409) { super(message); } }
function requireThat(value: unknown, message: string): asserts value { if (!value) throw new DemoError(message); }
export class DemoWorkflowService {
  constructor(readonly store: DemoWorkflowStore, readonly provider: DemoProvider, readonly now: () => number = Date.now, readonly inquiryTimeoutMs = 3000, readonly concurrency = 2) {
    requireThat(provider.mode === 'SIMULATION', 'MOCK_PROVIDER_REQUIRED'); requireThat(Number.isInteger(concurrency) && concurrency > 0 && concurrency <= 8, 'INVALID_CONCURRENCY');
  }
  private event(c: DemoCase, stage: string, data: unknown) { c.events.push({ id: randomUUID(), at: this.now(), stage, data: structuredClone(data) }); }
  private mutate<T>(callId: string, action: (c: DemoCase) => T): T { return this.store.update(callId, c => { requireThat(c, 'CALL_NOT_FOUND'); const result = action(c); return { next: c, result }; }); }
  view(c: DemoCase) { return { callId: c.callId, caseId: c.id, phase: c.phase, approved: Boolean(c.seed?.approvalRef), experienceMode: c.experienceMode ?? 'standard', consentPending: !c.requirements.consent, missingFields: missing(c.requirements).filter(k => k !== 'consent' || !c.experienceMode || c.experienceMode === 'standard'), requirements: c.requirements, serverNow: new Date(this.now()).toISOString(), timezone: 'Asia/Seoul', mode: 'SIMULATION', seedHash: c.seed?.hash, callbackStatus: c.callback?.status }; }
  status(callId: string) { const c = this.store.read(callId); requireThat(c, 'CALL_NOT_FOUND'); return this.view(c); }
  begin(callId: string, citizenRef: string, experienceMode: ExperienceMode = 'standard') {
    requireThat(['standard', 'audience'].includes(experienceMode), 'INVALID_EXPERIENCE');
    requireThat(text(callId) && callId.length <= 160 && text(citizenRef) && citizenRef.length <= 160, 'INVALID_ID');
    return this.store.update(callId, existing => {
      if (existing) { requireThat(existing.citizenRef === citizenRef && (existing.experienceMode ?? 'standard') === experienceMode, 'CALL_IDENTITY_MISMATCH'); return { result: this.view(existing) }; }
      const c: DemoCase = { id: `demo-${randomUUID()}`, callId, citizenRef, revision: 0, experienceMode, requirements: {}, phase: 'INTERVIEW', inquiries: {}, events: [] };
      this.event(c, 'Interview.begin', { callId, citizenRef, experienceMode }); return { next: c, result: this.view(c) };
    });
  }
  update(callId: string, patch: unknown, evidenceQuote: string) {
    requireThat(patchValid(patch) && Object.keys(patch).length > 0 && text(evidenceQuote), 'INVALID_INTERVIEW');
    return this.mutate(callId, c => {
      requireThat(['INTERVIEW', 'SEED_READY', 'APPROVED'].includes(c.phase), 'INTERVIEW_LOCKED');
      c.requirements = { ...c.requirements, ...structuredClone(patch) }; c.revision++; c.phase = 'INTERVIEW'; delete c.seed; delete c.challenge;
      this.event(c, 'Interview.patch', { patch, evidenceQuote }); return this.view(c);
    });
  }
  prepareSeed(callId: string) {
    return this.mutate(callId, c => {
      requireThat(['INTERVIEW', 'SEED_READY'].includes(c.phase), 'SEED_LOCKED');
      const audience = c.experienceMode === 'audience';
      requireThat(missing(c.requirements).filter(k => !audience || k !== 'consent').length === 0 && patchValid(c.requirements), 'INTERVIEW_INCOMPLETE');
      const r = { ...c.requirements, ...(audience && !c.requirements.consent ? { consent: { contact: true, submit: true, callback: true } } : {}) } as Requirements;
      requireThat(!audience || (r.consent.contact && r.consent.submit && r.consent.callback), 'CONSENT_DECLINED');
      requireThat(new Set([r.item, ...r.alternatives]).size === r.alternatives.length + 1, 'DUPLICATE_ALTERNATIVE');
      const body = { version: c.revision, requirements: structuredClone(r) };
      c.seed = { ...body, hash: hash(body) }; c.challenge = { nonce: randomUUID(), hash: c.seed.hash, expiresAt: this.now() + 300_000, readback: audience ? shortReadback(r) : readback(r) }; c.phase = 'SEED_READY';
      this.event(c, 'Seed.prepared', { seed: c.seed, challenge: c.challenge });
      return { ...this.view(c), seedHash: c.seed.hash, ...c.challenge };
    });
  }
  approve(callId: string, seedHash: string, nonce: string, digit: string) {
    return this.mutate(callId, c => {
      const a = c.challenge; requireThat(a && c.seed && a.hash === seedHash && c.seed.hash === seedHash && a.nonce === nonce, 'APPROVAL_IDENTITY_MISMATCH');
      if (c.phase === 'APPROVED' && digit === '1') return this.view(c);
      requireThat(c.phase === 'SEED_READY' && a.expiresAt > this.now(), 'APPROVAL_EXPIRED_OR_USED');
      requireThat(digit === '1' || digit === '2', 'INVALID_DIGIT');
      if (digit === '2') { c.phase = 'INTERVIEW'; delete c.challenge; delete c.seed; this.event(c, 'Seed.rejected', { seedHash }); return this.view(c); }
      c.requirements.consent = structuredClone(c.seed.requirements.consent); c.seed.approvedAt = this.now(); c.seed.approvalRef = `call:${callId}:nonce:${nonce}:digit:1`; c.phase = 'APPROVED';
      this.event(c, 'Seed.approved', { seedHash, callId, nonce, digit }); return this.view(c);
    });
  }
  /** Explicit startup recovery. Never replay an interrupted external operation automatically. */
  recoverInterruptedRuns(): number {
    let count = 0; for (const value of this.store.list()) if (value.phase === 'RUNNING') { this.mutate(value.callId, c => { c.phase = 'UNKNOWN'; this.event(c, 'Run.recovery', { reason: 'INTERRUPTED_REQUIRES_RECONCILIATION' }); }); count++; }
    return count;
  }
  private log(callId: string, stage: string, data: unknown) { this.mutate(callId, c => this.event(c, stage, data)); }
  private async inquire(callId: string, seed: Seed, runId: string) {
    const tasks: InquiryTask[] = [seed.requirements.item, ...seed.requirements.alternatives].flatMap((item, priority) => this.provider.institutions.map(i => ({ id: `${i.id}:${priority}`, institutionId: i.id, institutionName: i.name, item, priority })));
    requireThat(new Set(tasks.map(t => t.id)).size === tasks.length, 'DUPLICATE_TASK');
    const controller = new AbortController(); const outcomes = new Map<string, InquiryOutcome>(); const candidates: Plan[] = []; let cursor = 0; let active = 0; let done = false;
    return new Promise<{ tasks: InquiryTask[]; outcomes: Map<string, InquiryOutcome>; selected?: Plan; timedOut: boolean }>(resolve => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = (timedOut: boolean, selected?: Plan) => {
        if (done) return; done = true; clearTimeout(timer); controller.abort();
        this.log(callId, 'Run1.closed', { runId, timedOut, selected: selected?.task.id, pending: tasks.filter(t => !outcomes.has(t.id)).map(t => t.id) });
        resolve({ tasks, outcomes, ...(selected ? { selected } : {}), timedOut });
      };
      const pump = () => {
        if (done) return;
        const selected = [...candidates].sort((a, b) => a.task.priority - b.task.priority)[0];
        const higherPending = selected && tasks.some(t => t.priority < selected.task.priority && (!outcomes.has(t.id) || outcomes.get(t.id)?.kind === 'no-answer'));
        if (selected && !higherPending) { finish(false, selected); return; }
        if (cursor === tasks.length && active === 0) { finish(false); return; }
        while (!done && active < this.concurrency && cursor < tasks.length) {
          const task = tasks[cursor++]!; active++; this.log(callId, 'Run1.started', { runId, task });
          Promise.resolve().then(() => this.provider.inquire(task, structuredClone(seed), controller.signal)).then(raw => {
            this.log(callId, done ? 'Run1.late_ignored' : 'Run1.response', { runId, task, raw });
            if (done) return;
            const outcome: InquiryOutcome = validOutcome(raw) ? raw : { kind: 'no-answer', retryAt: new Date(this.now() + 60_000).toISOString() };
            if (!validOutcome(raw)) this.log(callId, 'Run1.invalid_evidence', { taskId: task.id });
            outcomes.set(task.id, outcome);
            this.mutate(callId, c => { requireThat(c.phase === 'RUNNING', 'RUN_INTERRUPTED'); c.inquiries[task.id] = outcome; });
            if (outcome.kind === 'available') {
              const body = { seedHash: seed.hash, task, terms: outcome.terms, proof: outcome.proof }; const plan = { ...body, hash: hash(body) };
              const verdict = evaluate(seed, plan); this.log(callId, 'Run2.candidate_evaluation', { plan, verdict }); if (verdict.pass) candidates.push(plan);
            }
            active--; queueMicrotask(pump);
          }).catch(() => {
            if (done) return;
            const outcome: InquiryOutcome = { kind: 'no-answer', retryAt: new Date(this.now() + 60_000).toISOString() }; outcomes.set(task.id, outcome);
            try { this.mutate(callId, c => { c.inquiries[task.id] = outcome; this.event(c, 'Run1.error', { task }); }); } catch { /* storage failure is handled by final run failure */ }
            active--; queueMicrotask(pump);
          });
        }
      };
      timer = setTimeout(() => finish(true), this.inquiryTimeoutMs); pump();
    });
  }
  async run(callId: string) {
    const claimed = this.mutate(callId, c => {
      if (['RUNNING', 'READY', 'UNKNOWN'].includes(c.phase)) return { start: false, state: c };
      requireThat(c.phase === 'APPROVED' && c.seed?.approvalRef, 'APPROVAL_REQUIRED');
      const s = c.seed; requireThat(s.hash === hash({ version: s.version, requirements: s.requirements }), 'SEED_HASH_MISMATCH');
      requireThat(s.requirements.consent.contact && s.requirements.consent.submit && s.requirements.consent.callback, 'EXECUTION_CONSENT_REQUIRED');
      requireThat(Date.parse(s.requirements.neededBy) > this.now(), 'REQUEST_DEADLINE_PASSED');
      c.runId = `run:${s.hash}`; c.phase = 'RUNNING'; this.event(c, 'Run1.begin', { runId: c.runId, seedHash: s.hash }); return { start: true, state: c };
    });
    if (!claimed.start) return this.view(claimed.state);
    const seed = claimed.state.seed!;
    try {
      const inquiry = await this.inquire(callId, seed, claimed.state.runId!);
      if (!inquiry.selected) {
        const allUnavailable = inquiry.tasks.length > 0 && inquiry.tasks.every(t => inquiry.outcomes.get(t.id)?.kind === 'unavailable');
        const next = [...inquiry.outcomes.values()].flatMap(o => o.kind === 'unavailable' && o.next && validNext(o.next) && Date.parse(o.next.at) > this.now() ? [o.next] : []).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
        const other = [...new Set([...inquiry.outcomes.values()].flatMap(o => o.kind === 'available' ? [o.terms.item] : []))];
        const confirmedOtherOnly = !inquiry.timedOut && inquiry.tasks.length > 0 && inquiry.tasks.every(t => { const o = inquiry.outcomes.get(t.id); return o && o.kind !== 'no-answer'; });
        const message = allUnavailable || confirmedOtherOnly
          ? `[시연 결과] 확인한 기관에서는 요청과 허용 대안에 맞는 지원을 받기 어렵습니다.${other.length ? ` 다른 조건으로 가능한 후보는 ${other.join(', ')}입니다. 신청하지 않았습니다.` : ''}${next ? ` 다음 접수는 ${spokenTime(next.at)}입니다. ${next.instructions}` : ' 다음 접수 일정은 아직 확인되지 않았습니다.'}${seed.requirements.noMatchPreference === 'offer_callback' && (!claimed.state.experienceMode || claimed.state.experienceMode === 'standard') ? next ? ' 안내한 다음 시점에 다시 확인하는 시연 연락을 예약할까요?' : ' 다음 접수 시각이 확인되면 연락받고 싶으신가요? 아직 예약 시각은 정하지 않았습니다.' : ''}`
          : '[시연 결과] 아직 답변을 확인하지 못한 기관이 있어 지원 불가로 판단하지 않았습니다. 추가 확인이 필요합니다.';
        return this.mutate(callId, c => {
          requireThat(c.phase === 'RUNNING', 'RUN_INTERRUPTED');
          c.ev1 = { pass: false, reasons: [allUnavailable ? 'NO_MATCH' : confirmedOtherOnly ? 'OTHER_ONLY' : 'UNVERIFIED'], seedHash: seed.hash };
          this.event(c, 'Run2.plan', { selected: null, reasons: c.ev1.reasons }); this.event(c, 'EV1', c.ev1); this.event(c, 'Run3.skipped', { reason: c.ev1.reasons });
          this.event(c, 'Run4.recorded', { runId: c.runId, outcomeCount: inquiry.outcomes.size });
          c.ev2 = { pass: true, reasons: [allUnavailable ? 'SCOPED_UNAVAILABLE' : confirmedOtherOnly ? 'INFORMATION_ONLY' : 'PENDING_ONLY'], seedHash: seed.hash }; this.event(c, 'EV2', c.ev2);
          c.callback = { id: `callback:${c.runId}`, status: 'PENDING', message, ...(next && seed.requirements.noMatchPreference === 'offer_callback' && (!c.experienceMode || c.experienceMode === 'standard') ? { next } : {}) }; c.phase = 'READY'; return this.view(c);
        });
      }
      const plan = inquiry.selected; const ev1 = evaluate(seed, plan);
      this.mutate(callId, c => { requireThat(c.phase === 'RUNNING', 'RUN_INTERRUPTED'); c.plan = plan; c.ev1 = ev1; this.event(c, 'Run2.plan', plan); this.event(c, 'EV1', ev1); requireThat(ev1.pass, 'EV1_FAILED'); this.event(c, 'Run3.intent', { key: `${seed.hash}:submit`, planHash: plan.hash }); });
      const receipt = await this.provider.submit(structuredClone(plan), `${seed.hash}:submit`);
      if ('kind' in receipt) { this.mutate(callId, c => { c.phase = 'UNKNOWN'; this.event(c, 'Run3.unknown', receipt); }); return this.status(callId); }
      return this.mutate(callId, c => {
        requireThat(c.phase === 'RUNNING', 'RUN_INTERRUPTED'); c.receipt = receipt; this.event(c, 'Run3.receipt', receipt);
        this.event(c, 'Run4.recorded', { runId: c.runId, planHash: plan.hash, receiptId: receipt.id });
        c.ev2 = evaluate(seed, plan, receipt); this.event(c, 'EV2', c.ev2);
        if (!c.ev2.pass) { c.phase = 'UNKNOWN'; return this.view(c); }
        c.callback = { id: `callback:${c.runId}`, status: 'PENDING', message: c.experienceMode === 'audience' ? `[시연 결과] ${plan.task.institutionName}에서 ${plan.terms.item} ${plan.terms.quantity === 1 ? '한' : plan.terms.quantity} 인분 모의 신청이 접수됐습니다. ${spokenTime(plan.terms.promisedBy)} ${plan.terms.receivingMethod === 'delivery' ? '배달' : '방문 수령'} 예정인 모의 결과이며 실제 배송은 없습니다.` : `[시연 결과] ${plan.task.institutionName}에서 ${plan.terms.item} ${plan.terms.quantity}개 모의 지원 신청이 접수됐습니다. ${plan.terms.receivingMethod === 'delivery' ? `${seed.requirements.region}으로 ${spokenTime(plan.terms.promisedBy)} 배달 예정인 모의 계획입니다.` : `${plan.task.institutionName}에서 ${spokenTime(plan.terms.promisedBy)} 방문 수령 예정인 모의 계획입니다.`} 실제 음식 배송은 없는 시연입니다.` };
        c.phase = 'READY'; return this.view(c);
      });
    } catch (e) {
      this.mutate(callId, c => { c.phase = 'UNKNOWN'; this.event(c, 'Run.failed', { reason: e instanceof DemoError ? e.message : 'ADAPTER_OR_STORAGE_FAILURE' }); }); return this.status(callId);
    }
  }
  claimCallback(callId: string) { return this.mutate(callId, c => {
    requireThat(c.phase === 'READY' && c.ev2?.pass && c.seed?.requirements.consent.callback, 'CALLBACK_NOT_READY');
    const job = c.callback; if (!job || job.status !== 'PENDING') return { job: null };
    job.status = 'CLAIMED'; job.claimAt = this.now(); this.event(c, 'Callback.claimed', { jobId: job.id });
    return { job: { id: job.id, callId, citizenRef: c.citizenRef, message: job.message, mode: 'SIMULATION', experienceMode: c.experienceMode ?? 'standard', ...(job.next ? { nextOpportunity: job.next } : {}) } };
  }); }
  answerCallback(callId: string, jobId: string, digit: string) { return this.mutate(callId, c => {
    const job = c.callback; requireThat(job && job.id === jobId && job.status === 'CLAIMED', 'CALLBACK_IDENTITY_MISMATCH'); requireThat(digit === '1' || digit === '2', 'INVALID_DIGIT');
    if (job.answer) { requireThat(job.answer === digit, 'CALLBACK_ANSWER_FINAL'); return { message: '이미 기록한 답변입니다.', reservation: c.reservation }; }
    job.answer = digit; this.event(c, 'Callback.answer', { jobId, digit });
    if (job.next && digit === '1') { requireThat(validNext(job.next) && Date.parse(job.next.at) > this.now(), 'NEXT_OPPORTUNITY_EXPIRED'); c.reservation = { at: job.next.at, timezone: job.next.timezone, consentRef: `call:${callId}:job:${jobId}:digit:1`, status: 'SCHEDULED' }; this.event(c, 'Callback.reserved', c.reservation); }
    return { message: c.reservation ? '안내한 시점에 다시 확인하는 시연 예약을 기록했습니다.' : '답변을 기록했습니다. 재연락 예약을 추가하지 않았습니다.', reservation: c.reservation };
  }); }
  completeCallback(callId: string, jobId: string, body: { answered: boolean; acknowledged: boolean; completed: boolean; receiptRef: string }) { return this.mutate(callId, c => {
    const job = c.callback; requireThat(job && job.id === jobId && job.status === 'CLAIMED' && text(body.receiptRef), 'CALLBACK_IDENTITY_MISMATCH');
    job.status = body.answered && body.acknowledged && body.completed && Boolean(job.answer) ? 'DELIVERED' : 'UNKNOWN'; job.receiptRef = body.receiptRef; this.event(c, 'Callback.receipt', { ...body, status: job.status }); return { delivered: job.status === 'DELIVERED', status: job.status };
  }); }
}
