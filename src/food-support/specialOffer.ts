import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  DeliveryState,
  ExternalOrderReadback,
  FoodProduct,
  FoodOrderConsent,
  FoodPolicyDecision,
  FoodVoucherCategory,
  OriginStatus
} from './types.ts';
import { buildFoodOrderConsent, consentStillValid } from './policy.ts';

const DEFAULT_BASE_URL = 'https://specialoffer.kr';

export interface SpecialOfferCredentialProvider {
  getCredential(): Promise<string | undefined>;
}

export class FileSpecialOfferCredentialProvider implements SpecialOfferCredentialProvider {
  constructor(private readonly filePath: string | undefined) {}

  async getCredential(): Promise<string | undefined> {
    if (!this.filePath) return undefined;
    const metadata = await lstat(this.filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('SpecialOffer credential must be a regular file');
    if (!isAllowedCredentialFileMode(this.filePath, metadata.mode)) {
      throw new Error('SpecialOffer credential file must have mode 600 or stricter, or be a read-only Cloud Run secret mount');
    }
    const value = (await readFile(this.filePath, 'utf8')).trim();
    if (value.length < 16 || value.length > 4096) throw new Error('Invalid SpecialOffer credential');
    return value;
  }
}

export function isAllowedCredentialFileMode(filePath: string, mode: number): boolean {
  const permissionBits = mode & 0o777;
  const privateFile = (mode & 0o077) === 0;
  const normalizedPath = resolve(filePath);
  const cloudRunSecretMount = normalizedPath.startsWith('/secrets/') && permissionBits === 0o444;
  return privateFile || cloudRunSecretMount;
}

export class CallbackSpecialOfferCredentialProvider implements SpecialOfferCredentialProvider {
  constructor(private readonly loadSecret: () => Promise<string | undefined>) {}
  async getCredential(): Promise<string | undefined> {
    const value = (await this.loadSecret())?.trim();
    if (!value) return undefined;
    if (value.length < 16 || value.length > 4096) throw new Error('Invalid SpecialOffer credential');
    return value;
  }
}

export type CatalogSearchResult =
  | { status: 'CREDENTIAL_GATED'; products: []; exactMatch: false }
  | { status: 'LIVE'; products: FoodProduct[]; exactMatch: boolean };

export class SpecialOfferHttpError extends Error {
  constructor(readonly status: number) {
    super(`SpecialOffer request failed with HTTP ${status}`);
  }
}

export class SpecialOfferCatalogAdapter {
  constructor(
    private readonly credentials: SpecialOfferCredentialProvider,
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = DEFAULT_BASE_URL
  ) {}

  async search(input: { query: string; exactName?: string; perPage?: number }): Promise<CatalogSearchResult> {
    const credential = await this.credentials.getCredential();
    if (!credential) return { status: 'CREDENTIAL_GATED', products: [], exactMatch: false };
    const perPage = Math.max(1, Math.min(input.perPage ?? 30, 100));
    const query = input.query.normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
    const exact = input.exactName?.normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
    const categoryParents = categoryParentsForQuery(query);
    const rows = categoryParents.length > 0
      ? await this.searchFoodCategories(categoryParents, credential)
      : await this.searchLatest(perPage, credential);
    const products = rows
      .map(parseSpecialOfferProduct)
      .filter((product): product is FoodProduct => product !== undefined)
      .filter(product => isLikelyFoodProductName(product.name))
      .filter(product => categoryParents.length === 0 || product.category !== 'OUT_OF_POLICY')
      .filter(product => categoryParents.length > 0 || !query || product.name.toLocaleLowerCase('ko-KR').includes(query));
    const ranked = exact ? rankByNameSimilarity(products, exact) : products;
    const limited = ranked.slice(0, perPage);
    const exactMatch = exact !== undefined && limited.some(product => normalizeProductName(product.name) === exact);
    return { status: 'LIVE', products: limited, exactMatch };
  }

  private async searchLatest(perPage: number, credential: string): Promise<Record<string, unknown>[]> {
    const url = new URL('/api/goods', this.baseUrl);
    url.searchParams.set('state', '1');
    url.searchParams.set('page', '1');
    url.searchParams.set('per_page', String(perPage));
    return objectArray(record(await requestJson(this.fetcher, url, credential)).data);
  }

