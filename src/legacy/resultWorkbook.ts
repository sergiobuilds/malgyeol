import * as XLSX from '@e965/xlsx';
import type { BenefitCase } from '../e2e/types.ts';

export function buildResultWorkbook(cases: BenefitCase[]): Buffer {
  const workbook = XLSX.utils.book_new();
  const executions = cases.filter(value => value.state === 'ORDERED').map(value => ({
    caseId: value.caseId,
    '참여자 코드': value.beneficiaryRef,
    '이용계획': value.planId,
    '승인·집행액(원)': value.candidate?.programAmountKrw ?? 0,
    '잔액(원)': Math.max(0, 420_000 - (value.candidate?.programAmountKrw ?? 0)),
    '상태': value.state
  }));
  const orders = cases.filter(value => value.providerOrderId).map(value => ({
    caseId: value.caseId,
    '주문번호': value.providerOrderId,
    '판매자': value.candidate?.merchantId,
    '품목 코드': value.candidate?.sku,
    '수량': value.candidate?.quantity
  }));
  const blocked = cases.filter(value => value.state !== 'ORDERED').map(value => ({
    caseId: value.caseId,
    '상태': value.state,
    '차단·검토 사유': value.policy?.checks.filter(check => !check.pass).map(check => check.rule).join(', ') ?? ''
  }));
  const evidence = cases.map(value => ({
    caseId: value.caseId,
    '정책 해시': value.policySnapshotHash,
    '동의 commitment': value.confirmationCommitment,
    'Devnet 기술증명(base units)': value.settlementProofBaseUnits,
    'Devnet 거래 서명': value.settlementTransaction,
    '주의': '실제 정부자금 또는 원화 결제가 아닌 해커톤 기술증명'
  }));
  const sheets: Array<[string, Record<string, unknown>[]]> = [
    ['참여자별 집행', executions],
    ['주문·판매자', orders],
    ['차단·검토', blocked],
    ['증빙 참조', evidence]
  ];
  for (const [name, rows] of sheets) {
    const sheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ caseId: '' }]);
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
}

export function buildRoleScopedWorkbook(cases: BenefitCase[]): Buffer {
  const workbook = XLSX.utils.book_new();
  const rows = cases.map(value => ({
    caseId: value.caseId,
    '사건 상태': value.state,
    '주문번호': value.providerOrderId ?? '',
    '품목 코드': value.candidate?.sku ?? '',
    '수량': value.candidate?.quantity ?? '',
    '승인·집행액(원)': value.candidate?.programAmountKrw ?? '',
    '정책 해시': value.policySnapshotHash ?? '',
    '갱신 시각': new Date(value.updatedAt).toISOString()
  }));
  const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ caseId: '' }]);
  XLSX.utils.book_append_sheet(workbook, sheet, '권한 범위 사건');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
}
