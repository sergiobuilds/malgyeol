import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoordinationStore } from "../../src/coordination/store.ts";
import { CoordinationEngine } from "../../src/coordination/engine.ts";
import { createCoordinationRoutes } from "../../src/coordination/routes.ts";
const profile = {
  name: "김영희",
  address: "서울특별시 성동구 왕십리로 123, 201호",
  age: 78,
  household: "1인 가구",
  mobility: "장거리 보행 어려움",
  contactPreference: "오후 전화",
};
const details = {
  quantity: "도시락 1인분",
  requestedDate: "2026-09-21",
  deliveryMethod: "방문 전달",
};
const input = {
  citizenRef: "person-a",
  summary: "식사 지원 요청",
  district: "성동구",
  constraints: [],
  citizenProfile: profile,
  needs: [
    { description: "조리된 식사", category: "식사", requestDetails: details },
  ],
};

test("profile and need details persist with clone isolation across restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "coord-profile-"));
  const path = join(dir, "store.sqlite");
  const store = new CoordinationStore(path);
  const engine = new CoordinationEngine(store);
  const data = structuredClone(input);
  const r = engine.createRequest(data);
  assert.deepEqual(r.citizenProfile, profile);
  assert.deepEqual(r.needs[0].requestDetails, details);
  data.citizenProfile.name = "다른 이름";
  r.citizenProfile!.address = "다른 주소";
  r.needs[0].requestDetails!.quantity = "99개";
  store.close();
  const restored = new CoordinationStore(path);
  try {
    const result = new CoordinationEngine(restored).getRequest(r.id)!;
    assert.deepEqual(result.citizenProfile, profile);
    assert.deepEqual(result.needs[0].requestDetails, details);
  } finally {
    restored.close();
    rmSync(dir, { recursive: true });
  }
});
test("exact same-person history excludes similarly named or prefixed people", () => {
  const store = new CoordinationStore();
  const engine = new CoordinationEngine(store);
  try {
    const a = engine.createRequest(input);
    const a2 = engine.createRequest({ ...input, summary: "생필품 요청" });
    engine.createRequest({ ...input, citizenRef: "person-ab" });
    engine.createRequest({ ...input, citizenRef: "person-b" });
    assert.deepEqual(
      new Set(engine.listRequests("person-a").map((r) => r.id)),
      new Set([a.id, a2.id]),
    );
    assert.equal(engine.listRequests("none").length, 0);
    assert.equal(engine.listRequests().length, 4);
    for (const ref of ["", "  ", "x".repeat(161)])
      assert.throws(() => engine.listRequests(ref), /INVALID_CITIZEN_REF/);
  } finally {
    store.close();
  }
});
test("engine rejects malformed profile and details without storing partial requests", () => {
  const store = new CoordinationStore();
  const engine = new CoordinationEngine(store);
  try {
    for (const invalid of [
      { name: "", address: "주소" },
      { ...profile, age: -1 },
      { ...profile, age: 131 },
      { ...profile, age: 1.5 },
      { ...profile, age: "78" },
      { ...profile, address: "x".repeat(501) },
      { ...profile, contactPreference: [] },
      { ...profile, extra: "hidden" },
      null,
    ]) {
      assert.throws(
        () =>
          engine.createRequest({ ...input, citizenProfile: invalid } as never),
        /INVALID_PROFILE/,
      );
    }
    for (const invalid of [
      { quantity: "" },
      { quantity: "x".repeat(201) },
      { requestedDate: 123 },
      { deliveryMethod: [] },
      { unexpected: "hidden" },
      null,
    ]) {
      assert.throws(
        () =>
          engine.createRequest({
            ...input,
            needs: [
              {
                description: "식사",
                category: "식사",
                requestDetails: invalid,
              },
            ],
          } as never),
        /INVALID_REQUEST_DETAILS/,
      );
    }
    assert.equal(engine.listRequests().length, 0);
    const legacy = engine.createRequest({
      citizenRef: "legacy",
      summary: "문의",
      district: "중구",
      constraints: [],
      needs: [{ description: "식사", category: "식사" }],
    });
    assert.equal(legacy.citizenProfile, undefined);
    assert.equal(legacy.needs[0].requestDetails, undefined);
  } finally {
    store.close();
  }
});
test("authenticated routes preserve details and validate exact history filter", () => {
  const store = new CoordinationStore();
  const engine = new CoordinationEngine(store);
  const token = "profile-test-operator-".repeat(3);
  const route = createCoordinationRoutes(engine, { operator: token });
  const call = (
    method: string,
    path: string,
    body: Record<string, unknown> = {},
    auth = `Bearer ${token}`,
  ) => route(method, new URL(path, "http://local"), auth, body)!;
  try {
    assert.equal(call("POST", "/api/coordination/requests", input).status, 201);
    call("POST", "/api/coordination/requests", {
      ...input,
      citizenRef: "person-ab",
    });
    assert.equal(
      call("GET", "/api/coordination/requests?citizenRef=person-a", {}, "")
        .status,
      403,
    );
    const result = call("GET", "/api/coordination/requests?citizenRef=person-a")
      .body as { requests: ReturnType<CoordinationEngine["listRequests"]> };
    assert.equal(result.requests.length, 1);
    assert.deepEqual(result.requests[0].citizenProfile, profile);
    assert.deepEqual(result.requests[0].needs[0].requestDetails, details);
    for (const query of [
      "citizenRef=",
      "citizenRef=%20",
      "citizenRef=person-a&citizenRef=person-ab",
    ])
      assert.equal(
        call("GET", "/api/coordination/requests?" + query).status,
        400,
      );
    assert.equal(
      call("POST", "/api/coordination/requests", {
        ...input,
        citizenProfile: { ...profile, age: 131 },
      }).status,
      400,
    );
    assert.equal(
      call("POST", "/api/coordination/requests", {
        ...input,
        needs: [
          {
            description: "식사",
            category: "식사",
            requestDetails: { quantity: [] },
          },
        ],
      }).status,
      400,
    );
  } finally {
    store.close();
  }
});