  private async searchFoodCategories(parents: string[], credential: string): Promise<Record<string, unknown>[]> {
    const categoryPayloads = await Promise.all(parents.map(async parent => {
      const url = new URL('/api/categories', this.baseUrl);
      url.searchParams.set('parent_code', parent);
      url.searchParams.set('per_page', '100');
      return objectArray(record(await requestJson(this.fetcher, url, credential)).data);
    }));
    const categoryCodes = [...new Set(categoryPayloads.flat()
      .map(row => optionalString(row.code))
      .filter((value): value is string => Boolean(value)))]
      .slice(0, 20);
    const productPayloads = await Promise.all(categoryCodes.map(async categoryCode => {
      const url = new URL('/api/goods', this.baseUrl);
      url.searchParams.set('category_code', categoryCode);
      url.searchParams.set('state', '1');
      url.searchParams.set('page', '1');
      url.searchParams.set('per_page', '100');
      return objectArray(record(await requestJson(this.fetcher, url, credential)).data);
    }));
    console.info(JSON.stringify({
      event: 'specialoffer_food_category_search',
      parentCount: parents.length,
      categoryCount: categoryCodes.length,
      rowCount: productPayloads.reduce((sum, rows) => sum + rows.length, 0)
    }));
    return productPayloads.flat();
  }

  async get(goodsNo: string): Promise<{ status: 'CREDENTIAL_GATED' } | { status: 'LIVE'; product: FoodProduct }> {
    const credential = await this.credentials.getCredential();
    if (!credential) return { status: 'CREDENTIAL_GATED' };
    const safeGoodsNo = requiredIdentifier(goodsNo, 'goodsNo');
    const payload = await requestJson(this.fetcher, new URL(`/api/goods/${safeGoodsNo}`, this.baseUrl), credential);
    const product = parseSpecialOfferProduct(record(payload).data);
    if (!product) throw new Error('SpecialOffer returned an invalid product');
    return { status: 'LIVE', product };
  }
}

function rankByNameSimilarity(products: FoodProduct[], requestedName: string): FoodProduct[] {
  const requestedPairs = characterPairs(requestedName);
  return products
    .map((product, index) => ({ product, index, score: sharedPairCount(characterPairs(normalizeProductName(product.name)), requestedPairs) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(value => value.product);
}

function normalizeProductName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
}

function characterPairs(value: string): Set<string> {
  const compact = value.replace(/[^\p{L}\p{N}]/gu, '');
  const pairs = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) pairs.add(compact.slice(index, index + 2));
  return pairs;
}

function sharedPairCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const pair of left) if (right.has(pair)) count += 1;
  return count;
}

export interface SpecialOfferRecipient {
  name: string;
  telephone?: string;
  cellphone: string;
  zip: string;
  address: string;
  memo?: string;
  recipientToken: string;
}

export interface SpecialOfferOrderInput {
  caseId: string;
  product: FoodProduct;
  quantity: number;
  options?: string[];
  addSupply?: string[];
  shippingFeePayment: 0 | 1;
  recipient: SpecialOfferRecipient;
  consent: FoodOrderConsent;
  policyDecision: FoodPolicyDecision;
  now: number;
  paidActionApproval?: PaidActionApproval;
}

export interface PaidActionApproval {
  token: string;
  expiresAt: number;
}

export interface PaidActionApprovalVerifier {
  verify(input: SpecialOfferOrderInput): boolean;
}

export interface ExternalActionApproval { token: string; expiresAt: number; }
export interface ExternalActionApprovalVerifier {
  verify(input: { orderId: string; reason: string; approval?: ExternalActionApproval; now: number }): boolean;
}

export class DenyExternalActionApprovalVerifier implements ExternalActionApprovalVerifier {
  verify(): boolean { return false; }
}

export class HmacExternalActionApprovalVerifier implements ExternalActionApprovalVerifier {
  constructor(private readonly secret: string) {
    if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('External action approval secret must be at least 32 bytes');
  }
  issue(input: { orderId: string; reason: string; now: number }, expiresAt: number): ExternalActionApproval {
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= input.now) throw new Error('Invalid external action expiry');
    return { expiresAt, token: this.sign(input.orderId, input.reason, expiresAt) };
  }
  verify(input: { orderId: string; reason: string; approval?: ExternalActionApproval; now: number }): boolean {
    if (!input.approval || input.now > input.approval.expiresAt || !/^[a-f0-9]{64}$/.test(input.approval.token)) return false;
    const supplied = Buffer.from(input.approval.token, 'hex');
    const expected = Buffer.from(this.sign(input.orderId, input.reason, input.approval.expiresAt), 'hex');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
  private sign(orderId: string, reason: string, expiresAt: number): string {
    return createHmac('sha256', this.secret).update(JSON.stringify({ version: 'special-offer-external-action-v1', orderId, reason, expiresAt })).digest('hex');
  }
}

