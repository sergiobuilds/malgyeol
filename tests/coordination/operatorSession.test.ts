import { test } from "node:test";
import assert from "node:assert/strict";
import { OperatorSessions } from "../../src/coordination/operatorSession.ts";
const token = "operator-secret-".repeat(4);
const origin = "https://malgyeol.example";
const requestCookie = (cookie: string) => cookie.split(";", 1)[0];
test("login accepts only configured operator secret and emits opaque HttpOnly cookie", () => {
  const sessions = new OperatorSessions(token);
  assert.equal(sessions.login("wrong"), undefined);
  assert.equal(sessions.login(undefined), undefined);
  assert.equal(new OperatorSessions("short").login("short"), undefined);
  assert.equal(new OperatorSessions(undefined).login(token), undefined);
  const result = sessions.login(token, { secure: true })!;
  assert.ok(result.cookie.includes("HttpOnly"));
  assert.ok(result.cookie.includes("SameSite=Strict"));
  assert.ok(result.cookie.includes("Path=/api/coordination"));
  assert.ok(result.cookie.includes("Max-Age=28800"));
  assert.ok(result.cookie.includes("Secure"));
  assert.ok(!result.cookie.includes(token));
  assert.deepEqual(Object.keys(result), ["cookie"]);
  assert.equal(sessions.isValid(requestCookie(result.cookie)), true);
});
test("bearer authorization remains operator-specific", () => {
  const sessions = new OperatorSessions(token);
  assert.equal(sessions.bearerAuthorized(`Bearer ${token}`), true);
  assert.equal(sessions.bearerAuthorized("Bearer agent-secret"), false);
  assert.equal(sessions.bearerAuthorized(token), false);
  assert.equal(sessions.bearerAuthorized(undefined), false);
});
test("session expiry and logout invalidate access without exposing secrets", () => {
  let clock = 100;
  const sessions = new OperatorSessions(token, { now: () => clock });
  const first = requestCookie(sessions.login(token)!.cookie);
  clock += 8 * 60 * 60 * 1000 - 1;
  assert.equal(sessions.isValid(first), true);
  clock += 1;
  assert.equal(sessions.isValid(first), false);
  const second = requestCookie(sessions.login(token)!.cookie);
  assert.match(sessions.logout(second, { secure: true }), /Max-Age=0/);
  assert.equal(sessions.isValid(second), false);
  assert.equal(sessions.isValid("malgyeol_operator=unknown"), false);
});
test("cookie mutations require same origin while bearer authorization is independent", () => {
  const sessions = new OperatorSessions(token);
  const cookie = requestCookie(sessions.login(token)!.cookie);
  assert.equal(sessions.authenticate(cookie, origin, origin, "POST"), true);
  assert.equal(
    sessions.authenticate(cookie, "https://other.example", origin, "POST"),
    false,
  );
  assert.equal(sessions.authenticate(cookie, "null", origin, "DELETE"), false);
  assert.equal(
    sessions.authenticate(cookie, undefined, origin, "PATCH"),
    false,
  );
  assert.equal(sessions.authenticate(cookie, undefined, origin, "GET"), true);
  assert.equal(
    sessions.authenticate(cookie, "https://other.example", origin, "GET"),
    false,
  );
});
test("session count is bounded and ambiguous cookie headers are rejected", () => {
  const sessions = new OperatorSessions(token, { maxSessions: 2 });
  const first = requestCookie(sessions.login(token)!.cookie);
  const second = requestCookie(sessions.login(token)!.cookie);
  const third = requestCookie(sessions.login(token)!.cookie);
  assert.equal(sessions.isValid(first), false);
  assert.equal(sessions.isValid(second), true);
  assert.equal(sessions.isValid(third), true);
  assert.equal(sessions.isValid(`${second}; ${third}`), false);
  assert.equal(sessions.isValid(`other=x; ${third}`), true);
});
