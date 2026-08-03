import { spawn } from 'node:child_process';

const expectedTypes = ['PHONE_CONNECTED', 'INTENT_INTERPRETED', 'POLICY_EVALUATED', 'USER_CONFIRMED'];

if (process.argv[2] === '--reader') {
  const caseId = process.argv[3];
  if (!caseId) throw new Error('Reader requires caseId');
  const { createCanonicalCaseLedger } = await import('../src/case-ledger/factory.ts');
  const ledger = createCanonicalCaseLedger({ mode: 'firestore', production: true });
  const aggregate = await ledger.getAggregate(caseId);
  const events = await ledger.events(caseId);
  process.stdout.write(`${JSON.stringify({ aggregate, events })}\n`);
  process.exit(0);
}

const baseUrl = required('AGENT_API_BASE_URL').replace(/\/$/, '');
const secret = required('AGENT_TOOL_SECRET');
const callId = `final-ledger-${Date.now()}-${process.pid}`;
const authorization = `Bearer ${secret}`;

const beginBody = { callId };
const begin = await request('/internal/food-agent/begin', beginBody);
const caseId = stringField(begin, 'caseId');
const beginReplay = await request('/internal/food-agent/begin', beginBody);
assertEqual(stringField(beginReplay, 'caseId'), caseId, 'begin replay caseId');

const interpretBody = { caseId, text: '잡곡 보내줘' };
const interpreted = await request('/internal/food-agent/interpret', interpretBody);
assertEqual(stringField(interpreted, 'state'), 'CANDIDATES_READY', 'interpret state');
await request('/internal/food-agent/interpret', interpretBody);

const selectBody = { caseId, candidateNumber: 1, quantity: 1 };
const selected = await request('/internal/food-agent/select', selectBody);
assertEqual(stringField(selected, 'state'), 'AWAITING_CONFIRMATION', 'select state');
await request('/internal/food-agent/select', selectBody);

const confirmationBody = { caseId, digit: '1' };
const confirmed = await request('/internal/food-agent/confirmation', confirmationBody);
assertEqual(stringField(confirmed, 'state'), 'CONFIRMED', 'confirmation state');
await request('/internal/food-agent/confirmation', confirmationBody);

const firstRead = await readInNewProcess(caseId);
const secondRead = await readInNewProcess(caseId);
validateReadback(firstRead, caseId);
validateReadback(secondRead, caseId);
assertEqual(JSON.stringify(firstRead), JSON.stringify(secondRead), 'restart readback stability');

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  writerPath: 'factory.ts -> app.ts -> internal food-agent HTTP -> phoneFoodCoordinator',
  readerPath: 'new process -> factory.ts -> FirestoreCanonicalCaseRepository',
  caseId,
  eventTypes: firstRead.events.map(event => event.type),
  sequence: firstRead.aggregate.sequence,
  tailHash: firstRead.aggregate.lastEventHash,
  retriesAddedEvents: false
}, null, 2)}\n`);

async function request(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function readInNewProcess(caseId) {
  const child = spawn(process.execPath, ['--import', 'tsx', new URL(import.meta.url).pathname, '--reader', caseId], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', chunk => stdout.push(chunk));
  child.stderr.on('data', chunk => stderr.push(chunk));
  const code = await new Promise(resolve => child.once('close', resolve));
  if (code !== 0) throw new Error(`reader failed: ${Buffer.concat(stderr).toString('utf8')}`);
  return JSON.parse(Buffer.concat(stdout).toString('utf8'));
}

function validateReadback(value, caseId) {
  if (!value?.aggregate || !Array.isArray(value.events)) throw new Error('Reader did not return aggregate and events');
  assertEqual(value.aggregate.caseId, caseId, 'aggregate caseId');
  assertEqual(value.aggregate.sequence, expectedTypes.length, 'aggregate sequence');
  assertEqual(JSON.stringify(value.events.map(event => event.type)), JSON.stringify(expectedTypes), 'event order');
  if (!value.events.every(event => event.caseId === caseId)) throw new Error('Event caseId changed');
  for (let index = 1; index < value.events.length; index += 1) {
    assertEqual(value.events[index].previousHash, value.events[index - 1].eventHash, `previous hash ${index}`);
  }
  assertEqual(value.aggregate.lastEventHash, value.events.at(-1).eventHash, 'aggregate tail hash');
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function stringField(value, key) {
  const field = value?.[key];
  if (typeof field !== 'string') throw new Error(`Response missing ${key}`);
  return field;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}
