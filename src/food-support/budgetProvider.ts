import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FoodSupportBudget } from './types.ts';

export interface FoodBudgetProvider {
  get(caseId: string): Promise<FoodSupportBudget | undefined>;
}

export class FileFoodBudgetProvider implements FoodBudgetProvider {
  constructor(private readonly filePath: string | undefined) {}

  async get(caseId: string): Promise<FoodSupportBudget | undefined> {
    if (!this.filePath) return undefined;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(caseId)) throw new Error('Invalid caseId');
    const metadata = await lstat(this.filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Food budget file must be a regular file');
    if (!isAllowedBudgetFileMode(this.filePath, metadata.mode)) {
      throw new Error('Food budget file must have mode 600 or stricter, or be a read-only Cloud Run secret mount');
    }
    const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as { cases?: Record<string, unknown> };
    const value = parsed.cases?.[caseId];
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid food budget record');
    const record = value as Record<string, unknown>;
    if (!Number.isSafeInteger(record.remainingKrw) || Number(record.remainingKrw) < 0
      || !Number.isSafeInteger(record.maximumPurchaseKrw) || Number(record.maximumPurchaseKrw) < 0) {
      throw new Error('Invalid food budget amounts');
    }
    return { remainingKrw: Number(record.remainingKrw), maximumPurchaseKrw: Number(record.maximumPurchaseKrw) };
  }
}

export function isAllowedBudgetFileMode(filePath: string, mode: number): boolean {
  const privateFile = (mode & 0o077) === 0;
  const cloudSecret = resolve(filePath).startsWith('/secrets/') && (mode & 0o777) === 0o444;
  return privateFile || cloudSecret;
}
