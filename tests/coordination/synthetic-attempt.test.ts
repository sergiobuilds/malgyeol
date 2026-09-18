import { test } from "node:test";
import assert from "node:assert/strict";
import { CoordinationStore } from "../../src/coordination/store.ts";
import { CoordinationEngine } from "../../src/coordination/engine.ts";

test("explicit synthetic presentation attempts do not lock real calls; unmarked attempts do", () => {
  const store = new CoordinationStore(":memory:");
  const engine = new CoordinationEngine(store);
  function prepared() {
    const r = engine.createRequest({ citizenRef: "c", summary: "식사", district: "서대문구", constraints: [], needs: [{ description: "식사", category: "meal" }] });
    engine.recordConsent(r.id, { purpose: "문의", institutionIds: ["i"], sharedFields: ["needs"], allowCoordination: false });
    const q = engine.addInquiry(r.id, { needId: r.needs[0].id, institutionId: "i", programId: "just-dream", contactPurpose: "문의", questions: ["재고"] });
    return { r, q };
  }
  try {
    const seed = prepared();
    const a = engine.startAttempt(seed.r.id, seed.q.id, "presentation");
    const real = prepared();
    assert.throws(() => engine.startAttempt(real.r.id, real.q.id, "actual"), /CALL_ACTIVE/);
    store.transaction(l => { delete l.requests[seed.r.id].attempts[0].source; });
    assert.throws(() => engine.startAttempt(real.r.id, real.q.id, "actual"), /CALL_ACTIVE/);
    store.transaction(l => { l.requests[seed.r.id].attempts[0].source = "synthetic"; });
    const actual = engine.startAttempt(real.r.id, real.q.id, "actual");
    assert.equal(actual.source, "live");
    assert.equal(engine.getRequest(seed.r.id)!.attempts[0].status, "started");
    assert.equal(engine.getRequest(seed.r.id)!.attempts[0].id, a.id);
    const third = prepared();
    assert.throws(() => engine.startAttempt(third.r.id, third.q.id, "third"), /CALL_ACTIVE/);
  } finally { store.close(); }
});
