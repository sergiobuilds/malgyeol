import { Firestore } from '@google-cloud/firestore';
import { FirestoreCanonicalCaseRepository } from './firestoreRepository.ts';
import { InMemoryCanonicalCaseRepository } from './inMemoryRepository.ts';
import { CanonicalCaseLedger } from './ledger.ts';

export interface CanonicalLedgerFactoryOptions {
  mode: string | undefined;
  production: boolean;
  firestoreFactory?: () => Firestore;
}

export function createCanonicalCaseLedger(options: CanonicalLedgerFactoryOptions): CanonicalCaseLedger {
  if (options.production && options.mode !== 'firestore') {
    throw new Error('Production canonical case ledger requires CASE_REPOSITORY=firestore');
  }
  if (options.mode === 'firestore') {
    const db = (options.firestoreFactory ?? (() => new Firestore()))();
    return new CanonicalCaseLedger(new FirestoreCanonicalCaseRepository(db));
  }
  if (!options.production && options.mode === 'memory') {
    return new CanonicalCaseLedger(new InMemoryCanonicalCaseRepository());
  }
  throw new Error('Canonical case ledger mode must be explicitly firestore or memory');
}
