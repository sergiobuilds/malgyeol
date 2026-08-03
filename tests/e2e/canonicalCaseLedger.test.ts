import test from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalCaseLedger } from '../../src/case-ledger/ledger.ts';
import { InMemoryCanonicalCaseRepository } from '../../src/case-ledger/inMemoryRepository.ts';
import { sha256 } from '../../src/case-ledger/canonicalHash.ts';
import type { CanonicalCaseAggregate, CanonicalCaseState, CanonicalLedgerCommand, SafeEventData } from '../../src/case-ledger/types.ts';

const caseId = 'food_canonical_case_0001';
const policyHash = sha256('policy-v1');
const conditionHash = sha256('condition-v1');

function setup() {
  const repository = new InMemoryCanonicalCaseRepository();
  return { repository, ledger: new CanonicalCaseLedger(repository) };
}

test('canonical ledger completes twelve ordered states on one immutable hash chain', async () => {
  const { ledger } = setup();
  await open(ledger, caseId);
  await advance(ledger, caseId, 'INTENT_INTERPRETED', intentData());
  await advance(ledger, caseId, 'POLICY_EVALUATED', policyData());
  await advance(ledger, caseId, 'USER_CONFIRMED', confirmationData());
  await advance(ledger, caseId, 'INSTITUTION_APPROVED', approvalData(1, conditionHash, 100_000));
  await advance(ledger, caseId, 'X402_REQUIRED', x402Data(1, conditionHash));
  await advance(ledger, caseId, 'DEVNET_PROOF_FINALIZED', devnetData(1, conditionHash));
  await advance(ledger, caseId, 'SUPPLIER_ORDER_SUBMITTED', {
    approvalRevision: 1, conditionHash, supplierRequestHash: sha256('supplier-request')
  });
  await advance(ledger, caseId, 'SUPPLIER_CONFIRMED', {
    externalOrderId: '585999', externalOrderNoHash: sha256('260802000001'), supplierState: 'PREPARING'
  });
  await advance(ledger, caseId, 'SHIPPED', { carrierCode: 'CJ', trackingNumberHash: sha256('tracking') });
  await advance(ledger, caseId, 'DELIVERED', { carrierCode: 'CJ', trackingNumberHash: sha256('tracking'), carrierDeliveredAt: 20_000 });
  await advance(ledger, caseId, 'RECIPIENT_CONFIRMED', { receiptConfirmationHash: sha256('received'), confirmationMethod: 'PORTAL' });

  const events = await ledger.events(caseId);
  assert.equal(events.length, 12);
  assert.equal(events.every(event => event.caseId === caseId), true);
  assert.deepEqual(events.map(event => event.state), [
    'PHONE_CONNECTED', 'INTENT_INTERPRETED', 'POLICY_EVALUATED', 'USER_CONFIRMED',
    'INSTITUTION_APPROVED', 'X402_REQUIRED', 'DEVNET_PROOF_FINALIZED', 'SUPPLIER_ORDER_SUBMITTED',
    'SUPPLIER_CONFIRMED', 'SHIPPED', 'DELIVERED', 'RECIPIENT_CONFIRMED'
  ]);
  assert.equal(events.slice(1).every((event, index) => event.previousHash === events[index]?.eventHash), true);
  assert.equal((await ledger.getAggregate(caseId))?.currentState, 'RECIPIENT_CONFIRMED');
});

test('same semantic command replays despite a new transport timestamp', async () => {
  const { ledger } = setup();
  await open(ledger, caseId);
  const aggregate = required(await ledger.getAggregate(caseId));
  const command = commandFor(caseId, 'INTENT_INTERPRETED', intentData(), aggregate, 'intent-retry');
  const first = await ledger.advance(command);
  const replay = await ledger.advance({ ...command, at: command.at + 5000 });
  assert.equal(first.status, 'ACCEPTED');
  assert.equal(replay.status, 'REPLAYED');
  assert.equal(replay.event?.eventId, first.event?.eventId);
  assert.equal(replay.event?.at, first.event?.at);
  assert.equal((await ledger.events(caseId)).length, 2);
});

