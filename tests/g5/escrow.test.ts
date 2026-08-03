import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
    PROGRAM_ID,
    USDC_MINT,
    OrderState,
    getOrderEscrowPDA,
    getVaultATA,
    decodeOrderEscrow,
    createInitializeOrderInstruction,
    createReleaseInstruction,
    createRefundTimeoutInstruction
} from '../../src/g5/escrowClient.ts';

describe('G5 Escrow Client Tests', () => {
    const INSTITUTION = new PublicKey('3EvTC5bPzJJxf9Wsy9borauPkvm2y1WdT265iK2F7TMM');
    const MERCHANT = new PublicKey('67fxkr8sXc98ThKX6HnoEytCRCJJHHnsGaQV3bLB5vk3');
    const DELIVERY_AUTHORITY = new PublicKey('FvYotQ7hCPQuPxqeti4Lp7o7JpQ5dxuHysGjqdPy2c8C');
    const COMMITMENT = new Uint8Array(32).fill(1);

    const getNow = () => BigInt(Math.floor(Date.now() / 1000));

    test('Stable fixed destinations and constants', () => {
        assert.strictEqual(PROGRAM_ID.toBase58(), '5y8JA9jj4MNPLzPveGkEkfpaXRyqnXjffiC1yZ2UnUNv');
        assert.strictEqual(USDC_MINT.toBase58(), '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
    });

    test('PDA and Vault derivations', () => {
        const [pda, bump] = getOrderEscrowPDA(COMMITMENT);
        assert.ok(PublicKey.isOnCurve(pda.toBuffer()) === false);
        assert.ok(bump >= 0 && bump <= 255);
        assert.throws(() => getOrderEscrowPDA(new Uint8Array(31)), /Commitment must be exactly 32 bytes/);

        const vault = getVaultATA(pda);
        assert.ok(PublicKey.isOnCurve(vault.toBuffer()) === false);
    });

    test('Invalid input rejection for initialization', () => {
        const validExpiry = getNow() + 3600n;

        assert.throws(
            () => createInitializeOrderInstruction(INSTITUTION, MERCHANT, DELIVERY_AUTHORITY, new Uint8Array(31), 100n, validExpiry),
            /Commitment must be exactly 32 bytes/
        );

        assert.throws(
            () => createInitializeOrderInstruction(INSTITUTION, MERCHANT, DELIVERY_AUTHORITY, COMMITMENT, 0n, validExpiry),
            /Amount must be greater than zero/
        );

        assert.throws(
            () => createInitializeOrderInstruction(INSTITUTION, MERCHANT, DELIVERY_AUTHORITY, COMMITMENT, 100n, getNow() - 10n),
            /Expiry must be in the future/
        );

        const MAX_EXPIRY_DURATION = 7n * 24n * 60n * 60n;
        assert.throws(
            () => createInitializeOrderInstruction(INSTITUTION, MERCHANT, DELIVERY_AUTHORITY, COMMITMENT, 100n, getNow() + MAX_EXPIRY_DURATION + 1000n),
            /Expiry cannot be more than 7 days ahead/
        );

        assert.throws(
            () => createInitializeOrderInstruction(INSTITUTION, INSTITUTION, DELIVERY_AUTHORITY, COMMITMENT, 100n, validExpiry),
            /Parties must be distinct/
        );
        assert.throws(
            () => createInitializeOrderInstruction(INSTITUTION, MERCHANT, INSTITUTION, COMMITMENT, 100n, validExpiry),
            /Parties must be distinct/
        );
        assert.throws(
            () => createInitializeOrderInstruction(INSTITUTION, MERCHANT, MERCHANT, COMMITMENT, 100n, validExpiry),
            /Parties must be distinct/
        );
        assert.throws(
            () => createInitializeOrderInstruction(PublicKey.default, MERCHANT, DELIVERY_AUTHORITY, COMMITMENT, 100n, validExpiry),
            /Invalid participant key/
        );
        assert.throws(
            () => createInitializeOrderInstruction(INSTITUTION, PublicKey.default, DELIVERY_AUTHORITY, COMMITMENT, 100n, validExpiry),
            /Invalid participant key/
        );
        assert.throws(
            () => createInitializeOrderInstruction(INSTITUTION, MERCHANT, PublicKey.default, COMMITMENT, 100n, validExpiry),
            /Invalid participant key/
        );
    });

    test('InitializeOrder Instruction: structure, LE args, discriminators, no PII', () => {
        const amount = 5000000n;
        const validExpiry = getNow() + 7200n;
        const ix = createInitializeOrderInstruction(INSTITUTION, MERCHANT, DELIVERY_AUTHORITY, COMMITMENT, amount, validExpiry);

        assert.strictEqual(ix.programId.toBase58(), PROGRAM_ID.toBase58());
        assert.strictEqual(ix.keys.length, 9);
        assert.deepStrictEqual(ix.keys[0], { pubkey: INSTITUTION, isSigner: true, isWritable: true });
        assert.deepStrictEqual(ix.keys[1], { pubkey: MERCHANT, isSigner: false, isWritable: false });
        assert.deepStrictEqual(ix.keys[2], { pubkey: DELIVERY_AUTHORITY, isSigner: false, isWritable: false });
        assert.deepStrictEqual(ix.keys[3], { pubkey: USDC_MINT, isSigner: false, isWritable: false });

        const [expectedPda] = getOrderEscrowPDA(COMMITMENT);
        assert.deepStrictEqual(ix.keys[4], { pubkey: expectedPda, isSigner: false, isWritable: true });

        const expectedVault = getVaultATA(expectedPda);
        assert.deepStrictEqual(ix.keys[5], { pubkey: expectedVault, isSigner: false, isWritable: true });

        assert.deepStrictEqual(ix.keys[6], { pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
        assert.deepStrictEqual(ix.keys[7], { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false });
        assert.deepStrictEqual(ix.keys[8], { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false });

        assert.strictEqual(ix.data.length, 8 + 32 + 8 + 8);
        const expectedDiscriminator = Buffer.from([133, 110, 74, 175, 112, 159, 245, 159]);
        assert.ok(ix.data.subarray(0, 8).equals(expectedDiscriminator));
        assert.ok(ix.data.subarray(8, 40).equals(Buffer.from(COMMITMENT)));
        assert.strictEqual(ix.data.readBigUInt64LE(40), amount);
        assert.strictEqual(ix.data.readBigInt64LE(48), validExpiry);

        const textContent = ix.data.toString('utf8');
        assert.ok(!/[A-Za-z]{5,}/.test(textContent), "Should not contain raw PII strings");
    });

    test('Release Instruction', () => {
        const ix = createReleaseInstruction(DELIVERY_AUTHORITY, MERCHANT, INSTITUTION, COMMITMENT);

        const expectedDiscriminator = Buffer.from([253, 249, 15, 206, 28, 127, 193, 241]);
        assert.ok(ix.data.subarray(0, 8).equals(expectedDiscriminator));
        assert.ok(ix.data.subarray(8, 40).equals(Buffer.from(COMMITMENT)));

        assert.strictEqual(ix.keys.length, 9);
        assert.deepStrictEqual(ix.keys[0], { pubkey: DELIVERY_AUTHORITY, isSigner: true, isWritable: true });

        const [expectedPda] = getOrderEscrowPDA(COMMITMENT);
        const expectedVault = getVaultATA(expectedPda);
        assert.deepStrictEqual(ix.keys[1], { pubkey: expectedPda, isSigner: false, isWritable: true });
        assert.deepStrictEqual(ix.keys[2], { pubkey: expectedVault, isSigner: false, isWritable: true });
        assert.deepStrictEqual(ix.keys[3], { pubkey: USDC_MINT, isSigner: false, isWritable: false });
        assert.strictEqual(ix.keys[5].pubkey.toBase58(), MERCHANT.toBase58());
        const expectedInstitutionAta = getAssociatedTokenAddressSync(USDC_MINT, INSTITUTION);
        assert.strictEqual(ix.keys[6].pubkey.toBase58(), expectedInstitutionAta.toBase58());
        assert.strictEqual(ix.keys[7].pubkey.toBase58(), INSTITUTION.toBase58());
        assert.strictEqual(ix.keys[8].pubkey.toBase58(), TOKEN_PROGRAM_ID.toBase58());

        assert.throws(() => createReleaseInstruction(DELIVERY_AUTHORITY, MERCHANT, INSTITUTION, new Uint8Array(10)), /Commitment must be exactly 32 bytes/);
    });

    test('RefundTimeout Instruction', () => {
        const ix = createRefundTimeoutInstruction(INSTITUTION, COMMITMENT);

        const expectedDiscriminator = Buffer.from([142, 147, 135, 70, 231, 198, 23, 207]);
        assert.ok(ix.data.subarray(0, 8).equals(expectedDiscriminator));
        assert.ok(ix.data.subarray(8, 40).equals(Buffer.from(COMMITMENT)));

        assert.strictEqual(ix.keys.length, 6);
        assert.deepStrictEqual(ix.keys[0], { pubkey: INSTITUTION, isSigner: true, isWritable: true });

        const [expectedPda] = getOrderEscrowPDA(COMMITMENT);
        const expectedVault = getVaultATA(expectedPda);
        assert.deepStrictEqual(ix.keys[1], { pubkey: expectedPda, isSigner: false, isWritable: true });
        assert.deepStrictEqual(ix.keys[2], { pubkey: expectedVault, isSigner: false, isWritable: true });
        assert.deepStrictEqual(ix.keys[3], { pubkey: USDC_MINT, isSigner: false, isWritable: false });
        assert.strictEqual(ix.keys[5].pubkey.toBase58(), TOKEN_PROGRAM_ID.toBase58());

        assert.throws(() => createRefundTimeoutInstruction(INSTITUTION, new Uint8Array(10)), /Commitment must be exactly 32 bytes/);
    });

    test('Decoding terminal states and bad buffers', () => {
        const ACCOUNT_DISCRIMINATOR = Buffer.from([197, 239, 178, 120, 174, 113, 67, 180]);

        const buildAccountBuffer = (stateVal: number) => {
            const buf = Buffer.alloc(194);
            ACCOUNT_DISCRIMINATOR.copy(buf, 0);
            Buffer.from(COMMITMENT).copy(buf, 8);
            INSTITUTION.toBuffer().copy(buf, 40);
            MERCHANT.toBuffer().copy(buf, 72);
            DELIVERY_AUTHORITY.toBuffer().copy(buf, 104);
            USDC_MINT.toBuffer().copy(buf, 136);
            buf.writeBigUInt64LE(8000000n, 168);
            buf.writeBigInt64LE(1111111111n, 176);
            buf.writeUInt8(stateVal, 184);
            buf.writeBigInt64LE(stateVal === 0 ? 0n : 2222222222n, 185);
            buf.writeUInt8(254, 193);
            return buf;
        };

        const lockedDecoded = decodeOrderEscrow(buildAccountBuffer(0));
        assert.strictEqual(lockedDecoded.state, OrderState.Locked);
        assert.strictEqual(lockedDecoded.amount, 8000000n);
        assert.strictEqual(lockedDecoded.bump, 254);
        assert.ok(lockedDecoded.institution.equals(INSTITUTION));
        assert.ok(lockedDecoded.mint.equals(USDC_MINT));

        const releasedDecoded = decodeOrderEscrow(buildAccountBuffer(1));
        assert.strictEqual(releasedDecoded.state, OrderState.Released);

        const refundedDecoded = decodeOrderEscrow(buildAccountBuffer(2));
        assert.strictEqual(refundedDecoded.state, OrderState.Refunded);

        assert.throws(() => decodeOrderEscrow(buildAccountBuffer(3)), /Invalid OrderState/);
        assert.throws(() => decodeOrderEscrow(Buffer.alloc(193)), /Invalid account data length/);

        const badDiscBuf = buildAccountBuffer(0);
        badDiscBuf[0] = 0;
        assert.throws(() => decodeOrderEscrow(badDiscBuf), /Invalid account discriminator/);
    });
});
