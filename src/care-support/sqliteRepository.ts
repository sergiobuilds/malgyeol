import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { appendEvent, type CareLedger, type CareRequestRepository } from './repository.ts';
import type { CareRequest, CareRequestEvent } from './types.ts';

/** Small pilot ledger: one atomic snapshot includes quota, calls, requests and events. */
export class SqliteCareRequestRepository implements CareRequestRepository {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS care_ledger (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');
    this.db.prepare('INSERT OR IGNORE INTO care_ledger VALUES (1, ?)').run(JSON.stringify({ requests: {}, history: {}, calls: {} }));
  }
  transaction<T>(operation: (ledger: CareLedger) => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT body FROM care_ledger WHERE id=1').get()!;
      const ledger = JSON.parse(String(row.body)) as CareLedger;
      const result = operation(ledger);
      if (result instanceof Promise) throw new Error('ASYNC_LEDGER_TRANSACTION_NOT_ALLOWED');
      this.db.prepare('UPDATE care_ledger SET body=? WHERE id=1').run(JSON.stringify(ledger));
      this.db.exec('COMMIT');
      return structuredClone(result);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async get(caseId: string) { return this.transaction(ledger => ledger.requests[caseId]); }
  async list() { return this.transaction(ledger => Object.values(ledger.requests).sort((a, b) => b.updatedAt - a.updatedAt)); }
  async save(request: CareRequest, event: Omit<CareRequestEvent, 'sequence'>) { this.transaction(ledger => appendEvent(ledger, request, event)); }
  async events(caseId: string) { return this.transaction(ledger => ledger.history[caseId] ?? []); }
  close() { this.db.close(); }
}
