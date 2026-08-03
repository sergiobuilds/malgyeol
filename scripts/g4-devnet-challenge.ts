import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKeyPairSignerFromBytes } from '@solana/kit';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { PayKitGateway } from '../src/g4/payKitGateway.ts';
import { ServerCore } from '../src/g4/serverCore.ts';
import { readRawRequest, writeCoreResponse } from '../src/g4/httpAdapter.ts';
import { TraceRepo } from '../src/g4/traceRepo.ts';
import { DEVNET_NETWORK } from '../src/g4/payKitAdapter.ts';
import { FIXED_AMOUNT, FIXED_MINT, FIXED_SKU } from '../src/g4/types.ts';

const keyPath = process.env.OPERATOR_KEY_PATH;
const evidencePath = process.env.G4_CHALLENGE_EVIDENCE_PATH;
const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
if (!keyPath || !evidencePath) throw new Error('OPERATOR_KEY_PATH and G4_CHALLENGE_EVIDENCE_PATH are required');

const secret = JSON.parse(await readFile(keyPath, 'utf8')) as number[];
const operator = await createKeyPairSignerFromBytes(Uint8Array.from(secret));
secret.fill(0);
const directory = await mkdtemp(join(tmpdir(), 'benefit-g4-challenge-'));
const repo = new TraceRepo(directory);
const gateway = await PayKitGateway.create(operator, operator.address, rpcUrl);
const core = new ServerCore(operator.address, gateway, repo, async () => { throw new Error('Unpaid challenge must not fulfill an order'); });
const server = createServer(async (request, response) => {
  try { writeCoreResponse(response, await core.handle(await readRawRequest(request))); }
  catch (error) { response.statusCode = 500; response.end(error instanceof Error ? error.message : String(error)); }
});

try {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server address unavailable');
  const body = JSON.stringify({ orderId: 'ORDER_G4_CHALLENGE', sku: FIXED_SKU });
  const idempotencyKey = createHash('sha256').update(body).digest('hex');
  const response = await fetch(`http://127.0.0.1:${address.port}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body
  });
  const header = response.headers.get('payment-required');
  if (response.status !== 402 || !header) throw new Error(`Expected real 402, got ${response.status}: ${await response.text()}`);
  const responseBody = await response.json() as { accepts?: unknown[] };
  const decoded = decodePaymentRequiredHeader(header);
  const requirement = decoded.accepts[0];
  const intent = repo.getIntent(idempotencyKey);
  if (!intent) throw new Error('Intent was not persisted');
  if (decoded.x402Version !== 2 || requirement.scheme !== 'exact' || requirement.network !== DEVNET_NETWORK) throw new Error('Wrong x402 protocol terms');
  if (requirement.asset !== FIXED_MINT || requirement.amount !== String(FIXED_AMOUNT) || requirement.payTo !== operator.address) throw new Error('Wrong payment asset terms');
  if (requirement.extra?.memo !== intent.paymentIntentId || !requirement.extra?.feePayer) throw new Error('Payment intent memo or fee payer missing');
  const bodyRequirement = responseBody.accepts?.[0];
  if (!bodyRequirement || typeof bodyRequirement !== 'object' || Array.isArray(bodyRequirement)) throw new Error('402 body has no accepts entry');
  const { protocol, ...bodyPaymentTerms } = bodyRequirement as Record<string, unknown>;
  if (protocol !== 'x402' || JSON.stringify(bodyPaymentTerms) !== JSON.stringify(requirement)) {
    throw new Error('402 body and PAYMENT-REQUIRED header payment terms differ');
  }
  const evidence = {
    schema: 'g4-real-402-challenge-v1',
    cluster: 'devnet',
    checked_at: new Date().toISOString(),
    status: response.status,
    header_sha256: createHash('sha256').update(header).digest('hex'),
    body_header_requirements_identical: true,
    x402_version: decoded.x402Version,
    requirement: {
      scheme: requirement.scheme,
      network: requirement.network,
      asset: requirement.asset,
      amount: requirement.amount,
      pay_to: requirement.payTo,
      fee_payer: requirement.extra?.feePayer,
      memo: requirement.extra?.memo,
      recent_blockhash_present: typeof requirement.extra?.recentBlockhash === 'string'
    },
    event_id: intent.eventId,
    order_id: intent.orderId,
    payment_intent_id: intent.paymentIntentId,
    request_fingerprint: intent.fingerprint,
    claim_boundary: 'Real pay-kit/x402 Devnet 402 challenge. No payment was signed or settled, so this artifact does not close G4 and does not claim pay.sh.'
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ status: response.status, evidencePath, paymentIntentId: intent.paymentIntentId })}\n`);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
}
