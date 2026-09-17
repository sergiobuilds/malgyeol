import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const baseUrl = process.env.PUBLIC_BASE_URL;
const apiKey = process.env.CLAWOPS_API_KEY;
const accountId = process.env.CLAWOPS_ACCOUNT_ID;
const agentSecret = process.env.AGENT_TOOL_SECRET;
const callId = process.env.CLAWOPS_CALL_ID;
const recordingsRoot = process.env.CLAWOPS_RECORDING_PATH ?? '/tmp/benefit-call-recordings';
const outputPath = resolve(process.argv[2] ?? 'proof/u13-real-food-phone-demo.json');

if (!baseUrl || !apiKey || !accountId || !agentSecret || !callId) {
  throw new Error('Missing phone demo proof environment');
}

const caseId = `food_${createHash('sha256').update(`clawops-food-v1:${callId}`).digest('hex').slice(0, 24)}`;
const callResponse = await fetch(
  `https://api.claw-ops.com/v1/accounts/${encodeURIComponent(accountId)}/calls/${encodeURIComponent(callId)}`,
  { headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' } }
);
if (!callResponse.ok) throw new Error(`ClawOps call lookup returned ${callResponse.status}`);
const call = await callResponse.json();
if (call.status !== 'completed' || call.direction !== 'inbound' || !Number.isSafeInteger(call.duration) || call.duration < 1) {
  throw new Error('ClawOps call is not a completed inbound call');
}

const statusResponse = await fetch(`${baseUrl}/internal/food-agent/status/${encodeURIComponent(caseId)}`, {
  headers: { authorization: `Bearer ${agentSecret}`, accept: 'application/json' }
});
if (!statusResponse.ok) throw new Error(`Food phone status returned ${statusResponse.status}`);
const status = await statusResponse.json();
if (
  status.caseId !== caseId
  || status.state !== 'CONFIRMED'
  || status.phoneStatus !== 'CONFIRMED'
  || status.budgetSource !== 'SYNTHETIC_DEMO'
  || status.paymentExecuted !== false
  || status.supplierOrderExecuted !== false
) {
  throw new Error(`Food phone demo did not finish at the safe confirmation boundary: ${JSON.stringify(status)}`);
}

const audio = {};
for (const track of ['in', 'out', 'mix']) {
  const path = resolve(recordingsRoot, callId, `${track}.wav`);
  const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
  if (metadata.size <= 44) throw new Error(`${track}.wav has no recorded audio`);
  audio[track] = {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: metadata.size,
    durationSeconds: Number(((metadata.size - 44) / 16_000).toFixed(3))
  };
}

const eventsResponse = await fetch(`${baseUrl}/api/cases/${encodeURIComponent(caseId)}/events`);
const events = eventsResponse.ok ? await eventsResponse.json() : [];
const stateSequence = Array.isArray(events) ? events.map(event => event.state).filter(Boolean) : [];
const artifact = {
  schemaVersion: 'real-inbound-food-phone-demo-evidence-v1',
  capturedAt: new Date().toISOString(),
  status: 'PASS',
  claimBoundary: 'A real Korean inbound phone call used an external AI interpreter and live supplier catalog readback through DTMF confirmation. The synthetic demo budget prevented payment and supplier ordering.',
  caseId,
  call: {
    provider: 'ClawOps',
    callIdSha256: createHash('sha256').update(callId).digest('hex'),
    status: call.status,
    direction: call.direction,
    durationSeconds: call.duration,
    hangupCause: call.hangupCause ?? null,
    createdAt: call.dateCreated,
    updatedAt: call.dateUpdated
  },
  interaction: {
    state: status.state,
    phoneStatus: status.phoneStatus,
    product: status.product,
    budgetSource: status.budgetSource,
    confirmationMethod: 'DTMF',
    stateSequence
  },
  executionBoundary: {
    paymentExecuted: status.paymentExecuted,
    supplierOrderExecuted: status.supplierOrderExecuted,
    existingLiveSupplierOrderIsSeparateCase: true
  },
  originalAudio: audio,
  privacy: {
    rawCallIdPersisted: false,
    rawPhoneNumberPersisted: false,
    rawAudioCommittedToRepository: false
  }
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputPath, caseId, durationSeconds: call.duration, product: status.product?.name })}\n`);