export class DenyPaidActionApprovalVerifier implements PaidActionApprovalVerifier {
  verify(): boolean { return false; }
}

export class HmacPaidActionApprovalVerifier implements PaidActionApprovalVerifier {
  constructor(private readonly secret: string) {
    if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('Paid action approval secret must be at least 32 bytes');
  }

  issue(input: Omit<SpecialOfferOrderInput, 'paidActionApproval'>, expiresAt: number): PaidActionApproval {
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= input.now) throw new Error('Invalid paid action approval expiry');
    return { expiresAt, token: this.sign(input, expiresAt) };
  }

  verify(input: SpecialOfferOrderInput): boolean {
    const approval = input.paidActionApproval;
    if (!approval || input.now > approval.expiresAt || !/^[a-f0-9]{64}$/.test(approval.token)) return false;
    const supplied = Buffer.from(approval.token, 'hex');
    const expected = Buffer.from(this.sign(input, approval.expiresAt), 'hex');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  private sign(input: Omit<SpecialOfferOrderInput, 'paidActionApproval'> | SpecialOfferOrderInput, expiresAt: number): string {
    return createHmac('sha256', this.secret).update(JSON.stringify({
      version: 'special-offer-paid-action-v1', caseId: input.caseId, goodsNo: input.product.goodsNo,
      sellerCode: input.product.sellerCode, quantity: input.quantity, consentCommitment: input.consent.commitment,
      policySnapshotHash: input.policyDecision.policySnapshotHash, recipientToken: input.recipient.recipientToken, expiresAt
    })).digest('hex');
  }
}

export interface SpecialOfferOrderPreview {
  status: 'READY_FOR_PAID_APPROVAL';
  caseId: string;
  externalKey: string;
  goodsNo: string;
  sellerCode: string;
  productName: string;
  quantity: number;
  goodsPriceKrw: number;
  shippingFeeKrw: number;
  totalPriceKrw: number;
  maskedRecipient: string;
  maskedPhone: string;
  maskedAddress: string;
  returnNotice: string;
  consentCommitment: string;
}

export type SpecialOfferSubmitResult =
  | { status: 'CREDENTIAL_GATED' }
  | { status: 'PAID_ACTION_REQUIRED'; preview: SpecialOfferOrderPreview }
  | { status: 'SUBMITTED'; order: ExternalOrderReadback; replayed: boolean }
  | { status: 'ORDER_RECONCILIATION_REQUIRED'; retryable: false; reason: 'IN_FLIGHT' | 'AMBIGUOUS_RESPONSE' };

export type PaidOrderExecutionClaim =
  | { status: 'CLAIMED' }
  | { status: 'IN_FLIGHT'; claimedAt: number; leaseExpired: boolean }
  | { status: 'COMPLETED'; order: ExternalOrderReadback }
  | { status: 'CONFLICT' };

export interface PaidOrderExpectation {
  sellerCode: string;
  goodsNo: string;
  goodsName: string;
  quantity: number;
  totalPriceKrw: number;
}

export interface PaidOrderExecutionRecord {
  fingerprint: string;
  status: 'IN_FLIGHT' | 'COMPLETED';
  claimedAt: number;
  expectation?: PaidOrderExpectation;
  order?: ExternalOrderReadback;
}

export interface PaidOrderExecutionStore {
  claim(caseId: string, fingerprint: string, expectation: PaidOrderExpectation, now: number, leaseMs: number): Promise<PaidOrderExecutionClaim>;
  complete(caseId: string, fingerprint: string, order: ExternalOrderReadback, now: number): Promise<void>;
  getCompleted(caseId: string): Promise<ExternalOrderReadback | undefined>;
  get(caseId: string): Promise<PaidOrderExecutionRecord | undefined>;
}

export class InMemoryPaidOrderExecutionStore implements PaidOrderExecutionStore {
  private readonly values = new Map<string, PaidOrderExecutionRecord>();

  async claim(caseId: string, fingerprint: string, expectation: PaidOrderExpectation, now: number, leaseMs: number): Promise<PaidOrderExecutionClaim> {
    const existing = this.values.get(caseId);
    if (!existing) {
      this.values.set(caseId, { fingerprint, expectation: structuredClone(expectation), status: 'IN_FLIGHT', claimedAt: now });
      return { status: 'CLAIMED' };
    }
    if (existing.fingerprint !== fingerprint) return { status: 'CONFLICT' };
    return existing.status === 'COMPLETED' && existing.order
      ? { status: 'COMPLETED', order: existing.order }
      : { status: 'IN_FLIGHT', claimedAt: existing.claimedAt, leaseExpired: now >= existing.claimedAt + leaseMs };
  }

