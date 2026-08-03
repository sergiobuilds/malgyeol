import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const baseUrl = process.env.PUBLIC_BASE_URL;
const caseId = process.argv[2];
const outputPath = resolve(process.argv[3] ?? 'proof/u8-cloud-live-devnet-case.json');
const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const cloudRunRevision = process.env.CLOUD_RUN_REVISION;
if (!baseUrl || !caseId) throw new Error('PUBLIC_BASE_URL and caseId are required');

const [health, publicCase, events] = await Promise.all([
  getJson(`${baseUrl}/health`),
  getJson(`${baseUrl}/api/cases/${encodeURIComponent(caseId)}?technical=1`),
  getJson(`${baseUrl}/api/cases/${encodeURIComponent(caseId)}/events`)
]);
if (health.ok !== true || publicCase.caseId !== caseId || publicCase.state !== 'ORDERED') {
  throw new Error('Cloud case is not a healthy ORDERED case');
}
const proof = publicCase.technicalProof;
if (!proof?.settlementTransaction || proof.settlementTransaction.startsWith('SIMULATED_')) {
  throw new Error('Case does not contain a live settlement transaction');
}
if (proof.settlementProofBaseUnits !== 1_000_000 || !publicCase.providerOrderId) {
  throw new Error('Case amount or merchant order is not bound');
}
if (
  proof.x402ChallengeSha256?.length !== 64
  || proof.x402Asset !== '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
  || proof.x402Amount !== '1000000'
  || proof.x402PayTo !== proof.orderPda
  || !proof.swigAccount
  || !proof.limitedAuthority
) throw new Error('x402 challenge or limited authority evidence is incomplete');
const chain = await rpc('getTransaction', [proof.settlementTransaction, {
  commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0
}]);
if (!chain || chain.meta?.err || !Number.isSafeInteger(chain.slot)) throw new Error('Devnet transaction is not confirmed');
const genesisHash = await rpc('getGenesisHash', []);
if (genesisHash !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') throw new Error('RPC is not Devnet');
const tracking = await getJson(`${baseUrl}/sandbox/orders/${encodeURIComponent(publicCase.providerOrderId)}/tracking`);
if (tracking.sandbox !== true || tracking.providerOrderId !== publicCase.providerOrderId || tracking.state !== 'ORDERED') {
  throw new Error('Merchant tracking is not bound to the case order');
}
const unauthorizedMutation = await fetch(`${baseUrl}/sandbox/orders`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    caseId: 'case_unauthorized_probe', sku: 'ASSISTIVE_STAND_AID_01', quantity: 1,
    merchantId: 'DEMO_ACCESS_STORE', programAmountKrw: 380_000, paymentIntentId: 'unauthorized_probe'
  })
});
if (unauthorizedMutation.status !== 401) throw new Error('Merchant mutation endpoint is not protected');
const states = events.map(event => event.state);
for (const required of ['CALL_CONNECTED', 'POLICY_CHECKING', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'PAYMENT_REQUIRED', 'PAID', 'ORDERED']) {
  if (!states.includes(required)) throw new Error(`Missing required state ${required}`);
}

const artifact = {
  schemaVersion: 'cloud-agent-x402-devnet-e2e-v1',
  capturedAt: new Date().toISOString(),
  status: 'PASS',
  claimBoundary: 'Authenticated synthetic agent bridge on Cloud Run, not a real phone call.',
  caseId,
  sameCaseIdAcrossEvents: events.every(event => event.caseId === caseId),
  states,
  cloudRun: { baseUrl, health, ...(cloudRunRevision ? { revision: cloudRunRevision } : {}) },
  payment: {
    paymentIntentId: proof.paymentIntentId,
    settlementTransaction: proof.settlementTransaction,
    settlementProofBaseUnits: proof.settlementProofBaseUnits,
    explorerUrl: proof.explorerUrl,
    cluster: 'devnet',
    genesisHash,
    slot: chain.slot,
    error: chain.meta?.err ?? null,
    challengeSha256: proof.x402ChallengeSha256,
    paymentResponseSha256: proof.paymentResponseSha256,
    network: proof.x402Network,
    asset: proof.x402Asset,
    amount: proof.x402Amount,
    payTo: proof.x402PayTo,
    orderPda: proof.orderPda,
    vaultAta: proof.vaultAta,
    swigAccount: proof.swigAccount,
    limitedAuthority: proof.limitedAuthority,
    initializeTransaction: proof.initializeTransaction
  },
  merchant: { providerOrderId: publicCase.providerOrderId, tracking, unauthorizedMutationStatus: unauthorizedMutation.status },
  privacy: {
    publicCaseContainsBeneficiaryRef: JSON.stringify(publicCase).includes('beneficiaryRef'),
    publicCaseContainsCallSidHash: JSON.stringify(publicCase).includes('callSidHash')
  },
  publicCaseSha256: createHash('sha256').update(JSON.stringify(publicCase)).digest('hex')
};
if (artifact.privacy.publicCaseContainsBeneficiaryRef || artifact.privacy.publicCaseContainsCallSidHash) {
  throw new Error('Public case leaked a private identifier');
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputPath, caseId, transaction: proof.settlementTransaction, order: publicCase.providerOrderId })}\n`);

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  if (!response.ok) throw new Error(`RPC ${method} returned ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`RPC ${method} failed: ${body.error.message}`);
  return body.result;
}