test('jump, stale tail and concurrent loser append safe atomic failure events', async () => {
  const { ledger } = setup();
  await open(ledger, caseId);
  const initial = required(await ledger.getAggregate(caseId));
  const jump = await ledger.advance(commandFor(caseId, 'POLICY_EVALUATED', policyData(), initial, 'jump-command'));
  assert.equal(jump.reasonCode, 'INVALID_TRANSITION');
  assert.equal(jump.event?.type, 'STEP_FAILED');
  const afterJump = required(await ledger.getAggregate(caseId));
  const first = commandFor(caseId, 'INTENT_INTERPRETED', intentData(), afterJump, 'concurrent-a');
  const second = commandFor(caseId, 'INTENT_INTERPRETED', intentData(), afterJump, 'concurrent-b');
  const results = await Promise.all([ledger.advance(first), ledger.advance(second)]);
  assert.deepEqual(results.map(result => result.status).sort(), ['ACCEPTED', 'REJECTED']);
  const failed = results.find(result => result.status === 'REJECTED');
  assert.equal(failed?.reasonCode, 'STALE_TAIL');
  const replay = await ledger.advance({ ...second, at: second.at + 99 });
  assert.equal(['REPLAYED', 'REJECTED'].includes(replay.status), true);
  const events = await ledger.events(caseId);
  assert.equal(events.slice(1).every((event, index) => event.previousHash === events[index]?.eventHash), true);
});

test('PII is rejected before payload hashing and leaves only safe fixed metadata', async () => {
  const { ledger } = setup();
  await open(ledger, caseId);
  const aggregate = required(await ledger.getAggregate(caseId));
  const privateValue = '서울시 종로구 테스트로 1 010-1234-5678';
  const rawHash = sha256(privateValue);
  const result = await ledger.advance({
    ...commandFor(caseId, 'INTENT_INTERPRETED', intentData(), aggregate, 'pii-rejection'),
    data: { address: privateValue } as unknown as SafeEventData
  });
  assert.equal(result.reasonCode, 'PII_OR_SECRET_REJECTED');
  const serialized = JSON.stringify(await ledger.events(caseId));
  assert.equal(serialized.includes(privateValue), false);
  assert.equal(serialized.includes(rawHash), false);
  assert.deepEqual(Object.keys(result.event?.data ?? {}).sort(), ['attempt', 'component', 'reasonCode', 'retryable', 'targetState']);
});

test('PII-shaped values are rejected even when placed under an allowlisted field', async () => {
  const { ledger } = setup();
  await open(ledger, caseId);
  const aggregate = required(await ledger.getAggregate(caseId));
  const privateValue = '010-1234-5678';
  const result = await ledger.advance({
    ...commandFor(caseId, 'INTENT_INTERPRETED', intentData(), aggregate, 'pii-allowed-key'),
    data: { ...intentData(), intent: privateValue }
  });
  assert.equal(result.reasonCode, 'PII_OR_SECRET_REJECTED');
  assert.equal(JSON.stringify(await ledger.events(caseId)).includes(privateValue), false);
});

test('required evidence and valid actor authority are enforced before state advancement', async () => {
  const { ledger } = setup();
  await open(ledger, caseId);
  const aggregate = required(await ledger.getAggregate(caseId));
  const missingEvidence = await ledger.advance({
    ...commandFor(caseId, 'INTENT_INTERPRETED', intentData(), aggregate, 'missing-evidence'),
    data: { intentHash: sha256('잡곡'), intent: 'PURCHASE' }
  });
  assert.equal(missingEvidence.reasonCode, 'INVALID_EVENT_SCHEMA');
  assert.equal(missingEvidence.aggregate?.currentState, 'PHONE_CONNECTED');

  const afterFailure = required(await ledger.getAggregate(caseId));
  const falseAuthority = await ledger.advance({
    ...commandFor(caseId, 'INTENT_INTERPRETED', intentData(), afterFailure, 'false-authority'),
    actor: 'SYSTEM', source: 'SYSTEM'
  });
  assert.equal(falseAuthority.reasonCode, 'INVALID_AUTHORITY');
  assert.equal(falseAuthority.aggregate?.currentState, 'PHONE_CONNECTED');
});

