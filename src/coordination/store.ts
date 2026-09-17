import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SupportRequest, CoordinationEvent } from "./types.ts";
export interface CoordinationLedger {
  requests: Record<string, SupportRequest>;
  events: CoordinationEvent[];
}
/** An isolated table allows this store to share the existing care database safely. */
export class CoordinationStore {
  private readonly db: DatabaseSync;
  constructor(path = ":memory:") {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS coordination_ledger (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)",
    );
    this.db
      .prepare("INSERT OR IGNORE INTO coordination_ledger VALUES (1, ?)")
      .run(JSON.stringify({ requests: {}, events: [] }));
  }
  transaction<T>(action: (ledger: CoordinationLedger) => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT body FROM coordination_ledger WHERE id=1")
        .get()!;
      const ledger = JSON.parse(String(row.body)) as CoordinationLedger;
      const result = action(ledger);
      if (result instanceof Promise)
        throw new Error("ASYNC_TRANSACTION_FORBIDDEN");
      this.db
        .prepare("UPDATE coordination_ledger SET body=? WHERE id=1")
        .run(JSON.stringify(ledger));
      this.db.exec("COMMIT");
      return structuredClone(result);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
}
