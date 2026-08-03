import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from '@e965/xlsx';
import { buildResultWorkbook } from '../../src/legacy/resultWorkbook.ts';

const cases = [{
  caseId: 'case_xlsx_1', callSidHash: 'hidden', beneficiaryRef: 'P-2026-0031',
  programId: 'kr-disability-personal-budget-demo', planId: 'plan-stand-aid', state: 'ORDERED' as const,
  candidate: {
    caseId: 'case_xlsx_1', sku: 'ASSISTIVE_STAND_AID_01', category: 'ASSISTIVE_EQUIPMENT', quantity: 1,
    merchantId: 'DEMO_ACCESS_STORE', unitPriceKrw: 380_000, totalPriceKrw: 380_000, programAmountKrw: 380_000,
    substitutionsAllowed: false, confidence: 0.97, ambiguityReasons: [], readbackSentence: '확인'
  },
  settlementProofBaseUnits: 1_000_000, settlementTransaction: 'devnet_signature_1', providerOrderId: 'DEMO-ORDER-1',
  createdAt: 1000, updatedAt: 2000
}];

test('legacy workbook has four institution sheets and separates KRW from Devnet proof units', () => {
  const bytes = buildResultWorkbook(cases);
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['참여자별 집행', '주문·판매자', '차단·검토', '증빙 참조']);
  const execution = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['참여자별 집행']!);
  assert.equal(execution[0]?.['승인·집행액(원)'], 380_000);
  assert.equal(execution[0]?.['참여자 코드'], 'P-2026-0031');
  const evidence = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['증빙 참조']!);
  assert.equal(evidence[0]?.['Devnet 기술증명(base units)'], 1_000_000);
  assert.equal(JSON.stringify(workbook).includes('hidden'), false);
});
