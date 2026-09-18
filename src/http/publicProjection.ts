import type { BenefitCase, CaseEvent } from '../e2e/types.ts';

export interface PublicCaseProjection {
  caseId: string;
  state: BenefitCase['state'];
  programName: string;
  currentProductProgram: '2026 농식품바우처 호환 식품지원';
  legacyEvidence: boolean;
  sandbox: true;
  productName?: string;
  quantity?: number;
  programAmountKrw?: number;
  providerOrderId?: string;
  createdAt: number;
  updatedAt: number;
  technicalProof?: {
    policySnapshotHash?: string;
    confirmationCommitment?: string;
    paymentAuthorizationId?: string;
    paymentReference?: string;
    authorizedAmountKrw?: number;
    disclaimer: string;
  };
}

export interface PublicCaseEventProjection {
  caseId: string;
  sequence: number;
  state: CaseEvent['state'];
  at: number;
  failedPolicyRules?: string[];
}

export function projectPublicCase(value: BenefitCase, includeTechnicalProof: boolean): PublicCaseProjection {
  const projected: PublicCaseProjection = {
    caseId: value.caseId,
    state: value.state,
    programName: value.programId === 'kr-disability-personal-budget-demo'
      ? '보존된 이전 보조기기 샌드박스 증거 · 현행 식품지원 아님'
      : '2026 농식품바우처 호환 식품지원',
    currentProductProgram: '2026 농식품바우처 호환 식품지원',
    legacyEvidence: value.programId === 'kr-disability-personal-budget-demo',
    sandbox: true,
    ...(value.candidate ? {
      productName: value.candidate.readbackSentence,
      quantity: value.candidate.quantity,
      programAmountKrw: value.candidate.programAmountKrw
    } : {}),
    ...(value.providerOrderId ? { providerOrderId: value.providerOrderId } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
  if (includeTechnicalProof) {
    projected.technicalProof = {
      ...(value.policySnapshotHash ? { policySnapshotHash: value.policySnapshotHash } : {}),
      ...(value.confirmationCommitment ? { confirmationCommitment: value.confirmationCommitment } : {}),
      ...(value.paymentAuthorizationId ? { paymentAuthorizationId: value.paymentAuthorizationId } : {}),
      ...(value.paymentReference ? { paymentReference: value.paymentReference } : {}),
      ...(value.authorizedAmountKrw === undefined ? {} : { authorizedAmountKrw: value.authorizedAmountKrw }),
      disclaimer: '합성 데이터로 실행한 샌드박스 기록이며 실제 정부자금 결제가 아님'
    };
  }
  return projected;
}

export function projectPublicEvent(value: CaseEvent): PublicCaseEventProjection {
  const policy = value.data.policy;
  const checks = policy && typeof policy === 'object' && 'checks' in policy
    ? (policy as { checks?: unknown }).checks
    : undefined;
  const failedPolicyRules = Array.isArray(checks)
    ? checks.flatMap(check => {
      if (!check || typeof check !== 'object') return [];
      const candidate = check as { rule?: unknown; pass?: unknown };
      return candidate.pass === false && typeof candidate.rule === 'string' ? [candidate.rule] : [];
    })
    : [];
  return {
    caseId: value.caseId,
    sequence: value.sequence,
    state: value.state,
    at: value.at,
    ...(failedPolicyRules.length > 0 ? { failedPolicyRules } : {})
  };
}
