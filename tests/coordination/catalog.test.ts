import test from 'node:test';
import assert from 'node:assert/strict';
import { listInstitutions, getInstitution, listPrograms } from '../../src/coordination/catalog.ts';

test('four programs preserve citywide public lists instead of two demo institutions', () => {
  assert.deepEqual(listPrograms().map(x=>x.id).sort(), ['care-sos','foodbank-market','just-dream','mobile-market']);
  assert.ok(listInstitutions({programId:'foodbank-market'}).length >= 36);
  assert.equal(listInstitutions({programId:'just-dream'}).length,29);
  assert.equal(new Set(listInstitutions({programId:'foodbank-market'}).map(x=>x.district)).size,25);
});
test('district, program and text filters intersect without recommending another district', () => {
  const rows=listInstitutions({programId:'just-dream',district:'강동구',query:'동남로'});
  assert.equal(rows.length,1);
  assert.equal(rows[0]!.district,'강동구');
  assert.equal(listInstitutions({district:'성동구',query:'강남'}).length,0);
  assert.equal(listInstitutions({district:'강남구',programId:'care-sos'}).length,0);
  assert.ok(listInstitutions({district:'서울 전체',programId:'care-sos'}).length > 0);
});
test('same facility retains separate program hours and registration pathways', () => {
  const row=listInstitutions({district:'강동구',query:'동남로'})[0]!;
  assert.equal(row.programs.length,2);
  const food=row.programs.find(p=>p.programId==='foodbank-market')!;
  const dream=row.programs.find(p=>p.programId==='just-dream')!;
  assert.notEqual(food.hours,dream.hours);
  assert.match(food.steps.join(' '),/선정/);
  assert.match(dream.steps.join(' '),/신청서/);
  assert.match(dream.eligibility.join(' '),/주소지/);
});
test('inquiry offices are distinct from collection places, with sourced contacts', () => {
  const mobile=listInstitutions({programId:'mobile-market'})[0]!;
  assert.ok(mobile.roles.includes('사업 운영·일정 문의'));
  assert.ok(!mobile.roles.includes('개인 수령처'));
  const sos=listInstitutions({district:'성동구',programId:'care-sos'})[0]!;
  assert.ok(sos.name.includes('성수1가제2동'));
  assert.ok(sos.contacts.some(c=>c.phone==='02-2286-7729'));
  assert.match(sos.programs.find(p=>p.programId==='care-sos')!.access.join(' '),/성수1가제2동/);
  for (const row of listInstitutions()) {
    assert.ok(row.sources.length);
    for (const source of [...row.sources,...row.programs.flatMap(p=>p.sources)]) {
      assert.match(source.url,/^https:\/\//);
      assert.ok(Number.isFinite(Date.parse(source.checkedAt)));
    }
    assert.ok(row.contacts.every(c=>c.purpose && c.phone));
  }
});
test('catalog results cannot mutate shared data or create non-existent institutions', () => {
  const first=listInstitutions()[0]!; const id=first.id; const name=first.name;
  first.name='changed'; first.programs.splice(0);
  assert.equal(getInstitution(id)!.name,name);
  assert.ok(getInstitution(id)!.programs.length);
  assert.equal(getInstitution('nonexistent'),undefined);
});
