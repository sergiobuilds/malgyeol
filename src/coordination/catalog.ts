import { readFileSync } from 'node:fs';
import type { Institution, ProgramId } from './types.ts';

const programs: { id: ProgramId; name: string }[] = [
  { id: 'foodbank-market', name: '푸드뱅크·푸드마켓' },
  { id: 'mobile-market', name: '찾아가는 푸드마켓' },
  { id: 'just-dream', name: '그냥드림' },
  { id: 'care-sos', name: '돌봄SOS' },
];
const catalog = JSON.parse(readFileSync(new URL('../../data/support-network.json', import.meta.url), 'utf8')) as { institutions: Institution[] };
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s+/g, '');

export function listPrograms(): { id: ProgramId; name: string }[] {
  return structuredClone(programs);
}

/** District is an exact administrative filter; citywide inquiry offices are explicit. */
export function listInstitutions(filters: { programId?: ProgramId; district?: string; query?: string } = {}): Institution[] {
  const query = normalize(filters.query ?? '');
  return structuredClone(catalog.institutions.filter(item => {
    if (filters.programId && !item.programs.some(p => p.programId === filters.programId)) return false;
    if (filters.district && item.district !== filters.district.trim()) return false;
    if (!query) return true;
    const text = [item.name, item.address, item.district, ...item.roles,
      ...item.programs.flatMap(p => [programs.find(x => x.id === p.programId)?.name ?? '', ...p.categories])].join(' ');
    return normalize(text).includes(query);
  }));
}

export function getInstitution(id: string): Institution | undefined {
  const item = catalog.institutions.find(candidate => candidate.id === id);
  return item ? structuredClone(item) : undefined;
}
