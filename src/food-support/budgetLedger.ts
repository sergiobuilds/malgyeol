import { createHash } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';

export interface FoodBudgetScope {
  beneficiaryRef: string;
  programId: string;
  periodKey: string;
}

export interface FoodBudgetReservation {
  caseId: string;
  scope: FoodBudgetScope;
  amountKrw: number;
  fingerprint: string;
  status: 'RESERVED' | 'COMMITTED' | 'RELEASED';
  createdAt: number;
  updatedAt: number;
}

export type FoodBudgetReserveResult =
  | { status: 'RESERVED' | 'EXISTING'; reservation: FoodBudgetReservation; availableKrw: number }
  | { status: 'INSUFFICIENT'; availableKrw: number }
  | { status: 'CONFLICT'; availableKrw: number };

export interface FoodBudgetLedger {
  reserve(input: { caseId: string; scope: FoodBudgetScope; allocationKrw: number; amountKrw: number; fingerprint: string; now: number }): Promise<FoodBudgetReserveResult>;
  commit(caseId: string, fingerprint: string, now: number): Promise<FoodBudgetReservation>;
  release(caseId: string, fingerprint: string, now: number): Promise<FoodBudgetReservation>;
  get(caseId: string): Promise<FoodBudgetReservation | undefined>;
}

interface AccountDocument {
  scope: FoodBudgetScope;
  allocationKrw: number;
  reservedKrw: number;
  committedKrw: number;
  updatedAt: number;
}

export class InMemoryFoodBudgetLedger implements FoodBudgetLedger {
  private readonly accounts = new Map<string, AccountDocument>();
  private readonly reservations = new Map<string, FoodBudgetReservation>();
  private queue: Promise<void> = Promise.resolve();

  async reserve(input: Parameters<FoodBudgetLedger['reserve']>[0]): Promise<FoodBudgetReserveResult> {
    return this.serial(() => reserveValue(this.accounts, this.reservations, input));
  }

  async commit(caseId: string, fingerprint: string, now: number): Promise<FoodBudgetReservation> {
    return this.serial(() => settleValue(this.accounts, this.reservations, caseId, fingerprint, 'COMMITTED', now));
  }

  async release(caseId: string, fingerprint: string, now: number): Promise<FoodBudgetReservation> {
    return this.serial(() => settleValue(this.accounts, this.reservations, caseId, fingerprint, 'RELEASED', now));
  }

  async get(caseId: string): Promise<FoodBudgetReservation | undefined> {
    const value = this.reservations.get(caseId);
    return value ? structuredClone(value) : undefined;
  }

  private async serial<T>(operation: () => T | Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
}

export class FirestoreFoodBudgetLedger implements FoodBudgetLedger {
  constructor(private readonly db = new Firestore()) {}

  async reserve(input: Parameters<FoodBudgetLedger['reserve']>[0]): Promise<FoodBudgetReserveResult> {
    validateReserve(input);
    const accountRef = this.db.collection('foodBudgetAccounts').doc(scopeId(input.scope));
    const reservationRef = this.db.collection('foodBudgetReservations').doc(input.caseId);
    return this.db.runTransaction(async transaction => {
      const [accountSnapshot, reservationSnapshot] = await Promise.all([
        transaction.get(accountRef), transaction.get(reservationRef)
      ]);
      const account = accountSnapshot.exists
        ? parseAccount(accountSnapshot.data())
        : newAccount(input.scope, input.allocationKrw, input.now);
      if (!sameScope(account.scope, input.scope)) {
        return { status: 'CONFLICT', availableKrw: available(account) } as const;
      }
      if (reservationSnapshot.exists) {
        const existing = parseReservation(reservationSnapshot.data());
        const same = sameScope(existing.scope, input.scope) && existing.amountKrw === input.amountKrw && existing.fingerprint === input.fingerprint;
        return same && existing.status !== 'RELEASED'
          ? { status: 'EXISTING', reservation: existing, availableKrw: available(account) } as const
          : { status: 'CONFLICT', availableKrw: available(account) } as const;
      }
      if (input.amountKrw > available(account)) return { status: 'INSUFFICIENT', availableKrw: available(account) } as const;
      const reservation = newReservation(input);
      const updated = { ...account, reservedKrw: account.reservedKrw + input.amountKrw, updatedAt: input.now };
      accountSnapshot.exists ? transaction.set(accountRef, updated) : transaction.create(accountRef, updated);
      transaction.create(reservationRef, reservation);
      return { status: 'RESERVED', reservation, availableKrw: available(updated) } as const;
    });
  }

