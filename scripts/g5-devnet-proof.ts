import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import {
    PROGRAM_ID,
    USDC_MINT,
    createInitializeOrderInstruction,
    createReleaseInstruction,
    createRefundTimeoutInstruction,
    getOrderEscrowPDA,
    getVaultATA,
    fetchOrderEscrow,
    OrderState
} from '../src/g5/escrowClient.ts';
import { fundEscrowViaX402 } from '../src/g5/x402EscrowFunding.ts';

async function startRateLimitedRpcProxy(upstream: string): Promise<string> {
    let queue = Promise.resolve();
    const server = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', chunk => chunks.push(Buffer.from(chunk)));
        request.on('end', () => {
            const body = Buffer.concat(chunks);
            queue = queue.then(async () => {
                let upstreamResponse: Response | undefined;
                for (let attempt = 0; attempt < 8; attempt += 1) {
                    upstreamResponse = await fetch(upstream, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body
                    });
                    if (upstreamResponse.status !== 429) break;
                    const retryAfter = Number(upstreamResponse.headers.get('retry-after') ?? '10');
                    await upstreamResponse.arrayBuffer();
                    await new Promise(resolve => setTimeout(resolve, Math.max(1, retryAfter) * 1000));
                }
                if (!upstreamResponse) throw new Error('RPC proxy received no upstream response');
                const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
                response.statusCode = upstreamResponse.status;
                response.setHeader('content-type', upstreamResponse.headers.get('content-type') ?? 'application/json');
                response.end(responseBody);
                await new Promise(resolve => setTimeout(resolve, 350));
            }).catch(error => {
                response.statusCode = 502;
                response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
            });
        });
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    server.unref();
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('RPC proxy address unavailable');
    return `http://127.0.0.1:${address.port}`;
}

