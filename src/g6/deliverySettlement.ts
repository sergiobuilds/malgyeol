import { createHash } from 'node:crypto';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { createReleaseInstruction } from '../g5/escrowClient.ts';

export interface DeliveryReceiptAnalysis {
  orderReference: string;
  sku: string;
  quantity: number;
  delivered: boolean;
  confidence: number;
  safeSummary: string;
}

export interface BeneficiaryConfirmationAnalysis {
  orderReference: string;
  received: boolean;
  confidence: number;
  safeSummary: string;
}

export interface DeliveryEvidenceInterpreter {
  analyzeDeliveryReceipt(bytes: Uint8Array, mimeType: string): Promise<DeliveryReceiptAnalysis>;
  analyzeBeneficiaryConfirmation(bytes: Uint8Array, mimeType: string): Promise<BeneficiaryConfirmationAnalysis>;
}

interface EvidenceInput {
  bytes: Uint8Array;
  mimeType: string;
}

interface VerifyInput {
  order: {
    orderReference: string;
    sku: string;
    quantity: number;
  };
  deliveryReceipt: EvidenceInput;
  beneficiaryConfirmation: EvidenceInput;
}

export interface DeliveryVerificationResult {
  status: 'VERIFIED_FOR_RELEASE' | 'BLOCKED';
  reasons?: string[];
  releaseAuthorization?: {
    orderReference: string;
    evidenceCommitment: string;
  };
  privateEvidenceDigests: {
    deliveryReceiptSha256: string;
    beneficiaryConfirmationSha256: string;
  };
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class DeliverySettlementService {
  constructor(private readonly interpreter: DeliveryEvidenceInterpreter) {}

  async verify(input: VerifyInput): Promise<DeliveryVerificationResult> {
    const deliveryReceiptSha256 = digest(input.deliveryReceipt.bytes);
    const beneficiaryConfirmationSha256 = digest(input.beneficiaryConfirmation.bytes);
    let delivery: DeliveryReceiptAnalysis;
    let beneficiary: BeneficiaryConfirmationAnalysis;
    try {
      delivery = await this.interpreter.analyzeDeliveryReceipt(
        input.deliveryReceipt.bytes,
        input.deliveryReceipt.mimeType
      );
      beneficiary = await this.interpreter.analyzeBeneficiaryConfirmation(
        input.beneficiaryConfirmation.bytes,
        input.beneficiaryConfirmation.mimeType
      );
    } catch {
      return {
        status: 'BLOCKED',
        reasons: ['Gemini evidence analysis failed'],
        privateEvidenceDigests: { deliveryReceiptSha256, beneficiaryConfirmationSha256 }
      };
    }
    const reasons: string[] = [];
    if (delivery.orderReference !== input.order.orderReference || beneficiary.orderReference !== input.order.orderReference) {
      reasons.push('Order reference mismatch');
    }
    if (!delivery.delivered) reasons.push('Delivery not verified');
    if (!beneficiary.received) reasons.push('Beneficiary receipt not confirmed');
    if (delivery.sku !== input.order.sku || delivery.quantity !== input.order.quantity) {
      reasons.push('Delivered item mismatch');
    }
    if (delivery.confidence < 0.9 || beneficiary.confidence < 0.9) {
      reasons.push('Gemini confidence below 0.90');
    }
    if (reasons.length > 0) {
      return {
        status: 'BLOCKED',
        reasons,
        privateEvidenceDigests: { deliveryReceiptSha256, beneficiaryConfirmationSha256 }
      };
    }
    const evidenceCommitment = createHash('sha256').update(JSON.stringify({
      version: 'delivery-dual-receipt-v1',
      orderReference: input.order.orderReference,
      deliveryReceiptSha256,
      beneficiaryConfirmationSha256,
      delivery,
      beneficiary
    })).digest('hex');

    return {
      status: 'VERIFIED_FOR_RELEASE',
      releaseAuthorization: {
        orderReference: input.order.orderReference,
        evidenceCommitment
      },
      privateEvidenceDigests: {
        deliveryReceiptSha256,
        beneficiaryConfirmationSha256
      }
    };
  }
}

export function createVerifiedReleaseInstruction(input: {
  verification: DeliveryVerificationResult;
  expectedOrderReference: string;
  deliveryAuthority: PublicKey;
  merchant: PublicKey;
  institution: PublicKey;
  escrowCommitment: Uint8Array;
}): TransactionInstruction {
  if (input.verification.status !== 'VERIFIED_FOR_RELEASE' || !input.verification.releaseAuthorization) {
    throw new Error('Verified dual receipt required');
  }
  if (input.verification.releaseAuthorization.orderReference !== input.expectedOrderReference) {
    throw new Error('Order reference mismatch');
  }
  return createReleaseInstruction(
    input.deliveryAuthority,
    input.merchant,
    input.institution,
    input.escrowCommitment
  );
}
