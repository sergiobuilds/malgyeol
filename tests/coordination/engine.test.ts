import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoordinationEngine } from "../../src/coordination/engine.ts";
import { CoordinationStore } from "../../src/coordination/store.ts";
const input = {
  citizenRef: "role-a",
  summary: "조리가 어렵고 비누도 필요",
  district: "종로구",
  constraints: ["방문 어려움"],
  needs: [
    { description: "식사", category: "meal" },
    { description: "비누", category: "household" },
  ],
};
function fixture(path = ":memory:") {
  const store = new CoordinationStore(path);
  const engine = new CoordinationEngine(store);
  const request = engine.createRequest(input);
  return { store, engine, request };
}
function inquiry(
  f: ReturnType<typeof fixture>,
  n = 0,
  institutionId = "institution-a",
) {
  return f.engine.addInquiry(f.request.id, {
    needId: f.request.needs[n].id,
    institutionId,
    programId: "foodbank-market",
    contactPurpose: "이용 문의",
    questions: ["방문 외 수령 가능한가요?"],
  });
}
function consent(f: ReturnType<typeof fixture>) {
  f.engine.recordConsent(f.request.id, {
    purpose: "이용방법 문의",
    institutionIds: ["institution-a"],
    sharedFields: ["needs", "constraints"],
    allowCoordination: true,
  });
}
function answered(
  f: ReturnType<typeof fixture>,
  n = 0,
  requiresChoice = false,
) {
  const q = inquiry(f, n);
  const a = f.engine.startAttempt(f.request.id, q.id, `key-${n}`);
  f.engine.finishAttempt(f.request.id, a.id, { status: "completed" });
  return f.engine.recordAnswer(f.request.id, q.id, {
    outcome: "available",
    summary: "가능",
    conditions: ["오후"],
    nextAction: "상담 연결",
    requiresChoice,
  });
}
test("consent scope blocks execution without losing prepared inquiry", () => {
  const f = fixture();
  try {
    const q = inquiry(f);
    assert.throws(
      () => f.engine.startAttempt(f.request.id, q.id, "x"),
      /CONSENT_REQUIRED/,
    );
    consent(f);
    const other = inquiry(f, 1, "other");
    assert.throws(
      () => f.engine.startAttempt(f.request.id, other.id, "y"),
      /CONSENT_SCOPE/,
    );
    assert.equal(f.engine.getRequest(f.request.id)!.attempts.length, 0);
  } finally {
    f.store.close();
  }
});
test("global single call, idempotency and isolation", () => {
  const f = fixture();
  try {
    consent(f);
    const q = inquiry(f);
    const a = f.engine.startAttempt(f.request.id, q.id, "same");
    assert.deepEqual(f.engine.startAttempt(f.request.id, q.id, "same"), a);
    const other = f.engine.createRequest(input);
    f.engine.recordConsent(other.id, {
      purpose: "문의",
      institutionIds: ["institution-a"],
      sharedFields: [],
      allowCoordination: false,
    });
    const q2 = f.engine.addInquiry(other.id, {
      needId: other.needs[0].id,
      institutionId: "institution-a",
      programId: "care-sos",
      contactPurpose: "문의",
      questions: ["가능?"],
    });
    assert.throws(
      () => f.engine.startAttempt(other.id, q2.id, "second"),
      /CALL_ACTIVE/,
    );
    assert.throws(
      () => f.engine.finishAttempt(other.id, a.id, { status: "completed" }),
      /ATTEMPT_NOT_FOUND/,
    );
    assert.equal(f.engine.getRequest(other.id)!.attempts.length, 0);
  } finally {
    f.store.close();
  }
});
test("revision invalidates prepared inquiries and stops active stale result from completing need", () => {
  const f = fixture();
  try {
    consent(f);
    const q = inquiry(f);
    f.engine.reviseRequest(f.request.id, { district: "중구" });
    assert.throws(
      () => f.engine.startAttempt(f.request.id, q.id, "x"),
      /STALE_INQUIRY/,
    );
    const q2 = inquiry(f);
    const a = f.engine.startAttempt(f.request.id, q2.id, "y");
    f.engine.stopNeed(f.request.id, f.request.needs[0].id);
    f.engine.finishAttempt(f.request.id, a.id, { status: "completed" });
    assert.throws(
      () =>
        f.engine.recordAnswer(f.request.id, q2.id, {
          outcome: "available",
          summary: "가능",
          conditions: [],
          nextAction: "접수",
          requiresChoice: false,
        }),
      /NEED_STOPPED/,
    );
    assert.equal(f.engine.getRequest(f.request.id)!.needs[0].status, "stopped");
  } finally {
    f.store.close();
  }
});
test("unknown result cannot be retried while definite no-answer can", () => {
  const f = fixture();
  try {
    consent(f);
    const q = inquiry(f);
    const a = f.engine.startAttempt(f.request.id, q.id, "first");
    f.engine.finishAttempt(f.request.id, a.id, { status: "unknown" });
    assert.throws(
      () => f.engine.startAttempt(f.request.id, q.id, "retry"),
      /RESULT_UNKNOWN/,
    );
    assert.throws(
      () => f.engine.startAttempt(f.request.id, inquiry(f).id, "new-inquiry"),
      /RESULT_UNKNOWN/,
    );
  } finally {
    f.store.close();
  }
  const g = fixture();
  try {
    consent(g);
    const q = inquiry(g);
    const a = g.engine.startAttempt(g.request.id, q.id, "a");
    g.engine.finishAttempt(g.request.id, a.id, { status: "no-answer" });
    assert.equal(
      g.engine.startAttempt(g.request.id, q.id, "b").status,
      "started",
    );
  } finally {
    g.store.close();
  }
});
test("partial resolution and important changes preserve need boundaries", () => {
  const f = fixture();
  try {
    consent(f);
    answered(f, 0);
    const r = answered(f, 1, true);
    assert.equal(r.needs[0].status, "connected");
    assert.equal(r.needs[1].status, "awaiting-choice");
    const c = f.engine.recordChoice(r.id, r.needs[1].id, "화요일 오후 희망");
    assert.equal(c.needs[1].status, "open");
    assert.equal(c.needs[0].status, "connected");
    assert.equal(c.needs[1].choice, "화요일 오후 희망");
    assert.throws(
      () => f.engine.recordChoice(r.id, r.needs[0].id, "임의 선택"),
      /CHOICE_NOT_EXPECTED/,
    );
  } finally {
    f.store.close();
  }
});
test("answers require completed call and terminal result cannot be rewritten", () => {
  const f = fixture();
  try {
    consent(f);
    const q = inquiry(f);
    const answer = {
      outcome: "declined" as const,
      summary: "불가",
      conditions: [],
      nextAction: "대안",
      requiresChoice: false,
    };
    assert.throws(
      () => f.engine.recordAnswer(f.request.id, q.id, answer),
      /CALL_NOT_COMPLETED/,
    );
    const a = f.engine.startAttempt(f.request.id, q.id, "a");
    f.engine.finishAttempt(f.request.id, a.id, { status: "failed" });
    assert.throws(
      () => f.engine.finishAttempt(f.request.id, a.id, { status: "completed" }),
      /ATTEMPT_FINAL/,
    );
  } finally {
    f.store.close();
  }
});
test("sqlite restart restores requests events and active lock across connections", () => {
  const dir = mkdtempSync(join(tmpdir(), "coord-"));
  const path = join(dir, "state.sqlite");
  const f = fixture(path);
  consent(f);
  const q = inquiry(f);
  const a = f.engine.startAttempt(f.request.id, q.id, "persist");
  f.store.close();
  const store = new CoordinationStore(path);
  const engine = new CoordinationEngine(store);
  try {
    assert.equal(engine.getRequest(f.request.id)!.attempts[0].id, a.id);
    assert.ok(engine.events(f.request.id).length >= 4);
    const other = new CoordinationStore(path);
    try {
      assert.equal(
        new CoordinationEngine(other).getRequest(f.request.id)!.needs.length,
        2,
      );
    } finally {
      other.close();
    }
    engine.finishAttempt(f.request.id, a.id, { status: "completed" });
    engine.recordCallback(f.request.id, {
      status: "completed",
      summary: "다음 절차 안내",
    });
    assert.equal(engine.getRequest(f.request.id)!.callbacks.length, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
test("cross-connection active lock and request modification block stale answers", () => {
  const dir = mkdtempSync(join(tmpdir(), "coord-concurrent-"));
  const path = join(dir, "state.sqlite");
  const f = fixture(path);
  const secondStore = new CoordinationStore(path);
  const e = new CoordinationEngine(secondStore);
  try {
    consent(f);
    const q = inquiry(f);
    const a = f.engine.startAttempt(f.request.id, q.id, "active");
    const q2 = e.addInquiry(f.request.id, {
      needId: f.request.needs[1].id,
      institutionId: "institution-a",
      programId: "just-dream",
      contactPurpose: "문의",
      questions: ["재고?"],
    });
    assert.throws(
      () => e.startAttempt(f.request.id, q2.id, "other"),
      /CALL_ACTIVE/,
    );
    e.reviseRequest(f.request.id, { constraints: ["오전만 가능"] });
    f.engine.finishAttempt(f.request.id, a.id, { status: "completed" });
    assert.throws(
      () =>
        f.engine.recordAnswer(f.request.id, q.id, {
          outcome: "available",
          summary: "오후 가능",
          conditions: [],
          nextAction: "방문",
          requiresChoice: false,
        }),
      /STALE_INQUIRY/,
    );
    assert.equal(e.getRequest(f.request.id)!.needs[0].status, "open");
  } finally {
    secondStore.close();
    f.store.close();
    rmSync(dir, { recursive: true });
  }
});
test("idempotency keys cannot replay another request or inquiry", () => {
  const f = fixture();
  try {
    consent(f);
    const q = inquiry(f);
    const a = f.engine.startAttempt(f.request.id, q.id, "unique");
    f.engine.finishAttempt(f.request.id, a.id, { status: "no-answer" });
    const q2 = inquiry(f, 1);
    assert.throws(
      () => f.engine.startAttempt(f.request.id, q2.id, "unique"),
      /IDEMPOTENCY_CONFLICT/,
    );
    assert.equal(f.engine.getRequest(f.request.id)!.attempts.length, 1);
    assert.deepEqual(
      f.engine.startAttempt(f.request.id, q.id, "unique").id,
      a.id,
    );
  } finally {
    f.store.close();
  }
});
test("summary correction preserves connected needs and prepared call revision", () => {
  const f = fixture();
  try {
    consent(f);
    const resolved = answered(f, 0);
    const q = inquiry(f, 1);
    const corrected = f.engine.reviseRequest(f.request.id, {
      summary: "조리 지원 및 세면용품 필요",
    });
    assert.equal(corrected.needs[0].status, "connected");
    assert.equal(corrected.needs[0].result, resolved.needs[0].result);
    assert.equal(corrected.revision, resolved.revision);
    assert.equal(
      f.engine.startAttempt(f.request.id, q.id, "after-summary").status,
      "started",
    );
  } finally {
    f.store.close();
  }
});
test("identical operational patch is a no-op while changed district reopens routes", () => {
  const f = fixture();
  try {
    consent(f);
    const connected = answered(f, 0);
    f.engine.stopNeed(f.request.id, f.request.needs[1].id);
    const before = f.engine.getRequest(f.request.id)!;
    const events = f.engine.events(f.request.id).length;
    assert.deepEqual(
      f.engine.reviseRequest(f.request.id, {
        district: before.district,
        constraints: [...before.constraints],
      }),
      before,
    );
    assert.equal(f.engine.events(f.request.id).length, events);
    const changed = f.engine.reviseRequest(f.request.id, { district: "중구" });
    assert.equal(changed.revision, connected.revision + 1);
    assert.equal(changed.needs[0].status, "open");
    assert.equal(changed.needs[1].status, "stopped");
  } finally {
    f.store.close();
  }
});

test("manual retry prepares definite failures and starts a fresh attempt", () => {
  for (const status of ["failed", "no-answer"] as const) {
    const f = fixture();
    try {
      consent(f);
      const q = inquiry(f);
      const a = f.engine.startAttempt(f.request.id, q.id, "first");
      f.engine.finishAttempt(f.request.id, a.id, { status });
      const r = f.engine.retryInquiry(f.request.id, q.id);
      assert.equal(r.inquiries[0].status, "prepared");
      assert.equal(r.needs[0].status, "open");
      assert.equal(f.engine.events(r.id).at(-1)!.type, "retry-ready");
      assert.notEqual(f.engine.startAttempt(r.id, q.id, "retry").id, a.id);
    } finally {
      f.store.close();
    }
  }
});
test("manual retry rejects all non-failure statuses and stale or stopped work", () => {
  for (const status of [
    "prepared",
    "calling",
    "answered",
    "unknown",
    "cancelled",
    "stale",
  ] as const) {
    const f = fixture();
    try {
      consent(f);
      const q = inquiry(f);
      if (status !== "prepared") {
        const a = f.engine.startAttempt(f.request.id, q.id, "first");
        if (status === "unknown")
          f.engine.finishAttempt(f.request.id, a.id, { status: "unknown" });
        if (status === "answered") {
          f.engine.finishAttempt(f.request.id, a.id, { status: "completed" });
          f.engine.recordAnswer(f.request.id, q.id, {
            outcome: "available",
            summary: "가능",
            conditions: [],
            nextAction: "접수",
            requiresChoice: false,
          });
        }
        if (status === "cancelled" || status === "stale") {
          f.engine.finishAttempt(f.request.id, a.id, { status: "failed" });
          if (status === "cancelled") f.engine.stopNeed(f.request.id, q.needId);
          else f.engine.reviseRequest(f.request.id, { district: "중구" });
        }
      }
      const before = f.engine.getRequest(f.request.id);
      assert.throws(
        () => f.engine.retryInquiry(f.request.id, q.id),
        /RETRY_NOT_ALLOWED|RESULT_UNKNOWN|NEED_STOPPED|STALE_INQUIRY|CALL_ACTIVE/,
      );
      assert.deepEqual(f.engine.getRequest(f.request.id), before);
    } finally {
      f.store.close();
    }
  }
});
test("manual retry waits for other active calls and completed calls pending answer", () => {
  const f = fixture();
  try {
    consent(f);
    const q = inquiry(f);
    const a = f.engine.startAttempt(f.request.id, q.id, "first");
    f.engine.finishAttempt(f.request.id, a.id, { status: "no-answer" });
    const q2 = inquiry(f, 1);
    const a2 = f.engine.startAttempt(f.request.id, q2.id, "other");
    assert.throws(
      () => f.engine.retryInquiry(f.request.id, q.id),
      /CALL_ACTIVE/,
    );
    f.engine.finishAttempt(f.request.id, a2.id, { status: "completed" });
    assert.throws(
      () => f.engine.retryInquiry(f.request.id, q.id),
      /CALL_ACTIVE/,
    );
    f.engine.recordAnswer(f.request.id, q2.id, {
      outcome: "declined",
      summary: "불가",
      conditions: [],
      nextAction: "다른 경로",
      requiresChoice: false,
    });
    assert.equal(
      f.engine.retryInquiry(f.request.id, q.id).inquiries[0].status,
      "prepared",
    );
  } finally {
    f.store.close();
  }
});

test('intake key prevents duplicate creation and rejects reuse by another citizen', () => {
  const store = new CoordinationStore();
  const engine = new CoordinationEngine(store);
  try {
    const first = engine.createRequest({ ...input, intakeKey: 'call-test-intake-1' });
    const retry = engine.createRequest({ ...input, intakeKey: 'call-test-intake-1' });
    assert.equal(retry.id, first.id);
    assert.equal(engine.listRequests().length, 1);
    assert.throws(() => engine.createRequest({ ...input, citizenRef:'other', intakeKey:'call-test-intake-1' }), /INTAKE_KEY_CONFLICT/);
    assert.throws(() => engine.createRequest({ ...input, summary:'different', intakeKey:'call-test-intake-1' }), /INTAKE_KEY_CONFLICT/);
    assert.equal(engine.events(first.id).filter(e => e.type==='request-created').length, 1);
  } finally { store.close(); }
});


test("profile completion preserves chosen conditions and requires renewed sharing consent", () => {
  const f = fixture();
  try {
    consent(f);
    answered(f, 0);
    const before = f.engine.getRequest(f.request.id)!;
    const q = inquiry(f, 1);
    const profile = { name: "시험 시민", address: "서대문구 시험로 1" };
    const changed = f.engine.reviseRequest(f.request.id, { citizenProfile: profile });
    assert.deepEqual(changed.citizenProfile, profile);
    assert.equal(changed.citizenRef, before.citizenRef);
    assert.equal(changed.revision, before.revision + 1);
    assert.deepEqual(changed.needs, before.needs);
    assert.deepEqual(changed.consent, before.consent);
    assert.throws(() => f.engine.startAttempt(f.request.id, q.id, "stale-profile"));
    assert.equal(f.engine.reviseRequest(f.request.id, { citizenProfile: profile }).revision, changed.revision);
    f.engine.recordConsent(f.request.id, { ...changed.consent!, sharedFields: ["needs", "citizenProfile.name", "citizenProfile.address"] });
    const corrected = f.engine.reviseRequest(f.request.id, { citizenProfile: { ...profile, address: "서대문구 시험로 2" } });
    assert.deepEqual(corrected.consent!.sharedFields, ["needs", "citizenProfile.name"]);
    assert.deepEqual(corrected.needs, before.needs);
  } finally { f.store.close(); }
});