async function run() {
    const upstreamRpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    const rpcUrl = await startRateLimitedRpcProxy(upstreamRpcUrl);
    const connection = new Connection(rpcUrl, {
        commitment: 'confirmed',
        wsEndpoint: 'wss://api.devnet.solana.com'
    });

    function loadKeypair(envVar: string): Keypair {
        const path = process.env[envVar];
        if (!path) throw new Error(`${envVar} not set`);
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as number[];
        const bytes = Uint8Array.from(parsed);
        const keypair = Keypair.fromSecretKey(bytes);
        parsed.fill(0);
        return keypair;
    }

    const institution = loadKeypair('G5_INSTITUTION_KEYPAIR');
    const merchant = loadKeypair('G5_MERCHANT_KEYPAIR');
    const delivery = loadKeypair('G5_DELIVERY_KEYPAIR');
    const programKeypair = loadKeypair('G5_PROGRAM_KEYPAIR');

    if (institution.publicKey.toBase58() !== '3EvTC5bPzJJxf9Wsy9borauPkvm2y1WdT265iK2F7TMM') throw new Error('Institution key mismatch');
    if (merchant.publicKey.toBase58() !== '67fxkr8sXc98ThKX6HnoEytCRCJJHHnsGaQV3bLB5vk3') throw new Error('Merchant key mismatch');
    if (delivery.publicKey.toBase58() !== 'FvYotQ7hCPQuPxqeti4Lp7o7JpQ5dxuHysGjqdPy2c8C') throw new Error('Delivery key mismatch');
    if (!programKeypair.publicKey.equals(PROGRAM_ID)) throw new Error('Program ID mismatch');

    const programInfo = await connection.getAccountInfo(PROGRAM_ID);
    if (!programInfo?.executable) throw new Error('Program not executable');

    const institutionAta = await getOrCreateAssociatedTokenAccount(connection, institution, USDC_MINT, institution.publicKey);
    const merchantAta = await getOrCreateAssociatedTokenAccount(connection, institution, USDC_MINT, merchant.publicKey);

    const commitmentRelease = randomBytes(32);
    const commitmentRefund = randomBytes(32);
    const [releasePda] = getOrderEscrowPDA(commitmentRelease);
    const [refundPda] = getOrderEscrowPDA(commitmentRefund);
    const releaseVault = getVaultATA(releasePda);
    const refundVault = getVaultATA(refundPda);

    const clock = await connection.getSlot().then(slot => connection.getBlockTime(slot));
    if (!clock) throw new Error('Could not get block time');
    const now = BigInt(clock);
    const amount = 1_000_000n;
    const expiryRelease = now + 600n;
    const expiryRefund = now + 180n;

    const initReleaseIx = createInitializeOrderInstruction(institution.publicKey, merchant.publicKey, delivery.publicKey, commitmentRelease, amount, expiryRelease);
    const initRefundIx = createInitializeOrderInstruction(institution.publicKey, merchant.publicKey, delivery.publicKey, commitmentRefund, amount, expiryRefund);
    const initReleaseSig = await sendAndConfirmTransaction(connection, new Transaction().add(initReleaseIx), [institution], { commitment: 'confirmed' });
    const initRefundSig = await sendAndConfirmTransaction(connection, new Transaction().add(initRefundIx), [institution], { commitment: 'confirmed' });

    const traceDirectory = await mkdtemp(join(tmpdir(), 'benefit-g5-traces-'));
    try {
        const merchBalanceBeforeStr = await connection.getTokenAccountBalance(merchantAta.address).then(result => result.value.amount);
        const instBalanceBeforeStr = await connection.getTokenAccountBalance(institutionAta.address).then(result => result.value.amount);

        const releaseFunding = await fundEscrowViaX402(connection, institution, releasePda, releaseVault, amount, rpcUrl, traceDirectory);
        await new Promise(resolve => setTimeout(resolve, 12_000));
        const refundFunding = await fundEscrowViaX402(connection, institution, refundPda, refundVault, amount, rpcUrl, traceDirectory);

        if (releaseFunding.vaultDelta !== Number(amount)) throw new Error('Release vault underfunded');
        if (refundFunding.vaultDelta !== Number(amount)) throw new Error('Refund vault underfunded');

        const merchBalanceAfterFundStr = await connection.getTokenAccountBalance(merchantAta.address).then(result => result.value.amount);
        if (merchBalanceBeforeStr !== merchBalanceAfterFundStr) throw new Error('Merchant balance changed during funding');

        async function expectFailure(tx: Transaction, signers: Keypair[], description: string) {
            const blockhash = await connection.getLatestBlockhash('confirmed');
            tx.recentBlockhash = blockhash.blockhash;
            tx.feePayer = signers[0].publicKey;
            const signature = await connection.sendTransaction(tx, signers, { skipPreflight: true });
            await connection.confirmTransaction({ signature, ...blockhash }, 'confirmed');
            const parsed = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
            if (!parsed?.meta?.err) throw new Error(`${description} succeeded but should have failed`);
            return { signature, slot: parsed.slot, error: parsed.meta.err };
        }

        const wrongAuthReleaseIx = createReleaseInstruction(institution.publicKey, merchant.publicKey, institution.publicKey, commitmentRelease);
        const wrongAuthFailure = await expectFailure(new Transaction().add(wrongAuthReleaseIx), [institution], 'Wrong authority release');

        const validReleaseIx = createReleaseInstruction(delivery.publicKey, merchant.publicKey, institution.publicKey, commitmentRelease);
        const validReleaseSig = await sendAndConfirmTransaction(connection, new Transaction().add(validReleaseIx), [institution, delivery], { commitment: 'confirmed' });
        const replayReleaseFailure = await expectFailure(new Transaction().add(validReleaseIx), [institution, delivery], 'Replay release');

        const oppositeRefundIx = createRefundTimeoutInstruction(institution.publicKey, commitmentRelease);
        const oppositeRefundFailure = await expectFailure(new Transaction().add(oppositeRefundIx), [institution], 'Opposite refund on released');

        const earlyRefundIx = createRefundTimeoutInstruction(institution.publicKey, commitmentRefund);
        const earlyRefundFailure = await expectFailure(new Transaction().add(earlyRefundIx), [institution], 'Early refund');

        let currentClock = await connection.getSlot().then(slot => connection.getBlockTime(slot)) || 0;
        while (currentClock < Number(expiryRefund)) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            currentClock = await connection.getSlot().then(slot => connection.getBlockTime(slot)) || 0;
        }

        const validRefundSig = await sendAndConfirmTransaction(connection, new Transaction().add(earlyRefundIx), [institution], { commitment: 'confirmed' });
        const replayRefundFailure = await expectFailure(new Transaction().add(earlyRefundIx), [institution], 'Replay refund');

        const oppositeReleaseIx = createReleaseInstruction(delivery.publicKey, merchant.publicKey, institution.publicKey, commitmentRefund);
        const oppositeReleaseFailure = await expectFailure(new Transaction().add(oppositeReleaseIx), [institution, delivery], 'Opposite release on refunded');

        const finalReleaseState = await fetchOrderEscrow(connection, commitmentRelease);
        const finalRefundState = await fetchOrderEscrow(connection, commitmentRefund);
        const merchBalanceAfterStr = await connection.getTokenAccountBalance(merchantAta.address).then(result => result.value.amount);
        const instBalanceAfterStr = await connection.getTokenAccountBalance(institutionAta.address).then(result => result.value.amount);
        const releaseTx = await connection.getTransaction(validReleaseSig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        const refundTx = await connection.getTransaction(validRefundSig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });

        const output = {
            program: { id: PROGRAM_ID.toBase58(), executable: programInfo.executable, owner: programInfo.owner.toBase58() },
            identities: { institution: institution.publicKey.toBase58(), merchant: merchant.publicKey.toBase58(), delivery: delivery.publicKey.toBase58() },
            commitments: { release: commitmentRelease.toString('hex'), refund: commitmentRefund.toString('hex') },
            fundingProofs: { release: releaseFunding, refund: refundFunding },
            transactions: {
                initialize: { release: initReleaseSig, refund: initRefundSig },
                wrongAuthFailure,
                validRelease: { signature: validReleaseSig, slot: releaseTx?.slot, error: releaseTx?.meta?.err },
                replayReleaseFailure,
                oppositeRefundFailure,
                earlyRefundFailure,
                validRefund: { signature: validRefundSig, slot: refundTx?.slot, error: refundTx?.meta?.err },
                replayRefundFailure,
                oppositeReleaseFailure
            },
            balances: {
                merchantBefore: merchBalanceBeforeStr,
                merchantAfterFund: merchBalanceAfterFundStr,
                merchantFinal: merchBalanceAfterStr,
                merchantDelta: Number(merchBalanceAfterStr) - Number(merchBalanceBeforeStr),
                institutionBefore: instBalanceBeforeStr,
                institutionFinal: instBalanceAfterStr
            },
            states: {
                releaseOrderState: finalReleaseState?.state === OrderState.Released ? 'Released' : 'Unknown',
                refundOrderState: finalRefundState?.state === OrderState.Refunded ? 'Refunded' : 'Unknown'
            },
            assertions: {
                releaseTerminal: finalReleaseState?.terminalAt !== 0n,
                refundTerminal: finalRefundState?.terminalAt !== 0n,
                merchantUnpaidBeforeRelease: merchBalanceBeforeStr === merchBalanceAfterFundStr,
                merchantReceivedRelease: Number(merchBalanceAfterStr) - Number(merchBalanceBeforeStr) === Number(amount),
                releaseVaultClosed: await connection.getAccountInfo(releaseVault) === null,
                refundVaultClosed: await connection.getAccountInfo(refundVault) === null
            }
        };

        process.stdout.write(`${JSON.stringify(output, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2)}\n`);
    } finally {
        await rm(traceDirectory, { recursive: true, force: true });
    }
}

run().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
});