  async commit(caseId: string, fingerprint: string, now: number): Promise<FoodBudgetReservation> {
    return this.settle(caseId, fingerprint, 'COMMITTED', now);
  }

  async release(caseId: string, fingerprint: string, now: number): Promise<FoodBudgetReservation> {
    return this.settle(caseId, fingerprint, 'RELEASED', now);
  }

  async get(caseId: string): Promise<FoodBudgetReservation | undefined> {
    const snapshot = await this.db.collection('foodBudgetReservations').doc(caseId).get();
    return snapshot.exists ? parseReservation(snapshot.data()) : undefined;
  }

  private async settle(caseId: string, fingerprint: string, next: 'COMMITTED' | 'RELEASED', now: number): Promise<FoodBudgetReservation> {
    validateCaseAndFingerprint(caseId, fingerprint, now);
    const reservationRef = this.db.collection('foodBudgetReservations').doc(caseId);
    return this.db.runTransaction(async transaction => {
      const reservationSnapshot = await transaction.get(reservationRef);
      if (!reservationSnapshot.exists) throw new Error('Budget reservation not found');
      const current = parseReservation(reservationSnapshot.data());
      if (current.fingerprint !== fingerprint) throw new Error('Budget reservation fingerprint conflict');
      if (current.status === next) return current;
      if (current.status !== 'RESERVED') throw new Error('Budget reservation is no longer active');
      const accountRef = this.db.collection('foodBudgetAccounts').doc(scopeId(current.scope));
      const accountSnapshot = await transaction.get(accountRef);
      if (!accountSnapshot.exists) throw new Error('Budget account not found');
      const account = parseAccount(accountSnapshot.data());
      if (account.reservedKrw < current.amountKrw) throw new Error('Budget account reservation mismatch');
      const updatedAccount = {
        ...account,
        reservedKrw: account.reservedKrw - current.amountKrw,
        committedKrw: account.committedKrw + (next === 'COMMITTED' ? current.amountKrw : 0),
        updatedAt: now
      };
      const updated = { ...current, status: next, updatedAt: now };
      transaction.set(accountRef, updatedAccount);
      transaction.set(reservationRef, updated);
      return updated;
    });
  }
}

function reserveValue(
  accounts: Map<string, AccountDocument>,
  reservations: Map<string, FoodBudgetReservation>,
  input: Parameters<FoodBudgetLedger['reserve']>[0]
): FoodBudgetReserveResult {
  validateReserve(input);
  const id = scopeId(input.scope);
  const account = accounts.get(id) ?? newAccount(input.scope, input.allocationKrw, input.now);
  if (!sameScope(account.scope, input.scope)) return { status: 'CONFLICT', availableKrw: available(account) };
  const existing = reservations.get(input.caseId);
  if (existing) {
    const same = sameScope(existing.scope, input.scope) && existing.amountKrw === input.amountKrw && existing.fingerprint === input.fingerprint;
    return same && existing.status !== 'RELEASED'
      ? { status: 'EXISTING', reservation: structuredClone(existing), availableKrw: available(account) }
      : { status: 'CONFLICT', availableKrw: available(account) };
  }
  if (input.amountKrw > available(account)) return { status: 'INSUFFICIENT', availableKrw: available(account) };
  const reservation = newReservation(input);
  accounts.set(id, { ...account, reservedKrw: account.reservedKrw + input.amountKrw, updatedAt: input.now });
  reservations.set(input.caseId, reservation);
  return { status: 'RESERVED', reservation: structuredClone(reservation), availableKrw: available(accounts.get(id)!) };
}

function settleValue(
  accounts: Map<string, AccountDocument>,
  reservations: Map<string, FoodBudgetReservation>,
  caseId: string,
  fingerprint: string,
  next: 'COMMITTED' | 'RELEASED',
  now: number
): FoodBudgetReservation {
  validateCaseAndFingerprint(caseId, fingerprint, now);
  const current = reservations.get(caseId);
  if (!current) throw new Error('Budget reservation not found');
  if (current.fingerprint !== fingerprint) throw new Error('Budget reservation fingerprint conflict');
  if (current.status === next) return structuredClone(current);
  if (current.status !== 'RESERVED') throw new Error('Budget reservation is no longer active');
  const id = scopeId(current.scope);
  const account = accounts.get(id);
  if (!account || account.reservedKrw < current.amountKrw) throw new Error('Budget account reservation mismatch');
  accounts.set(id, {
    ...account,
    reservedKrw: account.reservedKrw - current.amountKrw,
    committedKrw: account.committedKrw + (next === 'COMMITTED' ? current.amountKrw : 0),
    updatedAt: now
  });
  const updated = { ...current, status: next, updatedAt: now };
  reservations.set(caseId, updated);
  return structuredClone(updated);
}

function validateReserve(input: Parameters<FoodBudgetLedger['reserve']>[0]): void {
  validateCaseAndFingerprint(input.caseId, input.fingerprint, input.now);
  validateScope(input.scope);
  if (!Number.isSafeInteger(input.allocationKrw) || input.allocationKrw < 0) throw new Error('Invalid budget allocation');
  if (!Number.isSafeInteger(input.amountKrw) || input.amountKrw < 1) throw new Error('Invalid reservation amount');
}

function validateCaseAndFingerprint(caseId: string, fingerprint: string, now: number): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(caseId)) throw new Error('Invalid budget caseId');
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Invalid budget fingerprint');
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid budget timestamp');
}

