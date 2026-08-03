import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import { createTransferCheckedInstruction, TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { address, createKeyPairSignerFromBytes, createSolanaRpc } from '@solana/kit';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { PayKitGateway } from '../g4/payKitGateway.ts';
import { ServerCore } from '../g4/serverCore.ts';
import { readRawRequest, writeCoreResponse } from '../g4/httpAdapter.ts';
import { TraceRepo } from '../g4/traceRepo.ts';
import { ExactSwigSvmScheme } from '../g4/swigClient.ts';
import { FIXED_SKU } from '../g4/types.ts';
const require = createRequire(import.meta.url);
const {
    Actions,
    createEd25519AuthorityInfo,
    fetchSwig,
    findSwigPda,
    getAddAuthorityInstructions,
    getCreateSwigInstruction,
    getSwigWalletAddress
} = require('@swig-wallet/classic') as typeof import('@swig-wallet/classic');
import { ACTION_HEADER_LENGTH, Permission, getActionHeaderDecoder, getTokenDestinationLimitDecoder } from '@swig-wallet/coder';

const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

export type EscrowFundingEvidence = {
    swigAccount: string;
    authorityPubkey: string;
    challengeStatus: number;
    challengeTerms: unknown;
    paidStatus: number;
    paymentResponse: string;
    devnetSettlementSignature: string;
    rpcMeta: unknown;
    rpcSlot: number;
    vaultDelta: number;
    fulfillmentCount: number;
    challengeSha256: string;
    paymentResponseSha256: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
};

export function validateEscrowFundingRequest(
    orderPDA: PublicKey,
    expectedVaultATA: PublicKey,
    amount: bigint
): void {
    if (amount !== 1_000_000n) throw new Error('G5 fixed x402 amount must be exactly 1 USDC');
    const derivedVaultATA = getAssociatedTokenAddressSync(
        new PublicKey(USDC_MINT),
        orderPDA,
        true,
        TOKEN_PROGRAM_ID
    );
    if (!derivedVaultATA.equals(expectedVaultATA)) throw new Error('Escrow vault does not match order PDA');
}

export async function fundEscrowViaX402(
    connection: Connection,
    institution: Keypair,
    orderPDA: PublicKey,
    expectedVaultATA: PublicKey,
    amount: bigint,
    rpcUrl: string,
    traceDirectory: string
): Promise<EscrowFundingEvidence> {
    validateEscrowFundingRequest(orderPDA, expectedVaultATA, amount);
    const mint = new PublicKey(USDC_MINT);
    const swigId = randomBytes(32);
    const swigAddress = findSwigPda(swigId);

    const createInstruction = await getCreateSwigInstruction({
        payer: institution.publicKey,
        actions: Actions.set().all().get(),
        authorityInfo: createEd25519AuthorityInfo(institution.publicKey),
        id: swigId
    });

    await sendAndConfirmTransaction(connection, new Transaction().add(createInstruction), [institution], { commitment: 'confirmed' });

    let swig = await fetchSwig(connection, swigAddress);
    const swigWallet = await getSwigWalletAddress(swig);
    const rootRole = swig.findRolesByEd25519SignerPk(institution.publicKey)[0];
    if (!rootRole?.actions.isRoot()) throw new Error('Swig root role missing');

    const institutionAta = getAssociatedTokenAddressSync(mint, institution.publicKey);
    const swigAta = await getOrCreateAssociatedTokenAccount(connection, institution, mint, swigWallet, true);

    await sendAndConfirmTransaction(connection, new Transaction().add(
        createTransferCheckedInstruction(institutionAta, mint, swigAta.address, institution.publicKey, amount, 6, [], TOKEN_PROGRAM_ID)
    ), [institution], { commitment: 'confirmed' });

    const authority = Keypair.generate();

    const addAuthority = await getAddAuthorityInstructions(
        swig,
        rootRole.id,
        createEd25519AuthorityInfo(authority.publicKey),
        Actions.set().tokenDestinationLimit({ mint, amount, destination: expectedVaultATA }).get(),
        { payer: institution.publicKey }
    );
    await sendAndConfirmTransaction(connection, new Transaction().add(...addAuthority), [institution], { commitment: 'confirmed' });

    swig = await fetchSwig(connection, swigAddress);
    const limitedRole = swig.findRolesByEd25519SignerPk(authority.publicKey).find(role => !role.actions.isRoot());
    if (!limitedRole || !limitedRole.actions.canSpendToken(mint, amount)) throw new Error('Limited USDC role was not created');

    const raw = limitedRole.actions.bytes();
    const count = limitedRole.actions.count;
    let cursor = 0;
    let foundDestLimit: ReturnType<ReturnType<typeof getTokenDestinationLimitDecoder>['decode']> | undefined;
    for (let index = 0; index < count; index += 1) {
        const header = getActionHeaderDecoder().decode(raw.slice(cursor, cursor + ACTION_HEADER_LENGTH));
        cursor += ACTION_HEADER_LENGTH;
        const payload = raw.slice(cursor, header.boundary);
        cursor = header.boundary;
        if (header.permission === Permission.TokenDestinationLimit) {
            foundDestLimit = getTokenDestinationLimitDecoder().decode(payload);
        }
    }
    if (!foundDestLimit) throw new Error('Persisted role is not TokenDestinationLimit');
    if (new PublicKey(foundDestLimit.mint).toBase58() !== mint.toBase58()) throw new Error('Mint mismatch');
    if (new PublicKey(foundDestLimit.destination).toBase58() !== expectedVaultATA.toBase58()) throw new Error('Destination mismatch');
    if (foundDestLimit.amount !== amount) throw new Error('Amount mismatch');

    const vaultBeforeStr = await connection.getTokenAccountBalance(expectedVaultATA).then(result => result.value.amount).catch(() => '0');
    const vaultBefore = Number(vaultBeforeStr);

    const operator = await createKeyPairSignerFromBytes(institution.secretKey);
    const swigAuthority = await createKeyPairSignerFromBytes(authority.secretKey);
    const merchantAddr = address(orderPDA.toBase58());

    const repo = new TraceRepo(traceDirectory);
    let fulfillmentCount = 0;
    const gateway = await PayKitGateway.create(operator, merchantAddr, rpcUrl);
    const core = new ServerCore(merchantAddr, gateway, repo, async () => { fulfillmentCount += 1; });

    const server = createServer(async (request, response) => {
        try { writeCoreResponse(response, await core.handle(await readRawRequest(request))); }
        catch (error) { response.statusCode = 500; response.end(error instanceof Error ? error.message : String(error)); }
    });

    try {
        await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        const listen = server.address();
        if (!listen || typeof listen === 'string') throw new Error('Server address unavailable');
        const url = `http://127.0.0.1:${listen.port}/orders`;
        const body = JSON.stringify({ orderId: `ESCROW-${orderPDA.toBase58()}`, sku: FIXED_SKU });
        const idempotencyKey = createHash('sha256').update(body).digest('hex');
        const headers = { 'content-type': 'application/json', 'idempotency-key': idempotencyKey };

        const initial = await fetch(url, { method: 'POST', headers, body });
        const requiredHeader = initial.headers.get('payment-required');
        if (initial.status !== 402 || !requiredHeader) throw new Error(`Initial request was not 402: ${initial.status}`);

        const required = decodePaymentRequiredHeader(requiredHeader);
        const requirement = required.accepts[0];
        if (!requirement) throw new Error('x402 challenge omitted payment requirements');
        const intent = repo.getIntent(idempotencyKey);
        if (!intent) throw new Error('Payment intent missing');

        const scheme = new ExactSwigSvmScheme(swigAuthority, address(swigAddress.toBase58()), {
            merchant: merchantAddr,
            feePayer: operator.address,
            paymentIntentId: intent.paymentIntentId
        }, rpcUrl);

        const client = new x402Client().register('solana:*', scheme);
        const http = new x402HTTPClient(client);
        let payload = await http.createPaymentPayload(required);
        let paymentHeaders = http.encodePaymentSignatureHeader(payload);
        let retryHeaders = new Headers(headers);
        for (const [name, value] of Object.entries(paymentHeaders)) retryHeaders.set(name, value);

        let paid: Response | undefined;
        for (let attempt = 0; attempt < 4; attempt += 1) {
            paid = await fetch(url, { method: 'POST', headers: retryHeaders, body });
            if (paid.status === 200) break;
            if (paid.status === 402) {
                const refreshedHeader = paid.headers.get('payment-required');
                if (!refreshedHeader) throw new Error('Refreshed 402 omitted PAYMENT-REQUIRED');
                payload = await http.createPaymentPayload(decodePaymentRequiredHeader(refreshedHeader));
                paymentHeaders = http.encodePaymentSignatureHeader(payload);
                retryHeaders = new Headers(headers);
                for (const [name, value] of Object.entries(paymentHeaders)) retryHeaders.set(name, value);
                await new Promise(resolve => setTimeout(resolve, 12_000));
                continue;
            }
            const failureBody = await paid.text();
            if (attempt === 3 || !failureBody.includes('429')) {
                throw new Error(`Paid retry failed: ${paid.status} ${failureBody.slice(0, 240)}`);
            }
            await new Promise(resolve => setTimeout(resolve, 12_000));
        }
        if (!paid) throw new Error('Paid retry returned no response');
        const standardResponse = paid.headers.get('payment-response');
        if (paid.status !== 200 || !standardResponse) throw new Error(`Paid retry failed: ${paid.status}`);

        const settlement = http.getPaymentSettleResponse(name => paid.headers.get(name));
        if (!settlement.success || !settlement.transaction) throw new Error('Settlement response was not successful');

        const rpc = createSolanaRpc(rpcUrl);
        const chain = await rpc.getTransaction(settlement.transaction as never, { commitment: 'confirmed', maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' } as never).send();
        if (!chain || chain.meta?.err) throw new Error('Settlement transaction not confirmed');

        const vaultAfterStr = await connection.getTokenAccountBalance(expectedVaultATA).then(result => result.value.amount);
        const vaultDelta = Number(vaultAfterStr) - vaultBefore;

        return {
            swigAccount: swigAddress.toBase58(),
            authorityPubkey: authority.publicKey.toBase58(),
            challengeStatus: initial.status,
            challengeTerms: required,
            paidStatus: paid.status,
            paymentResponse: standardResponse,
            devnetSettlementSignature: settlement.transaction as string,
            rpcMeta: chain.meta,
            rpcSlot: Number(chain.slot),
            vaultDelta,
            fulfillmentCount,
            challengeSha256: createHash('sha256').update(requiredHeader).digest('hex'),
            paymentResponseSha256: createHash('sha256').update(standardResponse).digest('hex'),
            network: requirement.network,
            asset: requirement.asset,
            amount: requirement.amount,
            payTo: requirement.payTo
        };
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}