  async complete(caseId: string, fingerprint: string, order: ExternalOrderReadback): Promise<void> {
    const existing = this.values.get(caseId);
    if (!existing || existing.fingerprint !== fingerprint) throw new Error('Paid order execution claim mismatch');
    this.values.set(caseId, { ...existing, status: 'COMPLETED', order: structuredClone(order) });
  }

  async getCompleted(caseId: string): Promise<ExternalOrderReadback | undefined> {
    const value = this.values.get(caseId);
    return value?.status === 'COMPLETED' ? structuredClone(value.order) : undefined;
  }

  async get(caseId: string): Promise<PaidOrderExecutionRecord | undefined> {
    const value = this.values.get(caseId);
    return value ? structuredClone(value) : undefined;
  }
}

export class SpecialOfferOrderAdapter {
  constructor(
    private readonly credentials: SpecialOfferCredentialProvider,
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = DEFAULT_BASE_URL,
    private readonly paidActionVerifier: PaidActionApprovalVerifier = new DenyPaidActionApprovalVerifier(),
    private readonly externalActionVerifier: ExternalActionApprovalVerifier = new DenyExternalActionApprovalVerifier(),
    private readonly executions: PaidOrderExecutionStore = new InMemoryPaidOrderExecutionStore(),
    private readonly executionLeaseMs = 2 * 60_000
  ) {}

  preview(input: SpecialOfferOrderInput): SpecialOfferOrderPreview {
    validateOrderInput(input);
    return {
      status: 'READY_FOR_PAID_APPROVAL',
      caseId: input.caseId,
      externalKey: input.caseId,
      goodsNo: input.product.goodsNo,
      sellerCode: input.product.sellerCode,
      productName: input.product.name,
      quantity: input.quantity,
      goodsPriceKrw: input.product.unitPriceKrw * input.quantity,
      shippingFeeKrw: input.product.shippingFeeKrw,
      totalPriceKrw: input.product.unitPriceKrw * input.quantity + input.product.shippingFeeKrw,
      maskedRecipient: maskName(input.recipient.name),
      maskedPhone: maskPhone(input.recipient.cellphone),
      maskedAddress: maskAddress(input.recipient.address),
      returnNotice: input.product.refundable === false
        ? input.product.nonRefundableConditions || '반품이 제한되는 상품입니다.'
        : input.product.refundable === 'CONDITIONAL'
          ? input.product.nonRefundableConditions || '조건에 따라 반품이 제한될 수 있습니다.'
          : '상품 상태와 판매자 조건에 따라 반품할 수 있습니다.',
      consentCommitment: input.consent.commitment
    };
  }

  async submit(input: SpecialOfferOrderInput): Promise<SpecialOfferSubmitResult> {
    const preview = this.preview(input);
    const credential = await this.credentials.getCredential();
    if (!credential) return { status: 'CREDENTIAL_GATED' };
    if (!this.paidActionVerifier.verify(input)) return { status: 'PAID_ACTION_REQUIRED', preview };
    const fingerprint = orderFingerprint(input);
    const claim = await this.executions.claim(input.caseId, fingerprint, orderExpectation(input), input.now, this.executionLeaseMs);
    if (claim.status === 'CONFLICT') throw new Error('Idempotency conflict for caseId');
    if (claim.status === 'IN_FLIGHT') return { status: 'ORDER_RECONCILIATION_REQUIRED', retryable: false, reason: 'IN_FLIGHT' };
    if (claim.status === 'COMPLETED') return { status: 'SUBMITTED', order: claim.order, replayed: true };
    const result = await this.performSubmit(input, credential);
    if (result.status === 'SUBMITTED') await this.executions.complete(input.caseId, fingerprint, result.order, Date.now());
    return result;
  }

  async getByOrderId(orderId: string): Promise<{ status: 'CREDENTIAL_GATED' } | { status: 'LIVE'; order: ExternalOrderReadback }> {
    const credential = await this.credentials.getCredential();
    if (!credential) return { status: 'CREDENTIAL_GATED' };
    const safeOrderId = requiredIdentifier(orderId, 'orderId');
    const payload = await requestJson(this.fetcher, new URL(`/api/v2/orders/${safeOrderId}`, this.baseUrl), credential);
    return { status: 'LIVE', order: parseOrderReadback(record(payload).data) };
  }

