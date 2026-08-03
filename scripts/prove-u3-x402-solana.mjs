import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import 'tsx/esm';

const { CaseCoordinator } = await import('../src/e2e/caseCoordinator.ts');
const { InMemoryCaseRepository } = await import('../src/e2e/inMemoryCaseRepository.ts');
const { createSolanaDevnetProviderAdapter, createX402ProviderAdapter } = await import('../src/providers/providerContracts.ts');

const outputPath = resolve(process.argv[2] ?? 'proof/u3-x402-solana-devnet.json');
const now = () => 1_785_456_000_000;

function dependencies(category = 'ASSISTIVE_EQUIPMENT', sku = 'ASSISTIVE_STAND_AID_01') {
  const calls = { x402: 0, solanaDevnet: 0, orders: 0 };
  return {
    calls,
    interpreter: {
      async analyzeAudio() {
        return { requestedCategory: category, requestedSku: sku, quantity: 1, substitutionsAllowed: false, referencesApprovedPlan: true, confidence: 0.97, ambiguityReasons: [], safeUserSummary: '합성 요청' };
      }
    },
    payment: {
      async pay(input) {
        if (!input.confirmationCommitment || input.confirmationCommitment.length !== 64) throw new Error('Missing one-time consent commitment');
        calls.x402 += 1;
        calls.solanaDevnet += 1;
        return { paymentIntentId: `u3_${input.caseId}`, settlementTransaction: `DEVNET_PROOF_${input.caseId}`, settlementProofBaseUnits: input.settlementProofBaseUnits };
      }
    },
    merchant: { async submit() { calls.orders += 1; return { providerOrderId: 'U3-SYNTHETIC-ORDER' }; } }
  };
}

async function createScenario(callSid, category, sku, digit) {
  const repo = new InMemoryCaseRepository();
  const deps = dependencies(category, sku);
  const coordinator = new CaseCoordinator(repo, deps.interpreter, deps.payment, deps.merchant, now);
  const captured = await coordinator.capture(callSid, Buffer.from('synthetic-u3-audio'), 'audio/mpeg');
  const result = digit === undefined ? captured : await coordinator.confirm(captured.caseId, digit);
  return { repo, deps, coordinator, captured, result };
}

const success = await createScenario('CA-SYNTHETIC-U3-SUCCESS', 'ASSISTIVE_EQUIPMENT', 'ASSISTIVE_STAND_AID_01', '1');
const successReplay = await success.coordinator.confirm(success.result.caseId, '1');
const successEvents = await success.repo.events(success.result.caseId);
const successStates = successEvents.map(event => event.state);
const policyIndex = successStates.indexOf('AWAITING_CONFIRMATION');
const consentIndex = successStates.indexOf('CONFIRMED');
const paymentIndex = successStates.indexOf('PAYMENT_REQUIRED');
if (!(policyIndex >= 0 && policyIndex < consentIndex && consentIndex < paymentIndex)) throw new Error('Payment boundary did not follow policy and consent');
if (success.result.state !== 'ORDERED' || successReplay.state !== 'ORDERED') throw new Error('Approved scenario did not remain idempotently ordered');
if (success.deps.calls.x402 !== 1 || success.deps.calls.solanaDevnet !== 1) throw new Error('Approved payment was not exactly once');

const blocked = await createScenario('CA-SYNTHETIC-U3-BLOCKED', 'TOBACCO', 'TOBACCO_01');
if (blocked.result.state !== 'POLICY_BLOCKED' || blocked.deps.calls.x402 !== 0 || blocked.deps.calls.solanaDevnet !== 0) throw new Error('Policy-blocked scenario crossed payment boundary');

