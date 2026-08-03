import { createHash, randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import type { RoleAccessTokenService } from '../http/roleAccess.ts';
import { verifyOrderAccess } from '../http/specialOfferOrderRoutes.ts';

export type DeliveryEvidenceIssue = 'RECEIVED_OK' | 'DAMAGED' | 'WRONG_ITEM' | 'NOT_RECEIVED';
export type DeliveryEvidenceReview = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface DeliveryEvidence {
  evidenceId: string;
  caseId: string;
  orderId: string;
  issueType: DeliveryEvidenceIssue;
  source: 'USER_UPLOAD' | 'SYNTHETIC_DEMO';
  synthetic: boolean;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  byteLength: number;
  sha256: string;
  reviewState: DeliveryEvidenceReview;
  createdAt: number;
  reviewedAt?: number;
  reviewerHash?: string;
  dataBase64?: string;
  imageUrl?: string;
}

export interface DeliveryEvidenceRepository {
  create(value: DeliveryEvidence): Promise<void>;
  get(evidenceId: string): Promise<DeliveryEvidence | undefined>;
  list(caseId: string): Promise<DeliveryEvidence[]>;
  review(evidenceId: string, expectedCaseId: string, state: Exclude<DeliveryEvidenceReview, 'PENDING'>, reviewerHash: string, at: number): Promise<DeliveryEvidence>;
}

export class InMemoryDeliveryEvidenceRepository implements DeliveryEvidenceRepository {
  private readonly values = new Map<string, DeliveryEvidence>();
  async create(value: DeliveryEvidence): Promise<void> {
    if (this.values.has(value.evidenceId)) throw new Error('Evidence already exists');
    this.values.set(value.evidenceId, structuredClone(value));
  }
  async get(evidenceId: string): Promise<DeliveryEvidence | undefined> {
    const value = this.values.get(evidenceId);
    return value ? structuredClone(value) : undefined;
  }
  async list(caseId: string): Promise<DeliveryEvidence[]> {
    return [...this.values.values()].filter(value => value.caseId === caseId).sort((a, b) => b.createdAt - a.createdAt).map(value => structuredClone(value));
  }
  async review(evidenceId: string, expectedCaseId: string, state: Exclude<DeliveryEvidenceReview, 'PENDING'>, reviewerHash: string, at: number): Promise<DeliveryEvidence> {
    const current = this.values.get(evidenceId);
    if (!current || current.caseId !== expectedCaseId) throw new DeliveryEvidenceNotFoundError();
    const updated = { ...current, reviewState: state, reviewerHash, reviewedAt: at };
    this.values.set(evidenceId, updated);
    return structuredClone(updated);
  }
}

export class FirestoreDeliveryEvidenceRepository implements DeliveryEvidenceRepository {
  constructor(private readonly db = new Firestore()) {}
  async create(value: DeliveryEvidence): Promise<void> {
    await this.db.collection('deliveryEvidence').doc(value.evidenceId).create(value);
  }
  async get(evidenceId: string): Promise<DeliveryEvidence | undefined> {
    const snapshot = await this.db.collection('deliveryEvidence').doc(evidenceId).get();
    return snapshot.exists ? snapshot.data() as DeliveryEvidence : undefined;
  }
  async list(caseId: string): Promise<DeliveryEvidence[]> {
    const snapshot = await this.db.collection('deliveryEvidence').where('caseId', '==', caseId).limit(50).get();
    return snapshot.docs.map(doc => doc.data() as DeliveryEvidence).sort((a, b) => b.createdAt - a.createdAt);
  }
  async review(evidenceId: string, expectedCaseId: string, state: Exclude<DeliveryEvidenceReview, 'PENDING'>, reviewerHash: string, at: number): Promise<DeliveryEvidence> {
    const ref = this.db.collection('deliveryEvidence').doc(evidenceId);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.data()?.caseId !== expectedCaseId) throw new DeliveryEvidenceNotFoundError();
      const updated = { ...(snapshot.data() as DeliveryEvidence), reviewState: state, reviewerHash, reviewedAt: at };
      transaction.set(ref, updated);
      return updated;
    });
  }
}

export class DeliveryEvidenceInputError extends Error {}
export class DeliveryEvidenceNotFoundError extends Error {}