  async getCompletedByCaseId(caseId: string): Promise<ExternalOrderReadback | undefined> {
    requiredIdentifier(caseId, 'caseId');
    return this.executions.getCompleted(caseId);
  }

  async reconcile(input: { caseId: string; orderId: string; now: number }): Promise<
    | { status: 'NOT_READY'; retryAfter: number }
    | { status: 'NOT_FOUND' | 'MISMATCH' }
    | { status: 'COMPLETED'; order: ExternalOrderReadback }
    | { status: 'CREDENTIAL_GATED' }
  > {
    requiredIdentifier(input.caseId, 'caseId');
    requiredIdentifier(input.orderId, 'orderId');
    const execution = await this.executions.get(input.caseId);
    if (!execution) return { status: 'NOT_FOUND' };
    if (execution.status === 'COMPLETED' && execution.order) return { status: 'COMPLETED', order: execution.order };
    if (input.now < execution.claimedAt + this.executionLeaseMs) {
      return { status: 'NOT_READY', retryAfter: execution.claimedAt + this.executionLeaseMs };
    }
    if (!execution.expectation) return { status: 'MISMATCH' };
    let result: Awaited<ReturnType<SpecialOfferOrderAdapter['getByOrderId']>>;
    try { result = await this.getByOrderId(input.orderId); } catch (error) {
      if (error instanceof SpecialOfferHttpError && error.status === 404) return { status: 'NOT_FOUND' };
      throw error;
    }
    if (result.status !== 'LIVE') return result;
    if (!matchesExpectation(result.order, execution.expectation)) return { status: 'MISMATCH' };
    const order = { ...result.order, caseId: input.caseId };
    await this.executions.complete(input.caseId, execution.fingerprint, order, input.now);
    return { status: 'COMPLETED', order };
  }

  async getByOrderNo(orderNo: string): Promise<{ status: 'CREDENTIAL_GATED' } | { status: 'LIVE'; orders: ExternalOrderReadback[] }> {
    const credential = await this.credentials.getCredential();
    if (!credential) return { status: 'CREDENTIAL_GATED' };
    const safeOrderNo = requiredIdentifier(orderNo, 'orderNo');
    const payload = await requestJson(this.fetcher, new URL(`/api/v2/orders/order-no/${safeOrderNo}`, this.baseUrl), credential);
    return { status: 'LIVE', orders: objectArray(record(payload).data).map(parseOrderReadback) };
  }

  async cancel(input: { orderId: string; reason: string; approval?: ExternalActionApproval; now: number }): Promise<{ status: 'CREDENTIAL_GATED' | 'EXTERNAL_ACTION_REQUIRED' | 'CANCEL_REQUESTED' }> {
    const credential = await this.credentials.getCredential();
    if (!credential) return { status: 'CREDENTIAL_GATED' };
    const orderId = requiredIdentifier(input.orderId, 'orderId');
    const reason = requiredText(input.reason, 'reason', 200);
    if (!this.externalActionVerifier.verify({ orderId, reason, ...(input.approval ? { approval: input.approval } : {}), now: input.now })) return { status: 'EXTERNAL_ACTION_REQUIRED' };
    await requestJson(this.fetcher, new URL(`/api/v2/orders/${orderId}/cancel`, this.baseUrl), credential, {
      method: 'POST', body: JSON.stringify({ reason })
    });
    return { status: 'CANCEL_REQUESTED' };
  }

  private async performSubmit(input: SpecialOfferOrderInput, credential: string): Promise<SpecialOfferSubmitResult> {
    try {
      const payload = await requestJson(this.fetcher, new URL('/api/v2/orders', this.baseUrl), credential, {
        method: 'POST',
        body: JSON.stringify({
          goods_no: Number(input.product.goodsNo),
          ...(input.options ? { options: input.options } : {}),
          qty: input.quantity,
          ...(input.addSupply ? { add_supply: input.addSupply } : {}),
          shipping_fee_type: input.shippingFeePayment,
          receiver_name: input.recipient.name,
          ...(input.recipient.telephone ? { receiver_telephone: input.recipient.telephone } : {}),
          receiver_cellphone: input.recipient.cellphone,
          receiver_zip: input.recipient.zip,
          receiver_addr: input.recipient.address,
          ...(input.recipient.memo ? { memo: input.recipient.memo } : {}),
          external_key: input.caseId
        })
      });
      const order = parseOrderReadback(record(payload).data);
      if (order.sellerCode !== input.product.sellerCode
        || (order.goodsNo ? order.goodsNo !== input.product.goodsNo : order.goodsName !== input.product.name)
        || order.quantity !== input.quantity
        || order.totalPriceKrw !== input.product.unitPriceKrw * input.quantity + input.product.shippingFeeKrw) {
        throw new Error('SpecialOffer order response does not match the approved order');
      }
      return { status: 'SUBMITTED', order: { ...order, caseId: input.caseId }, replayed: false };
    } catch {
      return { status: 'ORDER_RECONCILIATION_REQUIRED', retryable: false, reason: 'AMBIGUOUS_RESPONSE' };
    }
  }
}

