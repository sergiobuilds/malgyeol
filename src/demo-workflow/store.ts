import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DemoCase } from './types.ts';
export class DemoWorkflowStore {
  private readonly db: DatabaseSync;
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS phone_demo_workflows (call_id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  }
  read(callId: string): DemoCase | undefined { const row = this.db.prepare('SELECT body FROM phone_demo_workflows WHERE call_id=?').get(callId); return row ? JSON.parse(String(row.body)) as DemoCase : undefined; }
  update<T>(callId: string, mutate: (current: DemoCase | undefined) => { next?: DemoCase; result: T }): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const response = mutate(this.read(callId));
      if (response instanceof Promise) throw new Error('ASYNC_TRANSACTION_FORBIDDEN');
      if (response.next) this.db.prepare('INSERT INTO phone_demo_workflows VALUES (?,?) ON CONFLICT(call_id) DO UPDATE SET body=excluded.body').run(callId, JSON.stringify(response.next));
      this.db.exec('COMMIT'); return structuredClone(response.result);
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  list(): DemoCase[] { return this.db.prepare('SELECT body FROM phone_demo_workflows').all().map(row => JSON.parse(String(row.body)) as DemoCase); }
  close(): void { this.db.close(); }
}