export function createDeliveryEvidenceHandlers(input: {
  repository: DeliveryEvidenceRepository;
  operatorSecret: string;
  roleTokens: RoleAccessTokenService;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  return async (request: { method: string; pathname: string; authorization?: string; body?: Record<string, unknown>; searchParams: URLSearchParams }) => {
    if (request.method === 'GET' && request.pathname === '/api/delivery-evidence/demo') {
      return { status: 200, body: { synthetic: true, evidence: syntheticEvidence() } };
    }
    if (request.method === 'POST' && request.pathname === '/api/delivery-evidence/upload') {
      const caseId = identifier(request.body?.caseId, 'caseId');
      const orderId = identifier(request.body?.orderId, 'orderId');
      const orderAccessToken = text(request.body?.orderAccessToken, 'orderAccessToken', 2048);
      const access = verifyOrderAccess(input.operatorSecret, orderAccessToken, orderId, now());
      if (!access || access.caseId !== caseId) return { status: 401, body: { error: 'Unauthorized delivery evidence upload' } };
      const issueType = issue(request.body?.issueType);
      const mimeType = mime(request.body?.mimeType);
      const dataBase64 = text(request.body?.dataBase64, 'dataBase64', 900_000);
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) throw new DeliveryEvidenceInputError('Invalid image encoding');
      const bytes = Buffer.from(dataBase64, 'base64');
      if (bytes.length < 16 || bytes.length > 600_000 || bytes.toString('base64').replace(/=+$/, '') !== dataBase64.replace(/=+$/, '')) {
        throw new DeliveryEvidenceInputError('Image must be between 16 and 600000 bytes');
      }
      validateMagic(bytes, mimeType);
      const value: DeliveryEvidence = {
        evidenceId: `evidence_${randomUUID()}`,
        caseId,
        orderId,
        issueType,
        source: 'USER_UPLOAD',
        synthetic: false,
        mimeType,
        byteLength: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        reviewState: 'PENDING',
        createdAt: now(),
        dataBase64
      };
      await input.repository.create(value);
      return { status: 201, body: publicEvidence(value, true) };
    }
    if (request.method === 'GET' && request.pathname === '/api/delivery-evidence/list') {
      const caseId = identifier(request.searchParams.get('caseId'), 'caseId');
      const orderId = request.searchParams.get('orderId') ?? '';
      const orderAccessToken = request.searchParams.get('orderAccessToken') ?? '';
      const orderAccess = orderId ? verifyOrderAccess(input.operatorSecret, orderAccessToken, orderId, now()) : undefined;
      const ops = verifyOps(input.roleTokens, request.authorization, caseId, 'read');
      if ((!orderAccess || orderAccess.caseId !== caseId) && !ops) return { status: 401, body: { error: 'Unauthorized delivery evidence read' } };
      const values = await input.repository.list(caseId);
      const visible = ops ? values : values.filter(value => value.orderId === orderId);
      return { status: 200, body: { caseId, evidence: visible.map(value => publicEvidence(value, true)) } };
    }
    if (request.method === 'POST' && request.pathname === '/api/delivery-evidence/review') {
      const caseId = identifier(request.body?.caseId, 'caseId');
      const claim = verifyOps(input.roleTokens, request.authorization, caseId, 'act');
      if (!claim) return { status: 403, body: { error: 'Ops action permission required' } };
      const evidenceId = evidenceIdentifier(request.body?.evidenceId);
      const reviewState = request.body?.reviewState;
      if (reviewState !== 'ACCEPTED' && reviewState !== 'REJECTED') throw new DeliveryEvidenceInputError('Invalid reviewState');
      const reviewerHash = createHash('sha256').update(`delivery-reviewer-v1:${claim.subjectId}`).digest('hex');
      const value = await input.repository.review(evidenceId, caseId, reviewState, reviewerHash, now());
      return { status: 200, body: publicEvidence(value, true) };
    }
    return { status: 404, body: { error: 'Not found' } };
  };
}

function verifyOps(tokens: RoleAccessTokenService, authorization: string | undefined, caseId: string, required: 'read' | 'act') {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
  const claim = tokens.verify('ops', token);
  return claim && claim.caseIds.includes(caseId) && (required === 'read' || claim.accessLevel === 'act') ? claim : undefined;
}

function publicEvidence(value: DeliveryEvidence, includeImage: boolean) {
  return {
    evidenceId: value.evidenceId,
    caseId: value.caseId,
    orderId: value.orderId,
    issueType: value.issueType,
    source: value.source,
    synthetic: value.synthetic,
    mimeType: value.mimeType,
    byteLength: value.byteLength,
    sha256: value.sha256,
    reviewState: value.reviewState,
    createdAt: value.createdAt,
    ...(value.reviewedAt ? { reviewedAt: value.reviewedAt } : {}),
    ...(includeImage && value.dataBase64 ? { imageDataUrl: `data:${value.mimeType};base64,${value.dataBase64}` } : {}),
    ...(value.imageUrl ? { imageUrl: value.imageUrl } : {})
  };
}

function syntheticEvidence() {
  const base = [
    ['synthetic_received_ok', 'synthetic_case_received', 'synthetic_order_received', 'RECEIVED_OK', '/assets/delivery-evidence/synthetic-received-ok.webp'],
    ['synthetic_damaged_rice', 'synthetic_case_damaged', 'synthetic_order_damaged', 'DAMAGED', '/assets/delivery-evidence/synthetic-damaged-rice.webp'],
    ['synthetic_wrong_item', 'synthetic_case_wrong', 'synthetic_order_wrong', 'WRONG_ITEM', '/assets/delivery-evidence/synthetic-wrong-item.webp']
  ] as const;
  return base.map(([evidenceId, caseId, orderId, issueType, imageUrl]) => ({
    evidenceId, caseId, orderId, issueType, imageUrl,
    source: 'SYNTHETIC_DEMO', synthetic: true, reviewState: issueType === 'RECEIVED_OK' ? 'ACCEPTED' : 'PENDING'
  }));
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new DeliveryEvidenceInputError(`Invalid ${name}`);
  return value;
}

function evidenceIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^evidence_[0-9a-f-]{36}$/.test(value)) throw new DeliveryEvidenceInputError('Invalid evidenceId');
  return value;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max) throw new DeliveryEvidenceInputError(`Invalid ${name}`);
  return value;
}

function issue(value: unknown): DeliveryEvidenceIssue {
  if (!['RECEIVED_OK', 'DAMAGED', 'WRONG_ITEM', 'NOT_RECEIVED'].includes(String(value))) throw new DeliveryEvidenceInputError('Invalid issueType');
  return value as DeliveryEvidenceIssue;
}

function mime(value: unknown): DeliveryEvidence['mimeType'] {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(String(value))) throw new DeliveryEvidenceInputError('Invalid mimeType');
  return value as DeliveryEvidence['mimeType'];
}

function validateMagic(bytes: Buffer, mimeType: DeliveryEvidence['mimeType']): void {
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  const webp = bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if ((mimeType === 'image/png' && !png) || (mimeType === 'image/jpeg' && !jpeg) || (mimeType === 'image/webp' && !webp)) {
    throw new DeliveryEvidenceInputError('Image bytes do not match mimeType');
  }
}
