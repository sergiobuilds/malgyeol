import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import 'tsx/esm';

const { CaseCoordinator } = await import('../src/e2e/caseCoordinator.ts');
const { DemoMerchantAdapter } = await import('../src/e2e/demoMerchantAdapter.ts');
const { InMemoryCaseRepository } = await import('../src/e2e/inMemoryCaseRepository.ts');
const { createMerchantProviderAdapter } = await import('../src/providers/providerContracts.ts');

const repo = new InMemoryCaseRepository();
const sandbox = new DemoMerchantAdapter();
const calls = { payments: 0, merchantAttempts: 0, merchantAccepted: 0 };
const interpreter = { async analyzeAudio() { return { requestedCategory: 'ASSISTIVE_EQUIPMENT', requestedSku: 'ASSISTIVE_STAND_AID_01', quantity: 1, substitutionsAllowed: false, referencesApprovedPlan: true, confidence: 0.97, ambiguityReasons: [], safeUserSummary: '합성 요청' }; } };
const payment = { async pay(input) { calls.payments += 1; return { paymentIntentId: `u4_${input.caseId}`, settlementTransaction: `DEVNET_PROOF_${input.caseId}`, settlementProofBaseUnits: input.settlementProofBaseUnits }; } };
const merchant = { async submit(input) { calls.merchantAttempts += 1; if (calls.merchantAttempts === 1) throw new Error('synthetic sandbox timeout'); calls.merchantAccepted += 1; return sandbox.submit(input); } };
const coordinator = new CaseCoordinator(repo, interpreter, payment, merchant, () => 1_785_456_000_000);
const captured = await coordinator.capture('CA-SYNTHETIC-U4', Buffer.from('synthetic-u4-audio'), 'audio/mpeg');
const failed = await coordinator.confirm(captured.caseId, '1');
const recovered = await coordinator.recoverOrder(captured.caseId);
const replay = await coordinator.recoverOrder(captured.caseId);
const states = (await repo.events(captured.caseId)).map(event => event.state);

if (failed.state !== 'ORDER_REVIEW_REQUIRED') throw new Error('Order failure was not persisted for review');
if (recovered.state !== 'ORDERED' || !recovered.providerOrderId) throw new Error('Merchant recovery did not produce a sandbox order number');
if (replay.providerOrderId !== recovered.providerOrderId) throw new Error('Recovered order replay changed the provider order number');
if (calls.payments !== 1 || calls.merchantAccepted !== 1) throw new Error('Recovery was not exactly once across payment and accepted order');

const liveEnabled = process.env.U4_MERCHANT_SANDBOX === '1' && Boolean(process.env.MERCHANT_SANDBOX_URL) && Boolean(process.env.MERCHANT_SANDBOX_TOKEN);
const preflight = await createMerchantProviderAdapter(liveEnabled).preflight(captured.caseId, 'submit-sandbox-order');
const external = preflight.status === 'BLOCKED'
  ? { status: 'BLOCKED_EXTERNAL_DEPENDENCY', sideEffectsStarted: 0, blockers: [preflight.blocker] }
  : { status: 'LIVE_READY_NOT_EXECUTED', sideEffectsStarted: 0 };

const artifact = {
  schemaVersion: 'u4-merchant-sandbox-evidence-v1', unitId: 'U4-merchant-sandbox', caseId: captured.caseId,
  status: external.status === 'BLOCKED_EXTERNAL_DEPENDENCY' ? 'PASS_WITH_EXTERNAL_BLOCKERS' : 'PASS',
  recovery: { states, paymentCalls: calls.payments, merchantAttempts: calls.merchantAttempts, merchantAccepted: calls.merchantAccepted, providerOrderId: recovered.providerOrderId, replayStable: true },
  external, sandboxOnly: true, realPersonalDataUsed: false, secretValuesPersisted: false, verified: true
};
const outputPath = resolve(process.argv[2] ?? 'proof/u4-merchant-sandbox.json');
await mkdir(resolve(outputPath, '..'), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ artifact: outputPath, status: artifact.status, providerOrderId: recovered.providerOrderId })}\n`);
