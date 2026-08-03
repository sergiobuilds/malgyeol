import {
    PublicKey,
    TransactionInstruction,
    SystemProgram,
    Connection
} from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync
} from '@solana/spl-token';

export const PROGRAM_ID = new PublicKey('5y8JA9jj4MNPLzPveGkEkfpaXRyqnXjffiC1yZ2UnUNv');
export const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

const DISCRIMINATORS = {
    initializeOrder: Buffer.from([133, 110, 74, 175, 112, 159, 245, 159]),
    refundTimeout: Buffer.from([142, 147, 135, 70, 231, 198, 23, 207]),
    release: Buffer.from([253, 249, 15, 206, 28, 127, 193, 241]),
    orderEscrow: Buffer.from([197, 239, 178, 120, 174, 113, 67, 180])
};

export const OrderState = {
    Locked: 0,
    Released: 1,
    Refunded: 2
} as const;
export type OrderState = (typeof OrderState)[keyof typeof OrderState];

export interface OrderEscrow {
    commitment: Uint8Array;
    institution: PublicKey;
    merchant: PublicKey;
    deliveryAuthority: PublicKey;
    mint: PublicKey;
    amount: bigint;
    expiresAt: bigint;
    state: OrderState;
    terminalAt: bigint;
    bump: number;
}

function isZeroCommitment(commitment: Uint8Array): boolean {
    for (let index = 0; index < commitment.length; index += 1) {
        if (commitment[index] !== 0) return false;
    }
    return true;
}

export function getOrderEscrowPDA(commitment: Uint8Array): [PublicKey, number] {
    if (commitment.length !== 32) {
        throw new Error("Commitment must be exactly 32 bytes");
    }
    if (isZeroCommitment(commitment)) {
        throw new Error("Commitment cannot be zero");
    }
    return PublicKey.findProgramAddressSync(
        [Buffer.from('order'), commitment],
        PROGRAM_ID
    );
}

export function getVaultATA(orderEscrowPDA: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(
        USDC_MINT,
        orderEscrowPDA,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );
}

export function decodeOrderEscrow(data: Buffer): OrderEscrow {
    if (data.length !== 194) {
        throw new Error("Invalid account data length");
    }
    const discriminator = data.subarray(0, 8);
    if (!discriminator.equals(DISCRIMINATORS.orderEscrow)) {
        throw new Error("Invalid account discriminator");
    }

    let offset = 8;
    const commitment = new Uint8Array(data.subarray(offset, offset + 32));
    offset += 32;
    const institution = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;
    const merchant = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;
    const deliveryAuthority = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;
    const mint = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;
    const amount = data.readBigUInt64LE(offset);
    offset += 8;
    const expiresAt = data.readBigInt64LE(offset);
    offset += 8;
    const stateVal = data.readUInt8(offset);
    let state: OrderState;
    if (stateVal === 0) state = OrderState.Locked;
    else if (stateVal === 1) state = OrderState.Released;
    else if (stateVal === 2) state = OrderState.Refunded;
    else throw new Error("Invalid OrderState");
    offset += 1;
    const terminalAt = data.readBigInt64LE(offset);
    offset += 8;
    const bump = data.readUInt8(offset);

    if (!mint.equals(USDC_MINT)) throw new Error("Invalid canonical mint");
    if (amount <= 0n) throw new Error("Amount must be greater than zero");
    if (state === OrderState.Locked && terminalAt !== 0n) throw new Error("Terminal timestamp must be 0 for Locked state");
    if (state !== OrderState.Locked && terminalAt === 0n) throw new Error("Terminal timestamp must be non-zero for terminal states");

    return {
        commitment,
        institution,
        merchant,
        deliveryAuthority,
        mint,
        amount,
        expiresAt,
        state,
        terminalAt,
        bump
    };
}

export async function fetchOrderEscrow(
    connection: Connection,
    commitment: Uint8Array
): Promise<OrderEscrow | null> {
    const [pda, expectedBump] = getOrderEscrowPDA(commitment);
    const accountInfo = await connection.getAccountInfo(pda);
    if (!accountInfo) return null;
    if (!accountInfo.owner.equals(PROGRAM_ID)) throw new Error("Invalid account owner");
    const decoded = decodeOrderEscrow(accountInfo.data as Buffer);
    if (Buffer.compare(Buffer.from(decoded.commitment), Buffer.from(commitment)) !== 0) throw new Error("Commitment mismatch");
    if (decoded.bump !== expectedBump) throw new Error("Bump mismatch");
    return decoded;
}