test('secret-shaped values are rejected under allowlisted fields before hashing', async () => {
  const { ledger } = setup();
  await open(ledger, caseId);
  const aggregate = required(await ledger.getAggregate(caseId));
  const secret = ['sk', 'proj', 'ABCDEF1234567890'].join('-');
  const result = await ledger.advance({
    ...commandFor(caseId, 'INTENT_INTERPRETED', intentData(), aggregate, 'secret-allowed-key'),
    data: { ...intentData(), model: secret }
  });
  assert.equal(result.reasonCode, 'PII_OR_SECRET_REJECTED');
  assert.equal(JSON.stringify(await ledger.events(caseId)).includes(secret), false);
  for (const commonSecret of [
    'ghp_abcdefghijklmnopqrstuvwxyz123456',
    'AKIAABCDEFGHIJKLMNOP',
    'ya29.a0AfH6SMBabcdefghijklmnopqrstuv',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123456'
  ]) {
    const current = required(await ledger.getAggregate(caseId));
    const rejected = await ledger.advance({
      ...commandFor(caseId, 'INTENT_INTERPRETED', intentData(), current, `secret-${commonSecret.slice(0, 4)}`),
      data: { ...intentData(), model: commonSecret }
    });
    assert.equal(rejected.reasonCode, 'PII_OR_SECRET_REJECTED');
  }
});

test('x402, Devnet and delivery events cannot advance with empty evidence', async () => {
  const { ledger } = setup();
  await open(ledger, caseId);
  await advance(ledger, caseId, 'INTENT_INTERPRETED', intentData());
  await advance(ledger, caseId, 'POLICY_EVALUATED', policyData());
  await advance(ledger, caseId, 'USER_CONFIRMED', confirmationData());
  await advance(ledger, caseId, 'INSTITUTION_APPROVED', approvalData(1, conditionHash, 100_000));
  const x402 = await advance(ledger, caseId, 'X402_REQUIRED', {});
  assert.equal(x402.reasonCode, 'INVALID_EVENT_SCHEMA');
  assert.equal(x402.aggregate?.currentState, 'INSTITUTION_APPROVED');

  await advance(ledger, caseId, 'X402_REQUIRED', x402Data(1, conditionHash));
  const devnet = await advance(ledger, caseId, 'DEVNET_PROOF_FINALIZED', {});
  assert.equal(devnet.reasonCode, 'INVALID_EVENT_SCHEMA');
  assert.equal(devnet.aggregate?.currentState, 'X402_REQUIRED');

  await advance(ledger, caseId, 'DEVNET_PROOF_FINALIZED', devnetData(1, conditionHash));
  await advance(ledger, caseId, 'SUPPLIER_ORDER_SUBMITTED', {
    approvalRevision: 1, conditionHash, supplierRequestHash: sha256('supplier-request')
  });
  await advance(ledger, caseId, 'SUPPLIER_CONFIRMED', {
    externalOrderId: '585999', externalOrderNoHash: sha256('260802000001'), supplierState: 'PREPARING'
  });
  await advance(ledger, caseId, 'SHIPPED', { carrierCode: 'CJ', trackingNumberHash: sha256('tracking') });
  const delivered = await advance(ledger, caseId, 'DELIVERED', {});
  assert.equal(delivered.reasonCode, 'INVALID_EVENT_SCHEMA');
  assert.equal(delivered.aggregate?.currentState, 'SHIPPED');
});

