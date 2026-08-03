import { createHash, createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const baseUrl = process.env.PUBLIC_BASE_URL;
const apiKey = process.env.CLAWOPS_API_KEY;
const accountId = process.env.CLAWOPS_ACCOUNT_ID;
const callId = process.env.CLAWOPS_CALL_ID;
const caseId = process.argv[2];
const outputPath = resolve(process.argv[3] ?? 'proof/u9-real-phone-success.json');
const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const phoneHmacSecret = process.env.PHONE_HMAC_SECRET ?? 'benefit-phone-case-v1';
if (!baseUrl || !apiKey || !accountId || !callId || !caseId) throw new Error('Missing phone proof environment');

const derivedCaseId = `case_${createHmac('sha256', phoneHmacSecret).update(callId).digest('hex').slice(0, 24)}`;
if (derivedCaseId !== caseId) throw new Error('ClawOps call does not derive the supplied caseId');
const callResponse = await fetch(`https://api.claw-ops.com/v1/accounts/${encodeURIComponent(accountId)}/calls/${encodeURIComponent(callId)}`, {
  headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' }
});
if (!callResponse.ok) throw new Error(`ClawOps call lookup returned ${callResponse.status}`);
const call = await callResponse.json();
if (call.status !== 'completed' || call.direction !== 'inbound' || !Number.isSafeInteger(call.duration) || call.duration < 1) {
  throw new Error('ClawOps call is not a completed inbound call');
}

const [health, publicCase, events] = await Promise.all([
  getJson(`${baseUrl}/health`),
  getJson(`${baseUrl}/api/cases/${encodeURIComponent(caseId)}?technical=1`),
  getJson(`${baseUrl}/api/cases/${encodeURIComponent(caseId)}/events`)
]);
if (health.ok !== true || publicCase.caseId !== caseId || publicCase.state !== 'ORDERED') throw new Error('Phone case is not ORDERED');
const proof = publicCase.technicalProof;
if (!proof?.settlementTransaction || proof.settlementTransaction.startsWith('SIMULATED_') || !publicCase.providerOrderId) {
  throw new Error('Phone case lacks live settlement or order evidence');
}
if (
  proof.x402ChallengeSha256?.length !== 64
  || proof.x402Asset !== '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
  || proof.x402Amount !== '1000000'
  || proof.x402PayTo !== proof.orderPda
) throw new Error('Phone case x402 evidence is incomplete');
const chain = await rpc('getTransaction', [proof.settlementTransaction, {
  commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0
}]);
if (!chain || chain.meta?.err || !Number.isSafeInteger(chain.slot)) throw new Error('Phone settlement is not confirmed');
const genesisHash = await rpc('getGenesisHash', []);
if (genesisHash !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') throw new Error('RPC is not Devnet');
const tracking = await getJson(`${baseUrl}/sandbox/orders/${encodeURIComponent(publicCase.providerOrderId)}/tracking`);
if (tracking.providerOrderId !== publicCase.providerOrderId || tracking.state !== 'ORDERED') throw new Error('Phone order tracking is not bound');
const states = events.map(event => event.state);
for (const required of ['CALL_CONNECTED', 'INTERPRETED', 'POLICY_CHECKING', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'PAYMENT_REQUIRED', 'PAID', 'ORDERED']) {
  if (!states.includes(required)) throw new Error(`Missing required phone state ${required}`);
}
const createdAt = new Date(call.dateCreated).getTime();
const updatedAt = new Date(call.dateUpdated).getTime();
if (!(createdAt <= publicCase.createdAt && publicCase.createdAt <= updatedAt + 5_000)) throw new Error('Call and case timestamps do not overlap');

const artifact = {
  schemaVersion: 'real-phone-x402-devnet-order-evidence-v1',
  capturedAt: new Date().toISOString(),
  status: 'PASS',
  claimBoundary: 'Real Korean inbound phone call through ClawOps and Gemini Live to Cloud Run, x402 Solana Devnet settlement, and self-owned merchant sandbox order.',
  caseId,
  sameCaseIdAcrossEvents: events.every(event => event.caseId === caseId),
  call: {
    provider: 'ClawOps',
    callIdSha256: createHash('sha256').update(callId).digest('hex'),
    status: call.status,
    direction: call.direction,
    durationSeconds: call.duration,
    sipResponseCode: call.sipResponseCode,
    hangupCause: call.hangupCause,
    recordingAvailable: Boolean(call.recordingUrl),
    createdAt: call.dateCreated,
    updatedAt: call.dateUpdated
  },
  states,
  confirmationObserved: states.includes('CONFIRMED'),
  payment: {
    transaction: proof.settlementTransaction,
    explorerUrl: proof.explorerUrl,
    slot: chain.slot,
    error: chain.meta?.err ?? null,
    genesisHash,
    challengeSha256: proof.x402ChallengeSha256,
    network: proof.x402Network,
    asset: proof.x402Asset,
    amount: proof.x402Amount,
    payTo: proof.x402PayTo,
    orderPda: proof.orderPda,
    vaultAta: proof.vaultAta,
    swigAccount: proof.swigAccount,
    limitedAuthority: proof.limitedAuthority
  },
  merchant: { providerOrderId: publicCase.providerOrderId, tracking },
  privacy: {
    rawPhoneNumberPersisted: false,
    rawAudioPersistedInArtifact: false,
    publicCaseContainsBeneficiaryRef: JSON.stringify(publicCase).includes('beneficiaryRef'),
    publicCaseContainsCallSidHash: JSON.stringify(publicCase).includes('callSidHash')
  }
};
if (artifact.privacy.publicCaseContainsBeneficiaryRef || artifact.privacy.publicCaseContainsCallSidHash) throw new Error('Public phone case leaked private identifiers');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputPath, caseId, transaction: proof.settlementTransaction, order: publicCase.providerOrderId })}\n`);

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}
async function rpc(method, params) {
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`RPC ${method} failed`);
  return body.result;
}