export class RecipientDeliveryTracker {
  private readonly states = new Map<string, DeliveryState>();

  syncProviderOrder(order: ExternalOrderReadback): DeliveryState {
    const current = this.states.get(order.externalOrderId);
    if (current === 'RECIPIENT_CONFIRMED' || current === 'DELIVERY_DISPUTED') return current;
    this.states.set(order.externalOrderId, order.deliveryState);
    return order.deliveryState;
  }

  markCarrierDelivered(orderId: string): DeliveryState {
    const current = this.states.get(orderId);
    if (current !== 'SHIPPED' && current !== 'CARRIER_DELIVERED') throw new Error('Carrier delivery requires a shipped order');
    this.states.set(orderId, 'CARRIER_DELIVERED');
    return 'CARRIER_DELIVERED';
  }

  confirmRecipient(orderId: string, response: 'RECEIVED' | 'NOT_RECEIVED' | 'ITEM_PROBLEM'): DeliveryState {
    const current = this.states.get(orderId);
    if (current !== 'CARRIER_DELIVERED' && current !== 'DELIVERY_DISPUTED') throw new Error('Recipient confirmation requires carrier delivery');
    const next = response === 'RECEIVED' ? 'RECIPIENT_CONFIRMED' : 'DELIVERY_DISPUTED';
    this.states.set(orderId, next);
    return next;
  }
}

export function parseSpecialOfferProduct(value: unknown): FoodProduct | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const goodsNo = stringNumber(row.no ?? row.goods_no);
  const name = optionalString(row.name);
  if (!goodsNo || !name) return undefined;
  const origin = optionalString(row.origin) ?? '';
  const stockType = optionalString(row.stock_type) ?? '0';
  const stockQuantity = numberValue(row.stock_qty ?? row.stock_quantity, 0);
  const price = numberValue(row.price ?? row.supply_price, 0);
  const state = numberValue(row.state, 1);
  const refundableValue = optionalString(row.is_refundable);
  return {
    goodsNo,
    goodsCode: optionalString(row.code ?? row.goods_code) ?? '',
    sellerCode: optionalString(row.seller_code) ?? '',
    name,
    category: inferFoodCategory(name),
    origin,
    originStatus: inferOriginStatus(origin),
    unitPriceKrw: price,
    shippingFeeKrw: numberValue(row.shipping_fee, 0),
    inStock: stockType === '0' || stockQuantity > 0,
    selling: state === 1,
    deliveryAvailable: optionalString(row.is_overseas_shipping) !== 'Y',
    refundable: refundableValue === '1' ? true : refundableValue === '3' ? 'CONDITIONAL' : false,
    nonRefundableConditions: optionalString(row.non_refundable_conditions ?? row.seller_notice) ?? '',
    orderCutoff: optionalString(row.order_end_at) ?? '',
    detailUrl: optionalString(row.detail_url ?? row.goods_info_url) ?? `https://specialoffer.kr/shop/view.php?index_no=${goodsNo}`,
    source: 'SPECIAL_OFFER_LIVE'
  };
}

function categoryParentsForQuery(query: string): string[] {
  if (/잡곡|혼합곡|오곡|영양쌀/.test(query)) return ['540503'];
  if (/보리|현미|찹쌀|흑미/.test(query)) return ['540502'];
  if (/쌀|곡물|곡류/.test(query)) return ['540503', '540502', '540501'];
  if (/고구마|감자|무|당근|뿌리채소/.test(query)) return ['540504'];
  if (/배추|상추|시금치|잎채소/.test(query)) return ['540505'];
  if (/오이|고추|토마토|열매채소/.test(query)) return ['540506'];
  if (/돼지고기|돼지|삼겹살/.test(query)) return ['540513'];
  if (/닭|계란|달걀/.test(query)) return ['540515'];
  if (/소고기|한우/.test(query)) return ['540517'];
  if (/생선|수산물|해산물/.test(query)) return ['540521', '540522'];
  if (/과일|사과|배|귤|딸기|포도/.test(query)) return ['540526'];
  return [];
}

