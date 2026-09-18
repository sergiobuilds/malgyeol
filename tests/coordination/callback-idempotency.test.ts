import { test } from "node:test";
import assert from "node:assert/strict";
import { CoordinationEngine } from "../../src/coordination/engine.ts";
import { CoordinationStore } from "../../src/coordination/store.ts";

test("callback result reconciliation records each call exactly once", () => {
  const store = new CoordinationStore(":memory:");
  const engine = new CoordinationEngine(store);
  const input = { citizenRef: "c", summary: "식사", district: "서대문구", constraints: [],
    needs: [{ description: "식사", category: "meal" }] };
  const request = engine.createRequest(input);
  const callback = { status: "completed" as const, summary: "45분 뒤 무료 전달 조건 안내",
    idempotencyKey: "callback-hashed-call-1" };
  try {
    engine.recordCallback(request.id, callback);
    engine.recordCallback(request.id, callback);
    assert.equal(engine.getRequest(request.id)!.callbacks.length, 1);
    assert.equal(engine.events(request.id).filter(e => e.type === "callback-recorded").length, 1);
    assert.throws(() => engine.recordCallback(request.id, { ...callback, summary: "다른 결과" }), /IDEMPOTENCY_CONFLICT/);
    const other = engine.createRequest({ ...input, citizenRef: "other" });
    assert.throws(() => engine.recordCallback(other.id, callback), /IDEMPOTENCY_CONFLICT/);
    engine.recordCallback(request.id, { ...callback, idempotencyKey: "callback-hashed-call-2" });
    assert.equal(engine.getRequest(request.id)!.callbacks.length, 2);
    assert.throws(() => engine.recordCallback(request.id, { ...callback, idempotencyKey: "" }), /INVALID_CALLBACK/);
    engine.recordCallback(request.id, { status: "failed", summary: "기존 호출 호환" });
    assert.equal(engine.getRequest(request.id)!.callbacks.length, 3);
  } finally {
    store.close();
  }
});
