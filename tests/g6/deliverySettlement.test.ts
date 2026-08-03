import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DeliverySettlementService, createVerifiedReleaseInstruction } from '../../src/g6/deliverySettlement.ts';
import { PublicKey } from '@solana/web3.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

test('authorizes release only after two separate Gemini receipts match the same order', async () => {
  const service = new DeliverySettlementService({
    async analyzeDeliveryReceipt() {
      return {
        orderReference: 'ORDER-42',
        sku: 'DEMO_MEAL_01',
        quantity: 1,
        delivered: true,
        confidence: 0.98,
        safeSummary: '도시락 1개 배송 완료'
      };
    },
    async analyzeBeneficiaryConfirmation() {
      return {
        orderReference: 'ORDER-42',
        received: true,
        confidence: 0.97,
        safeSummary: '이용자 수령 확인'
      };
    }
  });

  const result = await service.verify({
    order: { orderReference: 'ORDER-42', sku: 'DEMO_MEAL_01', quantity: 1 },
    deliveryReceipt: { bytes: Buffer.from('synthetic-delivery-receipt'), mimeType: 'image/png' },
    beneficiaryConfirmation: { bytes: Buffer.from('synthetic-beneficiary-audio'), mimeType: 'audio/mpeg' }
  });

  assert.equal(result.status, 'VERIFIED_FOR_RELEASE');
  assert.equal(result.releaseAuthorization?.orderReference, 'ORDER-42');
  assert.equal(result.releaseAuthorization?.evidenceCommitment.length, 64);
  assert.deepEqual(result.privateEvidenceDigests, {
    deliveryReceiptSha256: sha256('synthetic-delivery-receipt'),
    beneficiaryConfirmationSha256: sha256('synthetic-beneficiary-audio')
  });
  assert.equal(JSON.stringify(result).includes('synthetic-delivery-receipt'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-beneficiary-audio'), false);
});

test('blocks release when either receipt belongs to another order', async () => {
  const service = new DeliverySettlementService({
    async analyzeDeliveryReceipt() {
      return {
        orderReference: 'ORDER-OTHER', sku: 'DEMO_MEAL_01', quantity: 1,
        delivered: true, confidence: 0.99, safeSummary: '배송 완료'
      };
    },
    async analyzeBeneficiaryConfirmation() {
      return {
        orderReference: 'ORDER-42', received: true,
        confidence: 0.99, safeSummary: '수령 확인'
      };
    }
  });

  const result = await service.verify({
    order: { orderReference: 'ORDER-42', sku: 'DEMO_MEAL_01', quantity: 1 },
    deliveryReceipt: { bytes: Buffer.from('receipt'), mimeType: 'image/png' },
    beneficiaryConfirmation: { bytes: Buffer.from('confirmation'), mimeType: 'audio/mpeg' }
  });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.releaseAuthorization, undefined);
  assert.match(result.reasons?.join(' ') ?? '', /order reference mismatch/i);
});

test('blocks release when the delivery receipt does not verify delivery', async () => {
  const service = new DeliverySettlementService({
    async analyzeDeliveryReceipt() {
      return {
        orderReference: 'ORDER-42', sku: 'DEMO_MEAL_01', quantity: 1,
        delivered: false, confidence: 0.99, safeSummary: '배송 확인 불가'
      };
    },
    async analyzeBeneficiaryConfirmation() {
      return {
        orderReference: 'ORDER-42', received: true,
        confidence: 0.99, safeSummary: '수령 확인'
      };
    }
  });

  const result = await service.verify({
    order: { orderReference: 'ORDER-42', sku: 'DEMO_MEAL_01', quantity: 1 },
    deliveryReceipt: { bytes: Buffer.from('receipt'), mimeType: 'image/png' },
    beneficiaryConfirmation: { bytes: Buffer.from('confirmation'), mimeType: 'audio/mpeg' }
  });

  assert.equal(result.status, 'BLOCKED');
  assert.match(result.reasons?.join(' ') ?? '', /delivery not verified/i);
});

test('blocks release when the beneficiary does not confirm receipt', async () => {
  const service = new DeliverySettlementService({
    async analyzeDeliveryReceipt() {
      return {
        orderReference: 'ORDER-42', sku: 'DEMO_MEAL_01', quantity: 1,
        delivered: true, confidence: 0.99, safeSummary: '배송 완료'
      };
    },
    async analyzeBeneficiaryConfirmation() {
      return {
        orderReference: 'ORDER-42', received: false,
        confidence: 0.99, safeSummary: '수령하지 못함'
      };
    }
  });

  const result = await service.verify({
    order: { orderReference: 'ORDER-42', sku: 'DEMO_MEAL_01', quantity: 1 },
    deliveryReceipt: { bytes: Buffer.from('receipt'), mimeType: 'image/png' },
    beneficiaryConfirmation: { bytes: Buffer.from('confirmation'), mimeType: 'audio/mpeg' }
  });

  assert.equal(result.status, 'BLOCKED');
  assert.match(result.reasons?.join(' ') ?? '', /beneficiary receipt not confirmed/i);
});

test('blocks release when the delivered item does not match the ordered SKU and quantity', async () => {
  const service = new DeliverySettlementService({
    async analyzeDeliveryReceipt() {
      return {
        orderReference: 'ORDER-42', sku: 'OTHER_ITEM', quantity: 2,
        delivered: true, confidence: 0.99, safeSummary: '다른 물품 배송'
      };
    },
    async analyzeBeneficiaryConfirmation() {
      return {
        orderReference: 'ORDER-42', received: true,
        confidence: 0.99, safeSummary: '수령 확인'
      };
    }
  });

  const result = await service.verify({
    order: { orderReference: 'ORDER-42', sku: 'DEMO_MEAL_01', quantity: 1 },
    deliveryReceipt: { bytes: Buffer.from('receipt'), mimeType: 'image/png' },
    beneficiaryConfirmation: { bytes: Buffer.from('confirmation'), mimeType: 'text/plain' }
  });

  assert.equal(result.status, 'BLOCKED');
  assert.match(result.reasons?.join(' ') ?? '', /delivered item mismatch/i);
});

test('blocks release when either Gemini analysis confidence is below threshold', async () => {
  const service = new DeliverySettlementService({
    async analyzeDeliveryReceipt() {
      return {
        orderReference: 'ORDER-42', sku: 'DEMO_MEAL_01', quantity: 1,
        delivered: true, confidence: 0.89, safeSummary: '배송 추정'
      };
    },
    async analyzeBeneficiaryConfirmation() {
      return {
        orderReference: 'ORDER-42', received: true,
        confidence: 0.99, safeSummary: '수령 확인'
      };
    }
  });

  const result = await service.verify({
    order: { orderReference: 'ORDER-42', sku: 'DEMO_MEAL_01', quantity: 1 },
    deliveryReceipt: { bytes: Buffer.from('receipt'), mimeType: 'image/png' },
    beneficiaryConfirmation: { bytes: Buffer.from('confirmation'), mimeType: 'text/plain' }
  });

  assert.equal(result.status, 'BLOCKED');
  assert.match(result.reasons?.join(' ') ?? '', /confidence below 0.90/i);
});

test('blocks release when Gemini evidence analysis fails', async () => {
  const service = new DeliverySettlementService({
    async analyzeDeliveryReceipt() {
      throw new Error('Vertex unavailable');
    },
    async analyzeBeneficiaryConfirmation() {
      return {
        orderReference: 'ORDER-42', received: true,
        confidence: 0.99, safeSummary: '수령 확인'
      };
    }
  });

  const result = await service.verify({
    order: { orderReference: 'ORDER-42', sku: 'DEMO_MEAL_01', quantity: 1 },
    deliveryReceipt: { bytes: Buffer.from('receipt'), mimeType: 'image/png' },
    beneficiaryConfirmation: { bytes: Buffer.from('confirmation'), mimeType: 'text/plain' }
  });

  assert.equal(result.status, 'BLOCKED');
  assert.match(result.reasons?.join(' ') ?? '', /Gemini evidence analysis failed/i);
});

test('builds the G5 release instruction only from a verified dual-receipt result', () => {
  const deliveryAuthority = new PublicKey('3N5hH8kZpHh6pT7Kr9zR4gBPK6wNYh5h8aN1M3v8FgX9');
  const merchant = new PublicKey('2VfUXyM7HMbL8K7Cq8xMhf3DqJj7wVQ5WCrjTzVtVtTe');
  const institution = new PublicKey('7GcwXQJ3nB5ZELgKk1K8H9dFvKQhRzYzTzvWwKZ7hD8w');
  const commitment = Buffer.alloc(32, 7);
  const verified = {
    status: 'VERIFIED_FOR_RELEASE' as const,
    releaseAuthorization: {
      orderReference: 'ORDER-42',
      evidenceCommitment: 'ab'.repeat(32)
    },
    privateEvidenceDigests: {
      deliveryReceiptSha256: 'cd'.repeat(32),
      beneficiaryConfirmationSha256: 'ef'.repeat(32)
    }
  };

  const instruction = createVerifiedReleaseInstruction({
    verification: verified,
    expectedOrderReference: 'ORDER-42',
    deliveryAuthority,
    merchant,
    institution,
    escrowCommitment: commitment
  });

  assert.equal(instruction.keys[0]?.pubkey.equals(deliveryAuthority), true);
  assert.deepEqual(instruction.data.subarray(8), commitment);
  assert.throws(() => createVerifiedReleaseInstruction({
    verification: { status: 'BLOCKED', privateEvidenceDigests: verified.privateEvidenceDigests },
    expectedOrderReference: 'ORDER-42',
    deliveryAuthority,
    merchant,
    institution,
    escrowCommitment: commitment
  }), /verified dual receipt required/i);
  assert.throws(() => createVerifiedReleaseInstruction({
    verification: verified,
    expectedOrderReference: 'ORDER-OTHER',
    deliveryAuthority,
    merchant,
    institution,
    escrowCommitment: commitment
  }), /order reference mismatch/i);
});