function isLikelyFoodProductName(name: string): boolean {
  const normalized = name.normalize('NFKC').toLocaleLowerCase('ko-KR');
  return !/(페인트|수성페인트|양초|캔들|쌀통|쌀함박|믹싱볼|세척봉|스푼|숟가락|채반|모종삽|지퍼백|롤팩|보관함|포장지|스크래퍼)/.test(normalized);
}

export function inferFoodCategory(name: string): FoodVoucherCategory {
  const normalized = name.normalize('NFKC');
  const patterns: ReadonlyArray<[FoodVoucherCategory, RegExp]> = [
    ['INSTANT_NOODLES', /라면/], ['WHITE_RICE', /(^|\s)백미|흰쌀/], ['SEAFOOD', /생선|조개|오징어|수산/],
    ['PROCESSED_FOOD', /초콜릿|과자|음료|가공|즉석/], ['MIXED_GRAINS', /잡곡|흑미|현미|보리|찹쌀/],
    ['WHITE_RICE', /쌀/],
    ['DOMESTIC_FRUIT', /사과|배|복숭아|살구|포도|감귤|과일/],
    ['DOMESTIC_VEGETABLE', /양파|감자|채소|야채|당근|배추/], ['WHITE_MILK', /흰우유|우유/],
    ['FRESH_EGGS', /달걀|계란|유정란/], ['TOFU', /두부/], ['FOREST_NUTS', /밤|잣|호두/],
    ['MEAT', /소고기|쇠고기|돼지고기|닭고기|육류/]
  ];
  return patterns.find(([, pattern]) => pattern.test(normalized))?.[0] ?? 'OUT_OF_POLICY';
}

export function inferOriginStatus(origin: string): OriginStatus {
  const normalized = origin.normalize('NFKC').trim();
  if (!normalized || /상세.*참조|기타|미상/.test(normalized)) return 'UNKNOWN';
  if (/해외|중국|미국|호주|수입/.test(normalized)) return 'FOREIGN';
  if (/국내산|국산|대한민국|한국/.test(normalized)) return 'DOMESTIC';
  return 'UNKNOWN';
}

export function parseOrderReadback(value: unknown): ExternalOrderReadback {
  const row = record(value);
  const externalOrderId = requiredStringNumber(row.order_id, 'order_id');
  const externalOrderNo = requiredStringNumber(row.order_no, 'order_no');
  const providerOrderState = numberValue(row.order_state, 0);
  const trackingNumber = optionalString(row.delivery_no);
  return {
    ...(stringNumber(row.goods_no) ? { goodsNo: stringNumber(row.goods_no)! } : {}),
    externalOrderId,
    externalOrderNo,
    sellerCode: optionalString(row.seller_code) ?? '',
    goodsName: optionalString(row.goods_name) ?? '',
    quantity: numberValue(row.sum_qty, 0),
    goodsPriceKrw: numberValue(row.goods_price, 0),
    shippingFeeKrw: numberValue(row.shipping_fee, 0),
    totalPriceKrw: numberValue(row.total_price, 0),
    providerOrderState,
    deliveryState: trackingNumber ? 'SHIPPED' : providerOrderState === 0 ? 'ORDER_ACCEPTED' : 'PREPARING',
    ...(optionalString(row.delivery_company) ? { deliveryCompany: optionalString(row.delivery_company)! } : {}),
    ...(trackingNumber ? { trackingNumber } : {}),
    ...(optionalString(row.delivery_date) ? { shippedAt: optionalString(row.delivery_date)! } : {}),
    source: 'SPECIAL_OFFER_LIVE'
  };
}

