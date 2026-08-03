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
    paymentIntentId?: string;
    settlementTransaction?: string;
    settlementProofBaseUnits?: number;
    explorerUrl?: string;
    orderCommitment?: string;
    orderPda?: string;
    vaultAta?: string;
    escrowProgramId?: string;
    mint?: string;
    initializeTransaction?: string;
    escrowExpiresAt?: number;
    x402ChallengeSha256?: string;
    paymentResponseSha256?: string;
    x402Network?: string;
    x402Asset?: string;
    x402Amount?: string;
    x402PayTo?: string;
    swigAccount?: string;
    limitedAuthority?: string;
    rpcSlot?: number;
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
      ...(value.paymentIntentId ? { paymentIntentId: value.paymentIntentId } : {}),
      ...(value.settlementTransaction ? {
        settlementTransaction: value.settlementTransaction,
        ...(value.settlementTransaction.startsWith('SIMULATED_') ? {} : {
          explorerUrl: `https://explorer.solana.com/tx/${encodeURIComponent(value.settlementTransaction)}?cluster=devnet`
        })
      } : {}),
      ...(value.settlementProofBaseUnits === undefined ? {} : { settlementProofBaseUnits: value.settlementProofBaseUnits }),
      ...(value.orderCommitment ? { orderCommitment: value.orderCommitment } : {}),
      ...(value.orderPda ? { orderPda: value.orderPda } : {}),
      ...(value.vaultAta ? { vaultAta: value.vaultAta } : {}),
      ...(value.escrowProgramId ? { escrowProgramId: value.escrowProgramId } : {}),
      ...(value.mint ? { mint: value.mint } : {}),
      ...(value.initializeTransaction ? { initializeTransaction: value.initializeTransaction } : {}),
      ...(value.escrowExpiresAt === undefined ? {} : { escrowExpiresAt: value.escrowExpiresAt }),
      ...(value.x402ChallengeSha256 ? { x402ChallengeSha256: value.x402ChallengeSha256 } : {}),
      ...(value.paymentResponseSha256 ? { paymentResponseSha256: value.paymentResponseSha256 } : {}),
      ...(value.x402Network ? { x402Network: value.x402Network } : {}),
      ...(value.x402Asset ? { x402Asset: value.x402Asset } : {}),
      ...(value.x402Amount ? { x402Amount: value.x402Amount } : {}),
      ...(value.x402PayTo ? { x402PayTo: value.x402PayTo } : {}),
      ...(value.swigAccount ? { swigAccount: value.swigAccount } : {}),
      ...(value.limitedAuthority ? { limitedAuthority: value.limitedAuthority } : {}),
      ...(value.rpcSlot === undefined ? {} : { rpcSlot: value.rpcSlot }),
      disclaimer: '해커톤 샌드박스의 정산 기술증명이며 실제 정부자금 또는 환율 연동 결제가 아님'
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
