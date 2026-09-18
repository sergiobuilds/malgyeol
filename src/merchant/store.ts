import { Firestore, type DocumentData } from '@google-cloud/firestore';
import type { MerchantTrackingState } from '../e2e/merchantAdapter.ts';

export interface SandboxOrderInput {
  caseId: string;
  sku: string;
  quantity: number;
  merchantId: 'DEMO_ACCESS_STORE';
  programAmountKrw: number;
  paymentAuthorizationId: string;
}

export interface StoredSandboxOrder {
  input: SandboxOrderInput;
  fingerprint: string;
  providerOrderId: string;
  state: MerchantTrackingState;
}

export type CreateOrderResult =
  | { outcome: 'created' | 'replayed'; order: StoredSandboxOrder }
  | { outcome: 'conflict' };

export type AdvanceTrackingResult =
  | { outcome: 'advanced' | 'replayed'; order: StoredSandboxOrder }
  | { outcome: 'not_found' }
  | { outcome: 'invalid_transition'; state: MerchantTrackingState };

export interface MerchantSandboxStore {
  create(order: StoredSandboxOrder): Promise<CreateOrderResult>;
  get(providerOrderId: string): Promise<StoredSandboxOrder | undefined>;
  advance(providerOrderId: string, state: MerchantTrackingState): Promise<AdvanceTrackingResult>;
}

const transitions: Record<MerchantTrackingState, MerchantTrackingState | undefined> = {
  ORDERED: 'PACKED', PACKED: 'SHIPPED', SHIPPED: 'DELIVERED', DELIVERED: undefined
};

export class InMemoryMerchantSandboxStore implements MerchantSandboxStore {
  private readonly byOrderId = new Map<string, StoredSandboxOrder>();

  async create(order: StoredSandboxOrder): Promise<CreateOrderResult> {
    const existing = this.byOrderId.get(order.providerOrderId);
    if (existing) {
      return existing.fingerprint === order.fingerprint
        ? { outcome: 'replayed', order: clone(existing) }
        : { outcome: 'conflict' };
    }
    this.byOrderId.set(order.providerOrderId, clone(order));
    return { outcome: 'created', order: clone(order) };
  }

  async get(providerOrderId: string): Promise<StoredSandboxOrder | undefined> {
    const order = this.byOrderId.get(providerOrderId);
    return order ? clone(order) : undefined;
  }

  async advance(providerOrderId: string, state: MerchantTrackingState): Promise<AdvanceTrackingResult> {
    const order = this.byOrderId.get(providerOrderId);
    if (!order) return { outcome: 'not_found' };
    if (order.state === state) return { outcome: 'replayed', order: clone(order) };
    if (transitions[order.state] !== state) return { outcome: 'invalid_transition', state: order.state };
    order.state = state;
    return { outcome: 'advanced', order: clone(order) };
  }
}

export class FirestoreMerchantSandboxStore implements MerchantSandboxStore {
  constructor(
    private readonly db = new Firestore(),
    private readonly collectionName = 'merchantSandboxOrders'
  ) {}

  async create(order: StoredSandboxOrder): Promise<CreateOrderResult> {
    const ref = this.db.collection(this.collectionName).doc(order.providerOrderId);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) {
        const existing = decode(snapshot.data());
        return existing.fingerprint === order.fingerprint
          ? { outcome: 'replayed', order: existing }
          : { outcome: 'conflict' };
      }
      transaction.create(ref, encode(order));
      return { outcome: 'created', order: clone(order) };
    });
  }

  async get(providerOrderId: string): Promise<StoredSandboxOrder | undefined> {
    const snapshot = await this.db.collection(this.collectionName).doc(providerOrderId).get();
    return snapshot.exists ? decode(snapshot.data()) : undefined;
  }

  async advance(providerOrderId: string, state: MerchantTrackingState): Promise<AdvanceTrackingResult> {
    const ref = this.db.collection(this.collectionName).doc(providerOrderId);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return { outcome: 'not_found' };
      const order = decode(snapshot.data());
      if (order.state === state) return { outcome: 'replayed', order };
      if (transitions[order.state] !== state) return { outcome: 'invalid_transition', state: order.state };
      const advanced = { ...order, state };
      transaction.update(ref, { state });
      return { outcome: 'advanced', order: advanced };
    });
  }
}

function encode(order: StoredSandboxOrder): DocumentData {
  return {
    caseId: order.input.caseId,
    sku: order.input.sku,
    quantity: order.input.quantity,
    merchantId: order.input.merchantId,
    programAmountKrw: order.input.programAmountKrw,
    paymentAuthorizationId: order.input.paymentAuthorizationId,
    fingerprint: order.fingerprint,
    providerOrderId: order.providerOrderId,
    state: order.state
  };
}

function decode(value: DocumentData | undefined): StoredSandboxOrder {
  if (!value || !isString(value.caseId) || !isString(value.sku) || !Number.isSafeInteger(value.quantity)
    || value.merchantId !== 'DEMO_ACCESS_STORE' || !Number.isSafeInteger(value.programAmountKrw)
    || !isString(value.paymentAuthorizationId) || !isString(value.fingerprint)
    || !isString(value.providerOrderId) || !isState(value.state)) {
    throw new Error('Corrupt merchant sandbox order');
  }
  return {
    input: {
      caseId: value.caseId,
      sku: value.sku,
      quantity: value.quantity as number,
      merchantId: value.merchantId,
      programAmountKrw: value.programAmountKrw as number,
      paymentAuthorizationId: value.paymentAuthorizationId
    },
    fingerprint: value.fingerprint,
    providerOrderId: value.providerOrderId,
    state: value.state
  };
}

function isString(value: unknown): value is string { return typeof value === 'string'; }
function isState(value: unknown): value is MerchantTrackingState {
  return value === 'ORDERED' || value === 'PACKED' || value === 'SHIPPED' || value === 'DELIVERED';
}
function clone(order: StoredSandboxOrder): StoredSandboxOrder {
  return { ...order, input: { ...order.input } };
}
