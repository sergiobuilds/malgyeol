import test from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalCaseLedger } from '../../src/case-ledger/ledger.ts';
import { InMemoryCanonicalCaseRepository } from '../../src/case-ledger/inMemoryRepository.ts';
import { projectCanonicalCase } from '../../src/case-ledger/projections.ts';
import { sha256 } from '../../src/case-ledger/canonicalHash.ts';

test('recipient, institution, supplier, judge and chain projections expose separate allowlists', async () => {
  const repository = new InMemoryCanonicalCaseRepository();
  const ledger = new CanonicalCaseLedger(repository);
  const caseId = 'food_projection_case_01';
  await ledger.openCase({
    caseId, type: 'PHONE_CONNECTED', at: 1, actor: 'PHONE_PROVIDER', source: 'CLAWOPS',
    idempotencyKey: `${caseId}:open:v1`,
    data: {
      callIdHash: sha256('call'), recordingMode: 'OFF', disclosureVersion: 'phone-disclosure-v1',
      evidenceClass: 'SYNTHETIC_DEMO'
    }
  });
  const aggregate = await ledger.getAggregate(caseId);
  assert.ok(aggregate);
  await ledger.advance({
    caseId, type: 'INTENT_INTERPRETED', at: 2, actor: 'AI_INTERPRETER', source: 'AI_PROVIDER',
    idempotencyKey: `${caseId}:intent:v1`, expectedPreviousHash: aggregate.lastEventHash,
    data: {
      intentHash: sha256('잡곡'), intent: 'PURCHASE', model: 'model-test',
      responseIdHash: sha256('provider-response-id')
    }
  });
  const current = await ledger.getAggregate(caseId);
  assert.ok(current);
  const events = await ledger.events(caseId);
  const projections = ['recipient', 'institution', 'supplier', 'judge', 'chain'].map(role =>
    projectCanonicalCase(current, events, role as Parameters<typeof projectCanonicalCase>[2])
  );
  assert.deepEqual(projections.map(value => value.role), ['recipient', 'institution', 'supplier', 'judge', 'chain']);
  assert.notDeepEqual(projections[0]?.data, projections[1]?.data);
  assert.notDeepEqual(projections[1]?.data, projections[2]?.data);
  assert.equal((projections[3]?.data as { factClass?: string }).factClass, 'SYNTHETIC_DEMO');
  const serialized = JSON.stringify(projections);
  for (const forbidden of ['address', 'cellphone', 'telephone', 'rawAudio', 'transcript', 'beneficiaryName', 'recipientName', 'secret']) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
  const chain = projections[4];
  assert.equal(JSON.stringify(chain).includes('intentHash'), false);
  assert.equal(JSON.stringify(chain).includes('callIdHash'), false);
});