test('failed or structurally invalid Devnet evidence cannot finalize a proof state', async () => {
  const { ledger } = setup();
  await open(ledger, caseId);
  await advance(ledger, caseId, 'INTENT_INTERPRETED', intentData());
  await advance(ledger, caseId, 'POLICY_EVALUATED', policyData());
  await advance(ledger, caseId, 'USER_CONFIRMED', confirmationData());
  await advance(ledger, caseId, 'INSTITUTION_APPROVED', approvalData(1, conditionHash, 100_000));
  await advance(ledger, caseId, 'X402_REQUIRED', x402Data(1, conditionHash));
  const failed = await advance(ledger, caseId, 'DEVNET_PROOF_FINALIZED', {
    ...devnetData(1, conditionHash), transactionSignature: 'abcDEF123', rpcErr: 'ProgramError'
  });
  assert.equal(failed.reasonCode, 'INVALID_EVENT_SCHEMA');
  assert.equal(failed.aggregate?.currentState, 'X402_REQUIRED');
});

test('x402 requires the exact Circle Solana Devnet USDC mint and a 32-byte destination', async () => {
  const { ledger } = setup();
  await open(ledger, caseId);
  await advance(ledger, caseId, 'INTENT_INTERPRETED', intentData());
  await advance(ledger, caseId, 'POLICY_EVALUATED', policyData());
  await advance(ledger, caseId, 'USER_CONFIRMED', confirmationData());
  await advance(ledger, caseId, 'INSTITUTION_APPROVED', approvalData(1, conditionHash, 100_000));
  const wrongMint = await advance(ledger, caseId, 'X402_REQUIRED', {
    ...x402Data(1, conditionHash), asset: '11111111111111111111111111111111'
  });
  assert.equal(wrongMint.reasonCode, 'INVALID_EVENT_SCHEMA');
  assert.equal(wrongMint.aggregate?.currentState, 'INSTITUTION_APPROVED');
});

test('PII mutation of an accepted idempotency key records a separate safe failure once', async () => {
  const { ledger } = setup();
  await open(ledger, caseId);
  const initial = required(await ledger.getAggregate(caseId));
  const accepted = commandFor(caseId, 'INTENT_INTERPRETED', intentData(), initial, 'shared-idempotency');
  assert.equal((await ledger.advance(accepted)).status, 'ACCEPTED');
  const privateValue = '서울시 종로구 테스트로 1';
  const unsafe = { ...accepted, at: accepted.at + 1, data: { address: privateValue } as unknown as SafeEventData };
  const rejected = await ledger.advance(unsafe);
  const replay = await ledger.advance({ ...unsafe, at: unsafe.at + 1 });
  assert.equal(rejected.reasonCode, 'PII_OR_SECRET_REJECTED');
  assert.equal(replay.status, 'REPLAYED');
  assert.equal(replay.event?.eventId, rejected.event?.eventId);
  assert.equal((await ledger.events(caseId)).length, 3);
  assert.equal(JSON.stringify(await ledger.events(caseId)).includes(privateValue), false);
});

test('post-Devnet condition change requires reapproval, x402 rebound and refinalized proof', async () => {
  const { ledger } = setup();
  await progressToDevnet(ledger, caseId);
  await auxiliary(ledger, caseId, 'APPROVAL_INVALIDATED', {
    reasonCode: 'PRICE_CHANGED', targetState: 'SUPPLIER_ORDER_SUBMITTED', component: 'POLICY_APPROVAL', retryable: true, attempt: 1
  });
  const blocked = await advance(ledger, caseId, 'SUPPLIER_ORDER_SUBMITTED', {
    approvalRevision: 1, conditionHash, supplierRequestHash: sha256('stale-order')
  });
  assert.equal(blocked.reasonCode, 'APPROVAL_EXPIRED');

  const conditionV2 = sha256('condition-v2');
  await auxiliary(ledger, caseId, 'POLICY_REEVALUATED', policyData(conditionV2));
  await auxiliary(ledger, caseId, 'USER_RECONFIRMED', confirmationData('voice-v2'));
  await auxiliary(ledger, caseId, 'INSTITUTION_REAPPROVED', approvalData(2, conditionV2, 200_000));
  await auxiliary(ledger, caseId, 'X402_REBOUND', x402Data(2, conditionV2));
  const beforeProof = await advance(ledger, caseId, 'SUPPLIER_ORDER_SUBMITTED', {
    approvalRevision: 2, conditionHash: conditionV2, supplierRequestHash: sha256('early-order')
  });
  assert.equal(beforeProof.reasonCode, 'APPROVAL_BINDING_MISMATCH');
  await auxiliary(ledger, caseId, 'DEVNET_PROOF_REFINALIZED', devnetData(2, conditionV2));
  const submitted = await advance(ledger, caseId, 'SUPPLIER_ORDER_SUBMITTED', {
    approvalRevision: 2, conditionHash: conditionV2, supplierRequestHash: sha256('current-order')
  });
  assert.equal(submitted.status, 'ACCEPTED');
  assert.equal(submitted.aggregate?.approvalRevision, 2);
  assert.equal(submitted.aggregate?.devnetApprovalRevision, 2);
});

