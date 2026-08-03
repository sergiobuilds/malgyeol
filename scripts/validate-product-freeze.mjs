import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const path = resolve(process.argv[2] ?? "spec/product-freeze.json");
const spec = JSON.parse(await readFile(path, "utf8"));
const failures = [];
const requiredActors = ["FUNDER", "OPERATOR", "BENEFICIARY", "MERCHANT", "SETTLEMENT_AGENT", "AUDITOR"];
const requiredStates = ["BLOCKED", "ESCROWED", "DELIVERY_PENDING", "MANUAL_REVIEW", "RELEASED", "REFUNDED"];
const states = new Set(spec.state_machine?.states ?? []);
const actors = new Set((spec.actors ?? []).map((actor) => actor.id));
const transitions = spec.state_machine?.transitions ?? [];
const terminals = new Set(spec.state_machine?.terminal_states ?? []);

function require(condition, message) {
  if (!condition) failures.push(message);
}

require(typeof spec.ten_second_promise === "string" && spec.ten_second_promise.length <= 80, "ten_second_promise must exist and remain concise");
for (const actor of requiredActors) require(actors.has(actor), `missing actor ${actor}`);
for (const state of requiredStates) require(states.has(state), `missing state ${state}`);
for (const [from, to, condition] of transitions) {
  require(states.has(from), `transition has unknown source ${from}`);
  require(states.has(to), `transition has unknown target ${to}`);
  require(typeof condition === "string" && condition.length > 0, `transition ${from}->${to} lacks condition`);
}
for (const terminal of terminals) {
  require(!transitions.some(([from]) => from === terminal), `terminal state ${terminal} has outgoing transition`);
}

const invariantText = (spec.financial_invariants ?? []).join(" ");
require(invariantText.includes("zero value"), "BLOCKED zero-value invariant missing");
require(invariantText.includes("exactly one financial terminal state"), "dual-terminal exclusivity invariant missing");
require(invariantText.includes("order escrow"), "x402 escrow payTo invariant missing");
require(invariantText.includes("replayed"), "replay rejection invariant missing");

const onchain = new Set(spec.data_boundary?.onchain ?? []);
const offchain = new Set(spec.data_boundary?.offchain_private ?? []);
for (const privateField of ["beneficiary name", "phone number and address", "voice recording and transcript", "health or disability information"]) {
  require(offchain.has(privateField), `private boundary missing ${privateField}`);
  require(!onchain.has(privateField), `private field leaked onchain: ${privateField}`);
}

require((spec.claim_firewall?.allowed ?? []).length >= 4, "allowed claim set incomplete");
require((spec.claim_firewall?.forbidden ?? []).length >= 6, "forbidden claim set incomplete");
require(Object.keys(spec.official_gate_mapping ?? {}).length === 4, "official four-axis mapping incomplete");
require(typeof spec.competitor_boundary === "string" && spec.competitor_boundary.includes("ARUSKITA") && spec.competitor_boundary.includes("BuyDesk"), "competitor boundary incomplete");

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ result: "fail", failures }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  result: "pass",
  actors: actors.size,
  states: states.size,
  transitions: transitions.length,
  terminal_states: [...terminals],
  onchain_fields: onchain.size,
  offchain_private_fields: offchain.size,
  official_axes: Object.keys(spec.official_gate_mapping)
}, null, 2)}\n`);