export function createInitializeOrderInstruction(
    institution: PublicKey,
    merchant: PublicKey,
    deliveryAuthority: PublicKey,
    commitment: Uint8Array,
    amount: bigint,
    expiresAt: bigint
): TransactionInstruction {
    if (commitment.length !== 32) {
        throw new Error("Commitment must be exactly 32 bytes");
    }
    if (isZeroCommitment(commitment)) {
        throw new Error("Commitment cannot be zero");
    }
    if (amount <= 0n) {
        throw new Error("Amount must be greater than zero");
    }
    if (institution.equals(PublicKey.default) || merchant.equals(PublicKey.default) || deliveryAuthority.equals(PublicKey.default)) {
        throw new Error("Invalid participant key");
    }
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (expiresAt <= now) {
        throw new Error("Expiry must be in the future");
    }
    const MAX_EXPIRY_DURATION = 7n * 24n * 60n * 60n;
    if (expiresAt > now + MAX_EXPIRY_DURATION) {
        throw new Error("Expiry cannot be more than 7 days ahead");
    }
    if (institution.equals(merchant) || institution.equals(deliveryAuthority) || merchant.equals(deliveryAuthority)) {
        throw new Error("Parties must be distinct");
    }

    const [orderEscrow] = getOrderEscrowPDA(commitment);
    const vault = getVaultATA(orderEscrow);

    const data = Buffer.alloc(8 + 32 + 8 + 8);
    let offset = 0;
    DISCRIMINATORS.initializeOrder.copy(data, offset);
    offset += 8;
    Buffer.from(commitment).copy(data, offset);
    offset += 32;
    data.writeBigUInt64LE(amount, offset);
    offset += 8;
    data.writeBigInt64LE(expiresAt, offset);

    return new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: institution, isSigner: true, isWritable: true },
            { pubkey: merchant, isSigner: false, isWritable: false },
            { pubkey: deliveryAuthority, isSigner: false, isWritable: false },
            { pubkey: USDC_MINT, isSigner: false, isWritable: false },
            { pubkey: orderEscrow, isSigner: false, isWritable: true },
            { pubkey: vault, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
        ],
        data
    });
}

export function createReleaseInstruction(
    deliveryAuthority: PublicKey,
    merchant: PublicKey,
    institution: PublicKey,
    commitment: Uint8Array
): TransactionInstruction {
    if (commitment.length !== 32) {
        throw new Error("Commitment must be exactly 32 bytes");
    }
    if (isZeroCommitment(commitment)) {
        throw new Error("Commitment cannot be zero");
    }
    const [orderEscrow] = getOrderEscrowPDA(commitment);
    const vault = getVaultATA(orderEscrow);
    const merchantAta = getAssociatedTokenAddressSync(
        USDC_MINT,
        merchant,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const institutionAta = getAssociatedTokenAddressSync(
        USDC_MINT,
        institution,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const data = Buffer.alloc(8 + 32);
    DISCRIMINATORS.release.copy(data, 0);
    Buffer.from(commitment).copy(data, 8);

    return new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: deliveryAuthority, isSigner: true, isWritable: true },
            { pubkey: orderEscrow, isSigner: false, isWritable: true },
            { pubkey: vault, isSigner: false, isWritable: true },
            { pubkey: USDC_MINT, isSigner: false, isWritable: false },
            { pubkey: merchantAta, isSigner: false, isWritable: true },
            { pubkey: merchant, isSigner: false, isWritable: false },
            { pubkey: institutionAta, isSigner: false, isWritable: true },
            { pubkey: institution, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
        ],
        data
    });
}

export function createRefundTimeoutInstruction(
    institution: PublicKey,
    commitment: Uint8Array
): TransactionInstruction {
    if (commitment.length !== 32) {
        throw new Error("Commitment must be exactly 32 bytes");
    }
    if (isZeroCommitment(commitment)) {
        throw new Error("Commitment cannot be zero");
    }
    const [orderEscrow] = getOrderEscrowPDA(commitment);
    const vault = getVaultATA(orderEscrow);
    const institutionAta = getAssociatedTokenAddressSync(
        USDC_MINT,
        institution,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const data = Buffer.alloc(8 + 32);
    DISCRIMINATORS.refundTimeout.copy(data, 0);
    Buffer.from(commitment).copy(data, 8);

    return new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: institution, isSigner: true, isWritable: true },
            { pubkey: orderEscrow, isSigner: false, isWritable: true },
            { pubkey: vault, isSigner: false, isWritable: true },
            { pubkey: USDC_MINT, isSigner: false, isWritable: false },
            { pubkey: institutionAta, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
        ],
        data
    });
}