async function requestJson(fetcher: typeof fetch, url: URL, credential: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetcher(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${credential}`, accept: 'application/json', 'content-type': 'application/json', ...init.headers }
  });
  if (!response.ok) throw new SpecialOfferHttpError(response.status);
  return response.json();
}

function validateOrderInput(input: SpecialOfferOrderInput): void {
  requiredIdentifier(input.caseId, 'caseId');
  requiredIdentifier(input.product.goodsNo, 'goodsNo');
  requiredText(input.product.sellerCode, 'sellerCode', 128);
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) throw new Error('Invalid quantity');
  requiredText(input.recipient.name, 'recipient name', 100);
  requiredText(input.recipient.cellphone, 'recipient cellphone', 30);
  requiredText(input.recipient.zip, 'recipient zip', 20);
  requiredText(input.recipient.address, 'recipient address', 300);
  requiredText(input.recipient.recipientToken, 'recipient token', 256);
  if (!Number.isSafeInteger(input.now) || input.now < 0) throw new Error('Invalid current time');
  validateConsent(input);
}

function orderFingerprint(input: SpecialOfferOrderInput): string {
  return createHash('sha256').update(JSON.stringify({
    caseId: input.caseId, goodsNo: input.product.goodsNo, sellerCode: input.product.sellerCode,
    quantity: input.quantity, unitPriceKrw: input.product.unitPriceKrw,
    shippingFeeKrw: input.product.shippingFeeKrw, recipientToken: input.recipient.recipientToken,
    consentCommitment: input.consent.commitment, options: input.options ?? [], addSupply: input.addSupply ?? []
  })).digest('hex');
}

function orderExpectation(input: SpecialOfferOrderInput): PaidOrderExpectation {
  return {
    sellerCode: input.product.sellerCode,
    goodsNo: input.product.goodsNo,
    goodsName: input.product.name,
    quantity: input.quantity,
    totalPriceKrw: input.product.unitPriceKrw * input.quantity + input.product.shippingFeeKrw
  };
}

function matchesExpectation(order: ExternalOrderReadback, expectation: PaidOrderExpectation): boolean {
  return order.sellerCode === expectation.sellerCode
    && (order.goodsNo ? order.goodsNo === expectation.goodsNo : order.goodsName === expectation.goodsName)
    && order.quantity === expectation.quantity
    && order.totalPriceKrw === expectation.totalPriceKrw;
}

function validateConsent(input: SpecialOfferOrderInput): void {
  const consent = input.consent;
  const rebuilt = buildFoodOrderConsent({
    caseId: consent.caseId,
    goodsNo: consent.goodsNo,
    sellerCode: consent.sellerCode,
    quantity: consent.quantity,
    unitPriceKrw: consent.unitPriceKrw,
    shippingFeeKrw: consent.shippingFeeKrw,
    totalPriceKrw: consent.totalPriceKrw,
    recipientToken: consent.recipientToken,
    policySnapshotHash: consent.policySnapshotHash,
    expiresAt: consent.expiresAt
  });
  if (!/^[a-f0-9]{64}$/.test(consent.commitment)) throw new Error('Invalid consent commitment');
  const supplied = Buffer.from(consent.commitment, 'hex');
  const expected = Buffer.from(rebuilt.commitment, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('Invalid consent commitment');
  if (consent.caseId !== input.caseId || consent.totalPriceKrw !== input.product.unitPriceKrw * input.quantity + input.product.shippingFeeKrw) {
    throw new Error('Consent does not match the order');
  }
  if (!consentStillValid(consent, {
    goodsNo: input.product.goodsNo,
    sellerCode: input.product.sellerCode,
    quantity: input.quantity,
    unitPriceKrw: input.product.unitPriceKrw,
    shippingFeeKrw: input.product.shippingFeeKrw,
    recipientToken: input.recipient.recipientToken,
    policySnapshotHash: input.policyDecision.policySnapshotHash,
    now: input.now
  })) throw new Error('Consent is expired or stale');
  const approvedLine = input.policyDecision.lines.some(line => line.goodsNo === input.product.goodsNo && line.decision === 'APPROVED');
  if (!approvedLine || input.policyDecision.policySnapshotHash !== consent.policySnapshotHash) throw new Error('Policy does not approve this order');
}

function maskName(value: string): string {
  const chars = [...value.trim()];
  if (chars.length <= 1) return '*';
  return `${chars[0]}${'*'.repeat(Math.max(1, chars.length - 1))}`;
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

function maskAddress(value: string): string {
  const parts = value.trim().split(/\s+/);
  return parts.length <= 2 ? `${parts[0] ?? ''} ***` : `${parts.slice(0, 2).join(' ')} ***`;
}

function requiredIdentifier(value: string, name: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`Invalid ${name}`);
  return value;
}

function requiredText(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`Invalid ${name}`);
  return normalized;
}

function requiredStringNumber(value: unknown, name: string): string {
  const result = stringNumber(value);
  if (!result) throw new Error(`SpecialOffer response is missing ${name}`);
  return result;
}

function stringNumber(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SpecialOffer returned an invalid payload');
  return value as Record<string, unknown>;
}

function objectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('SpecialOffer returned an invalid list');
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
}