function validateScope(scope: FoodBudgetScope): void {
  for (const value of [scope.beneficiaryRef, scope.programId, scope.periodKey]) {
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) throw new Error('Invalid budget scope');
  }
}

function scopeId(scope: FoodBudgetScope): string {
  validateScope(scope);
  return createHash('sha256').update(JSON.stringify([scope.beneficiaryRef, scope.programId, scope.periodKey])).digest('hex');
}

function newAccount(scope: FoodBudgetScope, allocationKrw: number, now: number): AccountDocument {
  return { scope: structuredClone(scope), allocationKrw, reservedKrw: 0, committedKrw: 0, updatedAt: now };
}

function newReservation(input: Parameters<FoodBudgetLedger['reserve']>[0]): FoodBudgetReservation {
  return {
    caseId: input.caseId, scope: structuredClone(input.scope), amountKrw: input.amountKrw,
    fingerprint: input.fingerprint, status: 'RESERVED', createdAt: input.now, updatedAt: input.now
  };
}

function available(account: AccountDocument): number {
  return account.allocationKrw - account.reservedKrw - account.committedKrw;
}

function sameScope(left: FoodBudgetScope, right: FoodBudgetScope): boolean {
  return left.beneficiaryRef === right.beneficiaryRef && left.programId === right.programId && left.periodKey === right.periodKey;
}

function parseAccount(value: unknown): AccountDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid budget account');
  const row = value as AccountDocument;
  validateScope(row.scope);
  for (const amount of [row.allocationKrw, row.reservedKrw, row.committedKrw]) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid budget account amount');
  }
  if (!Number.isSafeInteger(row.updatedAt)) throw new Error('Invalid budget account timestamp');
  return row;
}

function parseReservation(value: unknown): FoodBudgetReservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid budget reservation');
  const row = value as FoodBudgetReservation;
  validateCaseAndFingerprint(row.caseId, row.fingerprint, row.updatedAt);
  validateScope(row.scope);
  if (!Number.isSafeInteger(row.amountKrw) || row.amountKrw < 1 || !Number.isSafeInteger(row.createdAt)) throw new Error('Invalid budget reservation amount');
  if (!['RESERVED', 'COMMITTED', 'RELEASED'].includes(row.status)) throw new Error('Invalid budget reservation status');
  return row;
}
