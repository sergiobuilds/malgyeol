import { createHash } from 'node:crypto';
import type { Requirements, Proof, Terms, Seed, Plan, Receipt, Verdict, InquiryOutcome, NextOpportunity } from './types.ts';
function sorted(v: unknown): unknown { if (Array.isArray(v)) return v.map(sorted); if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])); return v; }
export function hash(v: unknown): string { return createHash('sha256').update(JSON.stringify(sorted(v))).digest('hex'); }
export function object(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v); }
export function text(v: unknown): v is string { return typeof v === 'string' && v.trim().length > 0 && v.length <= 2000; }
export function date(v: unknown): v is string { return text(v) && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)); }
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 20 && v.every(text);
export const fields: (keyof Requirements)[] = ['item', 'quantity', 'region', 'neededBy', 'maxCostKrw', 'dietaryRestrictions', 'alternatives', 'receivingMethod', 'noMatchPreference', 'consent'];
export function patchValid(v: unknown): v is Partial<Requirements> {
  if (!object(v) || Object.keys(v).some(k => !fields.includes(k as keyof Requirements))) return false;
  for (const [k, x] of Object.entries(v)) {
    if (['item', 'region'].includes(k) && !text(x)) return false;
    if (k === 'quantity' && (!Number.isSafeInteger(x) || Number(x) <= 0)) return false;
    if (k === 'maxCostKrw' && (typeof x !== 'number' || !Number.isFinite(x) || x < 0)) return false;
    if (k === 'neededBy' && !date(x)) return false;
    if (['dietaryRestrictions', 'alternatives'].includes(k) && !strings(x)) return false;
    if (k === 'receivingMethod' && x !== 'delivery' && x !== 'pickup') return false;
    if (k === 'noMatchPreference' && x !== 'offer_callback' && x !== 'stop') return false;
    if (k === 'consent' && (!object(x) || Object.keys(x).length !== 3 || !['contact', 'submit', 'callback'].every(f => typeof x[f] === 'boolean'))) return false;
  }
  return true;
}
export function missing(r: Partial<Requirements>): string[] { return fields.filter(k => r[k] === undefined); }
export function validProof(v: unknown): v is Proof { return object(v) && v.mode === 'SIMULATION' && text(v.ref) && date(v.observedAt); }
export function validNext(v: unknown): v is NextOpportunity {
  if (!object(v) || !date(v.at) || !text(v.timezone) || !text(v.instructions) || !validProof(v.proof)) return false;
  try { new Intl.DateTimeFormat('ko-KR', { timeZone: v.timezone }); return true; } catch { return false; }
}
export function validOutcome(v: unknown): v is InquiryOutcome {
  if (!object(v)) return false;
  if (v.kind === 'no-answer') return date(v.retryAt);
  if (!validProof(v.proof)) return false;
  if (v.kind === 'unavailable') return text(v.reason) && (v.next === undefined || validNext(v.next));
  if (v.kind !== 'available' || !object(v.terms)) return false;
  const t = v.terms;
  return text(t.item) && Number.isSafeInteger(t.quantity) && Number(t.quantity) > 0 && typeof t.costKrw === 'number' && Number.isFinite(t.costKrw) && t.costKrw >= 0 && ['delivery', 'pickup'].includes(String(t.receivingMethod)) && strings(t.dietaryRestrictions) && date(t.promisedBy);
}
export function evaluate(seed: Seed, plan: Plan, receipt?: Receipt): Verdict {
  const r = seed.requirements; const t = plan.terms; const reasons: string[] = [];
  if (seed.hash !== hash({ version: seed.version, requirements: r }) || plan.seedHash !== seed.hash) reasons.push('SEED_MISMATCH');
  if (plan.hash !== hash({ seedHash: plan.seedHash, task: plan.task, terms: plan.terms, proof: plan.proof })) reasons.push('PLAN_MISMATCH');
  if (!seed.approvalRef || seed.approvedAt === undefined) reasons.push('NOT_APPROVED');
  if (![r.item, ...r.alternatives].map(normalizeMeal).includes(normalizeMeal(t.item)) || normalizeMeal(t.item) !== normalizeMeal(plan.task.item) || t.quantity !== r.quantity || t.costKrw > r.maxCostKrw || t.receivingMethod !== r.receivingMethod || r.dietaryRestrictions.some(x => !t.dietaryRestrictions.includes(x)) || Date.parse(t.promisedBy) > Date.parse(r.neededBy)) reasons.push('TERMS_OUTSIDE_SEED');
  if (!validProof(plan.proof)) reasons.push('INVALID_PROOF');
  if (receipt && (!text(receipt.id) || receipt.planHash !== plan.hash || receipt.institutionId !== plan.task.institutionId || hash(receipt.terms) !== hash(plan.terms) || !validProof(receipt.proof))) reasons.push('RECEIPT_MISMATCH');
  return { pass: reasons.length === 0, reasons, seedHash: seed.hash, planHash: plan.hash };
}
export function spokenTime(at: string): string { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(at)); }
export function readback(r: Requirements): string { return `시연 요청을 확인하겠습니다. ${r.region}, ${r.item} ${r.quantity}개, ${spokenTime(r.neededBy)}까지, ${r.maxCostKrw === 0 ? '무료' : `최대 ${r.maxCostKrw}원`}, ${r.receivingMethod === 'delivery' ? '배달' : '방문 수령'}입니다. 식이 제한은 ${r.dietaryRestrictions.join(', ') || '없음'}입니다. 없으면 ${r.alternatives.length ? r.alternatives.join(', ') + ' 순서로' : '다른 물품으로 바꾸지 않고'} 확인합니다. 그마저 없으면 ${r.noMatchPreference === 'offer_callback' ? '다음 지원 시점의 연락을 제안합니다' : '결과만 알려드립니다'}. 모의 기관 문의 ${r.consent.contact ? '동의' : '비동의'}, 모의 신청 ${r.consent.submit ? '동의' : '비동의'}, 고객 결과 전화 ${r.consent.callback ? '동의' : '비동의'}입니다. 맞으면 1번, 수정하려면 2번을 눌러 주세요.`; }

export function shortReadback(r: Requirements): string {
 const count = r.quantity === 1 ? '한' : r.quantity === 2 ? '두' : String(r.quantity);
 return `시연 조건을 확인할게요. ${r.region}, ${r.item} ${count} ${normalizeMeal(r.item) === '한끼식사' ? '인분' : '개'}, ${r.maxCostKrw === 0 ? '무료' : `최대 ${r.maxCostKrw}원`}, ${r.receivingMethod === 'delivery' ? '배달' : '방문 수령'}, ${spokenTime(r.neededBy)}까지입니다. 식이 제한 ${r.dietaryRestrictions.join(', ') || '없음'}, 대안 ${r.alternatives.join(', ') || '없음'}입니다. 없으면 ${r.noMatchPreference === 'offer_callback' ? '다음 가능한 방법을 안내합니다' : '결과만 안내합니다'}. 이번 체험에서 추가 예약은 하지 않습니다. 이 조건으로 모의 기관 문의와 모의 신청을 하고, 이 전화번호로 결과를 알려드릴게요. 동의하면 일 번, 수정하려면 이 번을 눌러 주세요.`;
}

export function normalizeMeal(item: string): string { const compact = item.normalize('NFKC').replace(/\s+/g, '').toLowerCase(); return ['한끼식사','한끼','식사','음식','도시락','밥','무료식사','식사한끼'].includes(compact) ? '한끼식사' : compact; }
