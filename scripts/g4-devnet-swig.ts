import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { address, createKeyPairSignerFromBytes, createSolanaRpc } from '@solana/kit';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { PayKitGateway } from '../src/g4/payKitGateway.ts';
import { ServerCore } from '../src/g4/serverCore.ts';
import { readRawRequest, writeCoreResponse } from '../src/g4/httpAdapter.ts';
import { TraceRepo } from '../src/g4/traceRepo.ts';
import { ExactSwigSvmScheme } from '../src/g4/swigClient.ts';
import { DEVNET_NETWORK } from '../src/g4/payKitAdapter.ts';
import { FIXED_AMOUNT, FIXED_MINT, FIXED_SKU } from '../src/g4/types.ts';

const operatorPath = process.env.OPERATOR_KEY_PATH;
const authorityPath = process.env.SWIG_AUTHORITY_KEY_PATH;
const swigText = process.env.SWIG_ACCOUNT_ADDRESS;
const merchantText = process.env.MERCHANT_ADDRESS;
const evidencePath = process.env.G4_EVIDENCE_PATH;
const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
if (!operatorPath || !authorityPath || !swigText || !merchantText || !evidencePath) throw new Error('Missing required G4 proof environment');

const operatorBytes = JSON.parse(await readFile(operatorPath, 'utf8')) as number[];
const authorityBytes = JSON.parse(await readFile(authorityPath, 'utf8')) as number[];
const operator = await createKeyPairSignerFromBytes(Uint8Array.from(operatorBytes));
const authority = await createKeyPairSignerFromBytes(Uint8Array.from(authorityBytes));
operatorBytes.fill(0); authorityBytes.fill(0);
const merchant = address(merchantText);
const swigAccount = address(swigText);
const directory = await mkdtemp(join(tmpdir(), 'benefit-g4-proof-'));
const repo = new TraceRepo(directory);
let fulfillmentCount = 0;
const gateway = await PayKitGateway.create(operator, merchant, rpcUrl);
const core = new ServerCore(merchant, gateway, repo, async () => { fulfillmentCount += 1; });
const server = createServer(async (request, response) => {
  try { writeCoreResponse(response, await core.handle(await readRawRequest(request))); }
  catch (error) { response.statusCode = 500; response.end(error instanceof Error ? error.message : String(error)); }
});

try {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const listen = server.address();
  if (!listen || typeof listen === 'string') throw new Error('Server address unavailable');
  const url = `http://127.0.0.1:${listen.port}/orders`;
  const body = JSON.stringify({ orderId: 'ORDER_G4_PAID', sku: FIXED_SKU });
  const idempotencyKey = createHash('sha256').update(body).digest('hex');
  const headers = { 'content-type': 'application/json', 'idempotency-key': idempotencyKey };
  const initial = await fetch(url, { method: 'POST', headers, body });
  const requiredHeader = initial.headers.get('payment-required');
  if (initial.status !== 402 || !requiredHeader) throw new Error(`Initial request was not 402: ${initial.status}`);
  const required = decodePaymentRequiredHeader(requiredHeader);
  const requirement = required.accepts[0];
  const intent = repo.getIntent(idempotencyKey);
  if (!intent) throw new Error('Payment intent missing');
  const scheme = new ExactSwigSvmScheme(authority, swigAccount, {
    merchant,
    feePayer: operator.address,
    paymentIntentId: intent.paymentIntentId
  }, rpcUrl);
  const client = new x402Client().register('solana:*', scheme);
  const http = new x402HTTPClient(client);
  const payload = await http.createPaymentPayload(required);
  const paymentHeaders = http.encodePaymentSignatureHeader(payload);
  const retryHeaders = new Headers(headers);
  for (const [name, value] of Object.entries(paymentHeaders)) retryHeaders.set(name, value);
  const paid = await fetch(url, { method: 'POST', headers: retryHeaders, body });
  const paidBody = await paid.text();
  const standardResponse = paid.headers.get('payment-response');
  const compatibilityResponse = paid.headers.get('x-payment-response');
  if (paid.status !== 200 || !standardResponse || standardResponse !== compatibilityResponse) throw new Error(`Paid retry failed: ${paid.status} ${paidBody}`);
  const settlement = http.getPaymentSettleResponse((name) => paid.headers.get(name));
  if (!settlement.success || !settlement.transaction) throw new Error('Settlement response was not successful');
  const rpc = createSolanaRpc(rpcUrl);
  const chain = await rpc.getTransaction(settlement.transaction as never, { commitment: 'confirmed', maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' } as never).send();
  if (!chain || chain.meta?.err) throw new Error('Settlement transaction not confirmed');
  const cached = await fetch(url, { method: 'POST', headers: retryHeaders, body });
  const cachedBody = await cached.text();
  if (cached.status !== 200 || cachedBody !== paidBody || fulfillmentCount !== 1) throw new Error('Cached retry was not exactly once');
  const receipt = repo.getReceipt(intent.eventId);
  if (!receipt || receipt.transaction !== settlement.transaction || receipt.mint !== FIXED_MINT || receipt.baseUnits !== FIXED_AMOUNT) throw new Error('Receipt binding failed');
  const evidence = {
    schema: 'g4-x402-swig-devnet-proof-v1', cluster: 'devnet', checked_at: new Date().toISOString(),
    protocol: { x402_version: required.x402Version, scheme: requirement.scheme, network: requirement.network, expected_network: DEVNET_NETWORK },
    order: { event_id: intent.eventId, order_id: intent.orderId, payment_intent_id: intent.paymentIntentId, fingerprint: intent.fingerprint },
    payment: { mint: FIXED_MINT, amount_base_units: String(FIXED_AMOUNT), merchant, swig_account: swigAccount, limited_authority: authority.address },
    http: { initial_status: initial.status, paid_status: paid.status, cached_status: cached.status, payment_required_sha256: createHash('sha256').update(requiredHeader).digest('hex'), payment_response_sha256: createHash('sha256').update(standardResponse).digest('hex'), standard_and_compatibility_headers_match: true },
    settlement: { transaction: settlement.transaction, confirmed: true, chain_error: chain.meta?.err ?? null },
    exactly_once: { fulfillment_count: fulfillmentCount, cached_body_identical: cachedBody === paidBody },
    receipt,
    claim_boundary: 'Uses @solana/pay-kit plus x402 with Swig Path 2 on Devnet. pay.sh is not in the verified request path.'
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ evidencePath, transaction: settlement.transaction, eventId: intent.eventId })}\n`);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
}
