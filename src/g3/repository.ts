import { writeFile, readFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MandateRepository, PolicyMandate, RepositoryOperationResult, AuthorizationState } from './types.ts';
import { hashMandate } from './policyHash.ts';

export interface PersistedData {
  mandates: Record<string, PolicyMandate>;
  nonces: Record<string, AuthorizationState>;
}

export class JsonMandateRepository implements MandateRepository {
  private filePath: string;
  private lock: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn);
    this.lock = next.then(() => {}).catch(() => {});
    return next;
  }

  async readState(): Promise<PersistedData> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content);
      if (!parsed || typeof parsed !== 'object' || !parsed.mandates || !parsed.nonces) {
        throw new Error('Invalid schema');
      }

      const mandates: Record<string, PolicyMandate> = {};
      for (const [key, value] of Object.entries(parsed.mandates)) {
        if (!value || typeof value !== 'object') throw new Error('Invalid schema: mandate');
        const mandate = value as Record<string, unknown>;
        const restored: PolicyMandate = {
          mandateId: String(mandate.mandateId),
          revision: Number(mandate.revision),
          fundId: String(mandate.fundId),
          approvedSku: String(mandate.approvedSku),
          merchantId: String(mandate.merchantId),
          mint: String(mandate.mint),
          escrowDestination: String(mandate.escrowDestination),
          exactAmount: BigInt(String(mandate.exactAmount)),
          validFrom: Number(mandate.validFrom),
          validUntil: Number(mandate.validUntil),
          remainingBalance: BigInt(String(mandate.remainingBalance)),
          revoked: mandate.revoked === true
        };
        validateMandate(restored);
        if (key !== restored.mandateId) throw new Error('Invalid schema: mandate key mismatch');
        mandates[key] = restored;
      }

      const nonces: Record<string, AuthorizationState> = {};
      for (const [key, value] of Object.entries(parsed.nonces)) {
        if (value !== 'RESERVED' && value !== 'SIGNED' && value !== 'SIGN_FAILED') {
          throw new Error('Invalid schema: nonce state');
        }
        nonces[key] = value as AuthorizationState;
      }
      return { mandates, nonces };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { mandates: {}, nonces: {} };
      throw new Error(`Data loading failed: ${(error as Error).message}`);
    }
  }

  private async saveData(data: PersistedData): Promise<void> {
    const serialized = JSON.stringify(data, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2);
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = join(dirname(this.filePath), `temp-${randomUUID()}.json`);
    await writeFile(tempPath, serialized, { encoding: 'utf8', mode: 0o600 });
    await rename(tempPath, this.filePath);
  }

  async getMandate(mandateId: string): Promise<PolicyMandate | undefined> {
    return this.withLock(async () => {
      const mandate = (await this.readState()).mandates[mandateId];
      return mandate ? { ...mandate } : undefined;
    });
  }

  async reserve(mandateId: string, revision: number, expectedMandateHash: string, amount: bigint, nonce: string): Promise<RepositoryOperationResult> {
    return this.withLock(async () => {
      const data = await this.readState();
      if (data.nonces[nonce]) return { success: false, reason: 'Replay: nonce already exists in a terminal state' };
      const mandate = data.mandates[mandateId];
      if (!mandate) return { success: false, reason: 'Mandate not found' };
      if (mandate.revision !== revision) return { success: false, reason: 'Revision mismatch' };
      if (hashMandate(mandate) !== expectedMandateHash) return { success: false, reason: 'Policy snapshot mismatch' };
      if (mandate.revoked) return { success: false, reason: 'Mandate is revoked' };
      if (mandate.remainingBalance < amount) return { success: false, reason: 'Insufficient balance' };
      mandate.remainingBalance -= amount;
      data.nonces[nonce] = 'RESERVED';
      await this.saveData(data);
      return { success: true, mandate: { ...mandate } };
    });
  }

  async markTerminalState(nonce: string, state: 'SIGNED' | 'SIGN_FAILED'): Promise<void> {
    return this.withLock(async () => {
      const data = await this.readState();
      if (!data.nonces[nonce]) throw new Error('Nonce not found');
      if (data.nonces[nonce] !== 'RESERVED') throw new Error('Nonce is already in a final state');
      data.nonces[nonce] = state;
      await this.saveData(data);
    });
  }

  async createOrUpdateMandate(mandate: PolicyMandate): Promise<void> {
    validateMandate(mandate);
    return this.withLock(async () => {
      const data = await this.readState();
      const current = data.mandates[mandate.mandateId];
      if (current && mandate.revision <= current.revision) throw new Error('Mandate revision must increase');
      data.mandates[mandate.mandateId] = { ...mandate };
      await this.saveData(data);
    });
  }

  async revokeMandate(mandateId: string, revision: number): Promise<void> {
    return this.withLock(async () => {
      const data = await this.readState();
      const mandate = data.mandates[mandateId];
      if (!mandate) throw new Error('Mandate not found');
      if (mandate.revision !== revision) throw new Error('Revision mismatch');
      mandate.revoked = true;
      await this.saveData(data);
    });
  }
}

function validateMandate(mandate: PolicyMandate): void {
  if (!mandate.mandateId || !mandate.fundId || !mandate.approvedSku || !mandate.merchantId || !mandate.mint || !mandate.escrowDestination) {
    throw new Error('Invalid mandate identity fields');
  }
  if (!Number.isSafeInteger(mandate.revision) || mandate.revision <= 0) throw new Error('Invalid mandate revision');
  if (!Number.isSafeInteger(mandate.validFrom) || !Number.isSafeInteger(mandate.validUntil) || mandate.validFrom >= mandate.validUntil) {
    throw new Error('Invalid mandate validity window');
  }
  if (mandate.exactAmount <= 0n || mandate.remainingBalance < 0n) throw new Error('Invalid mandate balance');
}
