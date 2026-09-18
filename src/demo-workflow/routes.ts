import { timingSafeEqual } from 'node:crypto';
import { DemoWorkflowStore } from './store.ts';
import { DemoError, DemoWorkflowService } from './service.ts';
import { createMockProvider } from './mockProvider.ts';
import { text } from './contracts.ts';
export interface DemoHttpResult { status: number; body: unknown; }
export function createDemoWorkflowRoutes(options: { ledgerPath: string; secret: string; scenario?: string }) {
  if (!text(options.ledgerPath) || Buffer.byteLength(options.secret) < 32) throw new Error('DEMO_CONFIGURATION_REQUIRED');
  const scenario = options.scenario ?? 'success';
  if (!['success', 'unavailable', 'no-answer'].includes(scenario)) throw new Error('INVALID_DEMO_SCENARIO');
  const service = new DemoWorkflowService(new DemoWorkflowStore(options.ledgerPath), createMockProvider(scenario as 'success' | 'unavailable' | 'no-answer'));
  service.recoverInterruptedRuns();
  return demoRoutesForService(service, options.secret);
}
export function demoRoutesForService(service: DemoWorkflowService, secret: string) {
  return async (method: string, url: URL, authorization: string, body: Record<string, unknown> = {}): Promise<DemoHttpResult | undefined> => {
    const prefix = '/internal/demo-workflow'; if (!url.pathname.startsWith(prefix + '/')) return undefined;
    const actual = Buffer.from(authorization ?? ''), expected = Buffer.from(`Bearer ${secret}`);
    if (Buffer.byteLength(secret) < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { status: 403, body: { error: 'FORBIDDEN' } };
    function field(key: string): string { const value = body[key]; if (!text(value)) throw new DemoError(`INVALID_${key}`, 400); return value; }
    try {
      const action = url.pathname.slice(prefix.length + 1);
      if (method === 'GET' && action === 'status') { const callId = url.searchParams.get('callId'); if (!text(callId)) throw new DemoError('INVALID_CALL_ID', 400); return { status: 200, body: service.status(callId) }; }
      if (method !== 'POST') return { status: 405, body: { error: 'METHOD_NOT_ALLOWED' } };
      const callId = field('callId'); let result: unknown;
      switch (action) {
        case 'begin': result = service.begin(callId, field('citizenRef')); break;
        case 'interview': result = service.update(callId, body.patch, field('evidenceQuote')); break;
        case 'seed': result = service.prepareSeed(callId); break;
        case 'approve': result = service.approve(callId, field('seedHash'), field('nonce'), field('digit')); break;
        case 'run': result = await service.run(callId); break;
        case 'callback/claim': result = service.claimCallback(callId); break;
        case 'callback/answer': result = service.answerCallback(callId, field('jobId'), field('digit')); break;
        case 'callback/receipt':
          if (!['answered', 'acknowledged', 'completed'].every(k => typeof body[k] === 'boolean')) throw new DemoError('INVALID_RECEIPT', 400);
          result = service.completeCallback(callId, field('jobId'), { answered: body.answered as boolean, acknowledged: body.acknowledged as boolean, completed: body.completed as boolean, receiptRef: field('receiptRef') }); break;
        default: return { status: 404, body: { error: 'NOT_FOUND' } };
      }
      return { status: 200, body: result };
    } catch (e) { return { status: e instanceof DemoError ? e.status : 500, body: { error: e instanceof DemoError ? e.message : 'DEMO_STATE_REVIEW_REQUIRED' } }; }
  };
}
