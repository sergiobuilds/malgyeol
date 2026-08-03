import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import 'tsx/esm';

const outputDir = process.env.EVIDENCE_OUTPUT_DIR
  ? resolve(process.env.EVIDENCE_OUTPUT_DIR)
  : await mkdtemp(join(tmpdir(), 'benefit-e2e-proof-'));
const outputPath = name => join(outputDir, name);

const {
  PROVIDERS,
  createCloudRunProviderAdapter,
  createMerchantProviderAdapter,
  createSolanaDevnetProviderAdapter,
  createTwilioProviderAdapter,
  createVertexProviderAdapter,
  createX402ProviderAdapter,
  runProviderGate
} = await import('../src/providers/providerContracts.ts');

const factories = [
  createTwilioProviderAdapter,
  createVertexProviderAdapter,
  createX402ProviderAdapter,
  createSolanaDevnetProviderAdapter,
  createMerchantProviderAdapter,
  createCloudRunProviderAdapter
];
let sideEffectCalls = 0;
const result = await runProviderGate({
  caseId: 'case_synthetic_u1_proof',
  operation: 'purchase',
  adapters: factories.map(factory => factory(false)),
  sideEffects: Object.fromEntries(PROVIDERS.map(provider => [provider, async () => {
    sideEffectCalls += 1;
    return provider;
  }]))
});

if (result.status !== 'BLOCKED_EXTERNAL_DEPENDENCY') throw new Error('Provider gate did not block');
if (result.sideEffectsStarted !== 0 || sideEffectCalls !== 0) throw new Error('Partial side effect detected');
if (result.blockers.length !== PROVIDERS.length) throw new Error('Provider blocker coverage is incomplete');
if (result.blockers.some(blocker => blocker.subprocess.exitCode === 0)) throw new Error('A blocker subprocess exited zero');

const artifact = {
  schemaVersion: 'provider-contract-evidence-v1',
  unitId: 'U1-provider-contracts',
  caseId: 'case_synthetic_u1_proof',
  status: result.status,
  providers: PROVIDERS,
  blockers: result.blockers,
  partialSideEffects: sideEffectCalls,
  verified: true
};
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath('u1-provider-contracts.json'), `${JSON.stringify(artifact, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ artifact: outputPath('u1-provider-contracts.json'), status: result.status, partialSideEffects: sideEffectCalls })}\n`);

const u2 = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/prove-u2-phone-vertex.mjs', outputPath('u2-phone-vertex-live.json')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => resolve({ code: code ?? 1, stdout, stderr }));
});
if (u2.code !== 0) throw new Error(`U2 proof failed: ${u2.stderr}`);
process.stdout.write(u2.stdout);

const u3 = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/prove-u3-x402-solana.mjs', outputPath('u3-x402-solana-devnet.json')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => resolve({ code: code ?? 1, stdout, stderr }));
});
if (u3.code !== 0) throw new Error(`U3 proof failed: ${u3.stderr}`);
process.stdout.write(u3.stdout);

const u4 = await runProof('scripts/prove-u4-merchant-sandbox.mjs', ['--import', 'tsx'], outputPath('u4-merchant-sandbox.json'));
if (u4.code !== 0) throw new Error(`U4 proof failed: ${u4.stderr}`);
process.stdout.write(u4.stdout);

const u5 = await runProof('scripts/prove-u5-live-stage-xlsx-browser.mjs', ['--import', 'tsx'], outputPath('u5-live-stage-xlsx-browser.json'));
if (u5.code !== 0) throw new Error(`U5 proof failed: ${u5.stderr}`);
process.stdout.write(u5.stdout);

const u6 = await runProof('scripts/prove-u6-cloud-run.mjs', [], outputPath('u6-cloud-run-evidence.json'));
if (u6.code !== 0) throw new Error(`U6 proof failed: ${u6.stderr}`);
process.stdout.write(u6.stdout);

function runProof(script, nodeArgs = ['--import', 'tsx'], artifactPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...nodeArgs, script, artifactPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