async function progressToDevnet(ledger: CanonicalCaseLedger, id: string): Promise<void> {
  await open(ledger, id);
  await advance(ledger, id, 'INTENT_INTERPRETED', intentData());
  await advance(ledger, id, 'POLICY_EVALUATED', policyData());
  await advance(ledger, id, 'USER_CONFIRMED', confirmationData());
  await advance(ledger, id, 'INSTITUTION_APPROVED', approvalData(1, conditionHash, 100_000));
  await advance(ledger, id, 'X402_REQUIRED', x402Data(1, conditionHash));
  await advance(ledger, id, 'DEVNET_PROOF_FINALIZED', devnetData(1, conditionHash));
}

async function open(ledger: CanonicalCaseLedger, id: string) {
  return ledger.openCase({
    caseId: id, type: 'PHONE_CONNECTED', at: 1000, actor: 'PHONE_PROVIDER', source: 'CLAWOPS',
    idempotencyKey: `${id}:phone:v1`,
    data: {
      callIdHash: sha256('call'), recordingMode: 'OFF', disclosureVersion: 'phone-disclosure-v1',
      evidenceClass: 'SYNTHETIC_DEMO'
    }
  });
}

async function advance(ledger: CanonicalCaseLedger, id: string, type: CanonicalCaseState, data: SafeEventData) {
  const aggregate = required(await ledger.getAggregate(id));
  return ledger.advance(commandFor(id, type, data, aggregate, `${type.toLowerCase()}:${aggregate.sequence + 1}`));
}

async function auxiliary(ledger: CanonicalCaseLedger, id: string, type: Parameters<CanonicalCaseLedger['appendAuxiliary']>[0]['type'], data: SafeEventData) {
  const aggregate = required(await ledger.getAggregate(id));
  const authority = auxiliaryAuthority(type);
  return ledger.appendAuxiliary({
    caseId: id, type, data, at: 2000 + aggregate.sequence, actor: authority.actor, source: authority.source,
    idempotencyKey: `${id}:${type.toLowerCase()}:${aggregate.sequence + 1}`,
    expectedPreviousHash: aggregate.lastEventHash
  });
}

function commandFor(
  id: string,
  type: CanonicalCaseState,
  data: SafeEventData,
  aggregate: CanonicalCaseAggregate,
  suffix: string
): CanonicalLedgerCommand {
  return {
    caseId: id, type, data, at: 2000 + aggregate.sequence, actor: actorFor(type), source: sourceFor(type),
    idempotencyKey: `${id}:${suffix}`, expectedPreviousHash: aggregate.lastEventHash
  };
}

