import { createHmac } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import type { SpecialOfferRecipient } from './specialOffer.ts';
import type { FoodSupportBudget } from './types.ts';
import type { ApprovalRequestCipher } from './approvalRequests.ts';

export type PhoneEnrollmentSource = 'INSTITUTION' | 'SYNTHETIC_DEMO';

export interface PhoneEnrollment {
  callerHash: string;
  beneficiaryRef: string;
  programId: string;
  planId: string;
  budget: FoodSupportBudget;
  source: PhoneEnrollmentSource;
  encryptedRecipient: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PhoneEnrollmentRepository {
  get(callerHash: string): Promise<PhoneEnrollment | undefined>;
  upsert(value: PhoneEnrollment): Promise<void>;
}

export class InMemoryPhoneEnrollmentRepository implements PhoneEnrollmentRepository {
  private readonly values = new Map<string, PhoneEnrollment>();
  async get(callerHash: string): Promise<PhoneEnrollment | undefined> {
    const value = this.values.get(callerHash);
    return value ? structuredClone(value) : undefined;
  }
  async upsert(value: PhoneEnrollment): Promise<void> {
    this.values.set(value.callerHash, structuredClone(value));
  }
}

export class FirestorePhoneEnrollmentRepository implements PhoneEnrollmentRepository {
  constructor(private readonly db = new Firestore()) {}
  async get(callerHash: string): Promise<PhoneEnrollment | undefined> {
    const snapshot = await this.db.collection('phoneFoodEnrollments').doc(callerHash).get();
    return snapshot.exists ? snapshot.data() as PhoneEnrollment : undefined;
  }
  async upsert(value: PhoneEnrollment): Promise<void> {
    await this.db.collection('phoneFoodEnrollments').doc(value.callerHash).set(value);
  }
}

export class PhoneEnrollmentService {
  constructor(
    private readonly repository: PhoneEnrollmentRepository,
    private readonly cipher: ApprovalRequestCipher,
    private readonly phoneHmacSecret: string,
    private readonly now: () => number = Date.now
  ) {
    if (Buffer.byteLength(phoneHmacSecret, 'utf8') < 32) throw new Error('Phone enrollment HMAC secret must be at least 32 bytes');
  }

  async enroll(input: {
    callerNumber: string;
    beneficiaryRef: string;
    programId: string;
    planId: string;
    budget: FoodSupportBudget;
    source: PhoneEnrollmentSource;
    recipient: Omit<SpecialOfferRecipient, 'recipientToken'>;
  }): Promise<Omit<PhoneEnrollment, 'encryptedRecipient'>> {
    const callerHash = this.hashCaller(input.callerNumber);
    const current = await this.repository.get(callerHash);
    const at = this.now();
    const value: PhoneEnrollment = {
      callerHash,
      beneficiaryRef: identifier(input.beneficiaryRef, 'beneficiaryRef'),
      programId: identifier(input.programId, 'programId'),
      planId: identifier(input.planId, 'planId'),
      budget: validBudget(input.budget),
      source: input.source,
      encryptedRecipient: this.cipher.encrypt(validRecipient(input.recipient)),
      active: true,
      createdAt: current?.createdAt ?? at,
      updatedAt: at
    };
    await this.repository.upsert(value);
    return safeEnrollment(value);
  }

  async resolve(callerNumber: string): Promise<Omit<PhoneEnrollment, 'encryptedRecipient'> | undefined> {
    const value = await this.repository.get(this.hashCaller(callerNumber));
    return value?.active ? safeEnrollment(value) : undefined;
  }

  async recipient(callerHash: string): Promise<Omit<SpecialOfferRecipient, 'recipientToken'> | undefined> {
    if (!/^[a-f0-9]{64}$/.test(callerHash)) return undefined;
    const value = await this.repository.get(callerHash);
    if (!value?.active) return undefined;
    return validRecipient(this.cipher.decrypt(value.encryptedRecipient));
  }

  private hashCaller(callerNumber: string): string {
    const normalized = normalizePhone(callerNumber);
    return createHmac('sha256', this.phoneHmacSecret).update(`phone-enrollment-v1:${normalized}`).digest('hex');
  }
}

function normalizePhone(value: string): string {
  if (typeof value !== 'string') throw new PhoneEnrollmentInputError('Invalid callerNumber');
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length < 10 || digits.length > 15) throw new PhoneEnrollmentInputError('Invalid callerNumber');
  return digits.startsWith('82') ? `0${digits.slice(2)}` : digits;
}

function identifier(value: string, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new PhoneEnrollmentInputError(`Invalid ${name}`);
  return value;
}

function validBudget(value: FoodSupportBudget): FoodSupportBudget {
  if (!value || !Number.isSafeInteger(value.remainingKrw) || value.remainingKrw < 0
    || !Number.isSafeInteger(value.maximumPurchaseKrw) || value.maximumPurchaseKrw < 0) {
    throw new PhoneEnrollmentInputError('Invalid budget');
  }
  return { remainingKrw: value.remainingKrw, maximumPurchaseKrw: value.maximumPurchaseKrw };
}

function validRecipient(value: unknown): Omit<SpecialOfferRecipient, 'recipientToken'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PhoneEnrollmentInputError('Invalid recipient');
  const input = value as Record<string, unknown>;
  const name = text(input.name, 'recipient.name', 100);
  const cellphone = text(input.cellphone, 'recipient.cellphone', 30);
  const zip = text(input.zip, 'recipient.zip', 20);
  const address = text(input.address, 'recipient.address', 300);
  const telephone = optionalText(input.telephone, 30) || cellphone;
  const memo = optionalText(input.memo, 200);
  return { name, cellphone, telephone, zip, address, ...(memo ? { memo } : {}) };
}

function text(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new PhoneEnrollmentInputError(`Invalid ${name}`);
  return value.trim();
}

function optionalText(value: unknown, maximum: number): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > maximum) throw new PhoneEnrollmentInputError('Invalid recipient');
  return value.trim();
}

function safeEnrollment(value: PhoneEnrollment): Omit<PhoneEnrollment, 'encryptedRecipient'> {
  const { encryptedRecipient: _encryptedRecipient, ...safe } = value;
  return structuredClone(safe);
}

export class PhoneEnrollmentInputError extends Error {}
