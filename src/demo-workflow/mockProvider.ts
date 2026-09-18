import type { DemoProvider, Proof, Requirements } from './types.ts';
import { hash } from './contracts.ts';
export function demoRequirements(now = Date.now()): Requirements { return { item: '한 끼 식사', quantity: 1, region: '서울 서초구', neededBy: new Date(now + 7200_000).toISOString(), maxCostKrw: 0, dietaryRestrictions: [], alternatives: [], receivingMethod: 'delivery', noMatchPreference: 'offer_callback', consent: { contact: true, submit: true, callback: true } }; }
export function createMockProvider(scenario: 'success' | 'unavailable' | 'no-answer' = 'success', now = Date.now): DemoProvider {
  const proof = (ref: string): Proof => ({ mode: 'SIMULATION', ref: `fictional-demo://${ref}`, observedAt: new Date(now()).toISOString() });
  return { mode: 'SIMULATION', institutions: ['A', 'B', 'C'].map(id => ({ id, name: `시연 기관 ${id} (허구)` })),
    async inquire(task, seed, signal) {
      if (signal.aborted) throw new Error('ABORTED');
      await Promise.resolve();
      if (scenario === 'no-answer') return { kind: 'no-answer', retryAt: new Date(now() + 60_000).toISOString() };
      if (scenario === 'success' && task.institutionId === 'B') return { kind: 'available', proof: proof(`B/${hash(task)}`), terms: { item: task.item, quantity: seed.requirements.quantity, costKrw: 0, receivingMethod: seed.requirements.receivingMethod, dietaryRestrictions: [...seed.requirements.dietaryRestrictions], promisedBy: seed.requirements.neededBy } };
      return { kind: 'unavailable', reason: '시연에서 오늘 물량이 소진된 것으로 설정했습니다', proof: proof(`${task.institutionId}/unavailable`), next: { at: new Date(now() + 86400_000).toISOString(), timezone: 'Asia/Seoul', instructions: '시연 준비물은 없습니다. 실제 기관 지원 일정이 아닙니다.', proof: proof(`${task.institutionId}/next`) } };
    },
    async submit(plan, key) { return { id: `mock-receipt:${hash(key)}`, planHash: plan.hash, institutionId: plan.task.institutionId, terms: structuredClone(plan.terms), proof: proof(`receipt/${hash(key)}`) }; },
  };
}
