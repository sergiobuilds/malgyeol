import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';

export interface ApprovalRequest {
  requestId: string;
  caseId: string;
  status: 'PENDING' | 'SUBMITTED' | 'RECONCILIATION_REQUIRED' | 'FAILED' | 'REPLACED';
  productName: string;
  goodsNo: string;
  quantity: number;
  totalPriceKrw: number;
  consentCommitment: string;
  consentExpiresAt: number;
  maskedRecipient: string;
  maskedPhone: string;
  maskedAddress: string;
  encryptedPayload: string;
  createdAt: number;
  updatedAt: number;
  externalOrderId?: string;
  replacedByRequestId?: string;
}

export interface ApprovalRequestRepository {
  create(value: ApprovalRequest): Promise<void>;
  get(requestId: string): Promise<ApprovalRequest | undefined>;
  list(caseId: string): Promise<ApprovalRequest[]>;
  update(requestId: string, expectedStatus: ApprovalRequest['status'], patch: Partial<ApprovalRequest>): Promise<ApprovalRequest>;
}

export class InMemoryApprovalRequestRepository implements ApprovalRequestRepository {
  private readonly values = new Map<string, ApprovalRequest>();
  async create(value: ApprovalRequest): Promise<void> {
    if (this.values.has(value.requestId)) throw new Error('Approval request already exists');
    this.values.set(value.requestId, structuredClone(value));
  }
  async get(requestId: string): Promise<ApprovalRequest | undefined> {
    const value = this.values.get(requestId);
    return value ? structuredClone(value) : undefined;
  }
  async list(caseId: string): Promise<ApprovalRequest[]> {
    return [...this.values.values()].filter(value => value.caseId === caseId).sort((a, b) => b.createdAt - a.createdAt).map(value => structuredClone(value));
  }
  async update(requestId: string, expectedStatus: ApprovalRequest['status'], patch: Partial<ApprovalRequest>): Promise<ApprovalRequest> {
    const current = this.values.get(requestId);
    if (!current) throw new Error('Approval request not found');
    if (current.status !== expectedStatus) throw new Error('Approval request status conflict');
    const updated = { ...current, ...structuredClone(patch), requestId, caseId: current.caseId };
    this.values.set(requestId, updated);
    return structuredClone(updated);
  }
}

export class FirestoreApprovalRequestRepository implements ApprovalRequestRepository {
  constructor(private readonly db = new Firestore()) {}
  async create(value: ApprovalRequest): Promise<void> {
    await this.db.collection('foodApprovalRequests').doc(value.requestId).create(value);
  }
  async get(requestId: string): Promise<ApprovalRequest | undefined> {
    const snapshot = await this.db.collection('foodApprovalRequests').doc(requestId).get();
    return snapshot.exists ? snapshot.data() as ApprovalRequest : undefined;
  }
  async list(caseId: string): Promise<ApprovalRequest[]> {
    const snapshot = await this.db.collection('foodApprovalRequests').where('caseId', '==', caseId).get();
    return snapshot.docs.map(doc => doc.data() as ApprovalRequest).sort((a, b) => b.createdAt - a.createdAt);
  }
  async update(requestId: string, expectedStatus: ApprovalRequest['status'], patch: Partial<ApprovalRequest>): Promise<ApprovalRequest> {
    const ref = this.db.collection('foodApprovalRequests').doc(requestId);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error('Approval request not found');
      const current = snapshot.data() as ApprovalRequest;
      if (current.status !== expectedStatus) throw new Error('Approval request status conflict');
      const updated = { ...current, ...patch, requestId, caseId: current.caseId };
      transaction.set(ref, updated);
      return updated;
    });
  }
}

export class ApprovalRequestCipher {
  private readonly key: Buffer;
  constructor(encodedKey: string) {
    this.key = Buffer.from(encodedKey, 'base64');
    if (this.key.length !== 32 || this.key.toString('base64') !== encodedKey) throw new Error('APPROVAL_DATA_KEY_BASE64 must encode exactly 32 bytes');
  }
  encrypt(value: Record<string, unknown>): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
  }
  decrypt(value: string): Record<string, unknown> {
    const [version, ivText, tagText, ciphertextText, extra] = value.split('.');
    if (version !== 'v1' || !ivText || !tagText || !ciphertextText || extra) throw new Error('Invalid approval ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(plaintext) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid approval payload');
    return parsed as Record<string, unknown>;
  }
}

export function newApprovalRequestId(): string {
  return `approval_${randomUUID()}`;
}

export function publicApprovalRequest(value: ApprovalRequest) {
  const { encryptedPayload: _encryptedPayload, ...safe } = value;
  return safe;
}
