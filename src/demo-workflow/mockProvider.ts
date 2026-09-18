import type { DemoProvider, Proof, Requirements, Terms } from './types.ts';
import { hash, normalizeMeal } from './contracts.ts';
export function demoRequirements(now = Date.now()): Requirements { return { item: '한 끼 식사', quantity: 1, region: '서울 서초구', neededBy: new Date(now + 7200_000).toISOString(), maxCostKrw: 0, dietaryRestrictions: [], alternatives: [], receivingMethod: 'delivery', noMatchPreference: 'offer_callback', consent: { contact: true, submit: true, callback: true } }; }
export interface MockCatalogOffer { institutionId: string; regions: string[]; terms: Terms; }
export function fixedMockCatalog(now = Date.now()): MockCatalogOffer[] {
 const common = { item: '한 끼 식사', quantity: 1, costKrw: 0, dietaryRestrictions: [] };
 const regions = ['서울 서초구', '서초구', '서울 서초구 AI 허브', '서초 AI 허브', '서초 AIhub', '서울 AI 허브', '서울 AIhub', 'AI 허브', 'AIhub'];
 return Array.from({ length: 24 }, (_, slot) => new Date(now + (slot + 1) * 1800_000).toISOString()).flatMap(promisedBy => (['delivery', 'pickup'] as const).map(receivingMethod => ({ institutionId: 'B', regions: [...regions], terms: { ...common, promisedBy, receivingMethod } })));
}
const normalizedRegion = (region: string) => region.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
export function createMockProvider(scenario: 'success' | 'unavailable' | 'no-answer' = 'success', now = Date.now, catalogInput?: MockCatalogOffer[]): DemoProvider {
 // Snapshot fixtures once. No offer condition is manufactured from a caller's Seed.
 const catalog = structuredClone(catalogInput ?? fixedMockCatalog(now()));
 const approvedOffers = new Map<string, { institutionId: string; terms: Terms }>();
 const proof = (ref: string): Proof => ({ mode: 'SIMULATION', ref: `fictional-demo://${ref}`, observedAt: new Date(now()).toISOString() });
 return { mode: 'SIMULATION', institutions: ['A', 'B', 'C'].map(id => ({ id, name: `시연 기관 ${id} (허구)` })),
  async inquire(task, seed, signal) {
   if (signal.aborted) throw new Error('ABORTED'); await Promise.resolve();
   if (scenario === 'no-answer') return { kind: 'no-answer', retryAt: new Date(now() + 60_000).toISOString() };
   const r = seed.requirements;
   const offer = scenario === 'success' && catalog.find(o => o.institutionId === task.institutionId && o.regions.map(normalizedRegion).includes(normalizedRegion(r.region)) && normalizeMeal(o.terms.item) === normalizeMeal(task.item) && o.terms.quantity === r.quantity && o.terms.costKrw <= r.maxCostKrw && o.terms.receivingMethod === r.receivingMethod && r.dietaryRestrictions.every(d => o.terms.dietaryRestrictions.includes(d)) && Date.parse(o.terms.promisedBy) <= Date.parse(r.neededBy) && Date.parse(o.terms.promisedBy) > now());
   if (offer) { const evidence = proof(`${offer.institutionId}/catalog/${hash(offer)}`); approvedOffers.set(`${seed.hash}:${evidence.ref}`, { institutionId: task.institutionId, terms: structuredClone(offer.terms) }); return { kind: 'available', proof: evidence, terms: structuredClone(offer.terms) }; }
   return { kind: 'unavailable', reason: '고정 시연 목록에 지역·물품·수량·식이·비용·수령·기한을 모두 충족하는 지원이 없습니다.', proof: proof(`${task.institutionId}/unavailable`), ...(scenario === 'unavailable' ? { next: { at: new Date(now() + 86400_000).toISOString(), timezone: 'Asia/Seoul', instructions: '시연 준비물은 없습니다. 실제 기관 지원 일정이 아닙니다.', proof: proof(`${task.institutionId}/next`) } } : {}) };
  },
  async submit(plan, key) {
   const offer = approvedOffers.get(`${plan.seedHash}:${plan.proof.ref}`);
   if (!offer || offer.institutionId !== plan.task.institutionId || hash(offer.terms) !== hash(plan.terms)) throw new Error('MOCK_CATALOG_PLAN_MISMATCH');
   return { id: `mock-receipt:${hash(key)}`, planHash: plan.hash, institutionId: plan.task.institutionId, terms: structuredClone(offer.terms), proof: proof(`receipt/${hash(key)}`) };
  },
 };
}
