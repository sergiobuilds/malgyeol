import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanonicalCaseLedger } from '../../src/case-ledger/factory.ts';

test('canonical ledger factory allows explicit memory only outside production', async () => {
  const ledger = createCanonicalCaseLedger({ mode: 'memory', production: false });
  const result = await ledger.openCase({
    caseId: 'food_factory_memory_01', type: 'PHONE_CONNECTED', at: 1,
    actor: 'PHONE_PROVIDER', source: 'CLAWOPS', idempotencyKey: 'factory-memory-open-v1',
    data: {
      callIdHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      recordingMode: 'OFF', disclosureVersion: 'phone-disclosure-v1', evidenceClass: 'SYNTHETIC_DEMO'
    }
  });
  assert.equal(result.status, 'ACCEPTED');
  assert.throws(() => createCanonicalCaseLedger({ mode: undefined, production: false }), /explicitly/);
  assert.throws(() => createCanonicalCaseLedger({ mode: 'typo', production: false }), /explicitly/);
});

test('production factory fails closed on missing mode, memory and Firestore initialization failure', () => {
  assert.throws(() => createCanonicalCaseLedger({ mode: undefined, production: true }), /requires/);
  assert.throws(() => createCanonicalCaseLedger({ mode: 'memory', production: true }), /requires/);
  assert.throws(() => createCanonicalCaseLedger({
    mode: 'firestore', production: true, firestoreFactory() { throw new Error('credential failure'); }
  }), /credential failure/);
});