const rejected = await createScenario('CA-SYNTHETIC-U3-REJECTED', 'ASSISTIVE_EQUIPMENT', 'ASSISTIVE_STAND_AID_01', '2');
const rejectedReplay = await rejected.coordinator.confirm(rejected.result.caseId, '1');
if (rejected.result.state !== 'USER_REJECTED' || rejectedReplay.state !== 'USER_REJECTED' || rejected.deps.calls.x402 !== 0 || rejected.deps.calls.solanaDevnet !== 0) throw new Error('Rejected or replayed consent crossed payment boundary');

const requiredLiveEnvironment = ['OPERATOR_KEY_PATH', 'SWIG_AUTHORITY_KEY_PATH', 'SWIG_ACCOUNT_ADDRESS', 'MERCHANT_ADDRESS'];
const liveEnabled = process.env.U3_LIVE_DEVNET === '1' && requiredLiveEnvironment.every(name => Boolean(process.env[name]));
const externalCaseId = success.result.caseId;
const x402Preflight = await createX402ProviderAdapter(liveEnabled).preflight(externalCaseId, 'settle-approved-consented-payment');
const solanaPreflight = await createSolanaDevnetProviderAdapter(liveEnabled).preflight(externalCaseId, 'confirm-devnet-transaction');

let external;
if (x402Preflight.status === 'BLOCKED' || solanaPreflight.status === 'BLOCKED') {
  external = {
    status: 'BLOCKED_EXTERNAL_DEPENDENCY',
    sideEffectsStarted: 0,
    blockers: [x402Preflight, solanaPreflight].flatMap(value => value.status === 'BLOCKED' ? [value.blocker] : [])
  };
} else {
  const liveEvidencePath = resolve(outputPath, '../.u3-live-devnet.tmp.json');
  const live = await runLiveProof(liveEvidencePath);
  if (live.exitCode !== 0) throw new Error(`Live x402 Devnet proof failed: ${live.stderr}`);
  const liveEvidence = JSON.parse(await readFile(liveEvidencePath, 'utf8'));
  await rm(liveEvidencePath, { force: true });
  if (liveEvidence.protocol?.network !== 'solana:devnet' || liveEvidence.settlement?.confirmed !== true || liveEvidence.exactly_once?.fulfillment_count !== 1) throw new Error('Live proof did not establish Devnet exactly-once settlement');
  external = { status: 'LIVE_VERIFIED', sideEffectsStarted: 1, evidence: liveEvidence };
}

const artifact = {
  schemaVersion: 'u3-x402-solana-devnet-evidence-v1',
  unitId: 'U3-x402-solana-devnet',
  caseId: success.result.caseId,
  status: external.status === 'LIVE_VERIFIED' ? 'PASS' : 'PASS_WITH_EXTERNAL_BLOCKERS',
  boundary: {
    orderedStates: successStates,
    policyBeforeConsentBeforePayment: true,
    confirmationCommitmentPresent: Boolean(success.result.confirmationCommitment)
  },
  calls: {
    approved: { x402: success.deps.calls.x402, solanaDevnet: success.deps.calls.solanaDevnet },
    policyBlocked: { x402: blocked.deps.calls.x402, solanaDevnet: blocked.deps.calls.solanaDevnet },
    rejectedReplay: { x402: rejected.deps.calls.x402, solanaDevnet: rejected.deps.calls.solanaDevnet },
    approvedReplayAdditional: { x402: 0, solanaDevnet: 0 }
  },
  external,
  cluster: 'devnet',
  mainnetUsed: false,
  realPersonalDataUsed: false,
  secretValuesPersisted: false,
  verified: true
};

await mkdir(resolve(outputPath, '..'), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ artifact: outputPath, status: artifact.status, x402Calls: success.deps.calls.x402, solanaDevnetCalls: success.deps.calls.solanaDevnet })}\n`);

function runLiveProof(evidencePath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', 'scripts/g4-devnet-swig.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, G4_EVIDENCE_PATH: evidencePath },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', rejectPromise);
    child.once('close', code => resolvePromise({ exitCode: code ?? 1, stdout, stderr }));
  });
}