function intentData(): SafeEventData {
  return {
    intentHash: sha256('잡곡 보내줘'), intent: 'PURCHASE', model: 'gemini-2.5-flash',
    responseIdHash: sha256('vertex-response-id')
  };
}
function policyData(condition = conditionHash): SafeEventData {
  return {
    policySnapshotHash: policyHash, conditionHash: condition, goodsNoHash: sha256('GRAIN-100'),
    amountKrw: 12_300, shippingFeeKrw: 4000, inStock: true, domestic: true
  };
}
function confirmationData(seed = 'dtmf'): SafeEventData {
  return { confirmationHash: sha256(seed), confirmationMethod: 'DTMF' };
}
function approvalData(revision: number, condition: string, validUntil: number): SafeEventData {
  return { approvalRevision: revision, approvalValidUntil: validUntil, conditionHash: condition };
}
function x402Data(revision: number, condition: string): SafeEventData {
  return {
    approvalRevision: revision, conditionHash: condition, x402RequirementHash: sha256(`x402-${revision}`),
    asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    destination: '3spuSFQeVyHMh6BUxcvb1nbLmV5MdgwLNfTaS9RgEJzG', amountBaseUnits: 1_000_000,
    nonceHash: sha256(`nonce-${revision}`)
  };
}
function devnetData(revision: number, condition: string): SafeEventData {
  return {
    approvalRevision: revision, conditionHash: condition,
    transactionSignature: '52ythTGiyTLbsQVQRmHJmHtVVDzVW9UrPxvjcF1Mq3Sb9bGZD7gZyHsawr5RaY7PMfL5URdsSF2T6mBTejqUCXBX',
    rpcSlot: 480332621, rpcBlockTime: 1_785_000_000, rpcFee: 5000, rpcErr: null
  };
}

function actorFor(type: CanonicalCaseState): CanonicalLedgerCommand['actor'] {
  if (type === 'INTENT_INTERPRETED') return 'GEMINI';
  if (type === 'POLICY_EVALUATED') return 'POLICY_ENGINE';
  if (type === 'USER_CONFIRMED' || type === 'RECIPIENT_CONFIRMED') return 'RECIPIENT';
  if (type === 'INSTITUTION_APPROVED') return 'INSTITUTION';
  if (type === 'X402_REQUIRED') return 'X402_FACILITATOR';
  if (type === 'DEVNET_PROOF_FINALIZED') return 'SOLANA_RPC';
  if (type.includes('SUPPLIER')) return 'SUPPLIER';
  return 'CARRIER';
}
function sourceFor(type: CanonicalCaseState): CanonicalLedgerCommand['source'] {
  if (type === 'INTENT_INTERPRETED') return 'VERTEX_GEMINI';
  if (type === 'POLICY_EVALUATED') return 'DETERMINISTIC_POLICY';
  if (type === 'USER_CONFIRMED') return 'DTMF';
  if (type === 'INSTITUTION_APPROVED') return 'INSTITUTION_WORKFLOW';
  if (type === 'X402_REQUIRED') return 'X402';
  if (type === 'DEVNET_PROOF_FINALIZED') return 'SOLANA_DEVNET';
  if (type.includes('SUPPLIER')) return 'SPECIAL_OFFER';
  if (type === 'RECIPIENT_CONFIRMED') return 'RECIPIENT_PORTAL';
  return 'CARRIER_READBACK';
}

function auxiliaryAuthority(type: Parameters<CanonicalCaseLedger['appendAuxiliary']>[0]['type']): Pick<CanonicalLedgerCommand, 'actor' | 'source'> {
  if (type === 'POLICY_REEVALUATED') return { actor: 'POLICY_ENGINE', source: 'DETERMINISTIC_POLICY' };
  if (type === 'USER_RECONFIRMED') return { actor: 'RECIPIENT', source: 'DTMF' };
  if (type === 'INSTITUTION_REAPPROVED') return { actor: 'INSTITUTION', source: 'INSTITUTION_WORKFLOW' };
  if (type === 'X402_REBOUND') return { actor: 'X402_FACILITATOR', source: 'X402' };
  if (type === 'DEVNET_PROOF_REFINALIZED') return { actor: 'SOLANA_RPC', source: 'SOLANA_DEVNET' };
  return { actor: 'SYSTEM', source: 'SYSTEM' };
}

function required(value: CanonicalCaseAggregate | undefined): CanonicalCaseAggregate {
  assert.ok(value);
  return value;
}
