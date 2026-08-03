import type { SpecialOfferOrderAdapter } from '../food-support/specialOffer.ts';

export const PUBLIC_FOOD_ORDER_PROOF_ID = '585492';

export function createPublicFoodOrderProofReader(
  orders: Pick<SpecialOfferOrderAdapter, 'getByOrderId'>,
  options: { ttlMs?: number; now?: () => number } = {}
) {
  const ttlMs = options.ttlMs ?? 60_000;
  const now = options.now ?? Date.now;
  let cached: { expiresAt: number; result: Awaited<ReturnType<typeof readPublicFoodOrderProof>> } | undefined;
  let inFlight: Promise<Awaited<ReturnType<typeof readPublicFoodOrderProof>>> | undefined;
  return async () => {
    const at = now();
    if (cached && at < cached.expiresAt) return cached.result;
    if (inFlight) return inFlight;
    inFlight = readPublicFoodOrderProof(orders, at).then(result => {
      if (result.status === 200) cached = { expiresAt: at + ttlMs, result };
      return result;
    }).finally(() => { inFlight = undefined; });
    return inFlight;
  };
}

export async function readPublicFoodOrderProof(orders: Pick<SpecialOfferOrderAdapter, 'getByOrderId'>, refreshedAt = Date.now()) {
  const result = await orders.getByOrderId(PUBLIC_FOOD_ORDER_PROOF_ID);
  if (result.status !== 'LIVE') return { status: 503, body: { error: 'SUPPLIER_READBACK_UNAVAILABLE' } } as const;
  const order = result.order;
  if (order.externalOrderId !== PUBLIC_FOOD_ORDER_PROOF_ID) {
    return { status: 502, body: { error: 'SUPPLIER_READBACK_MISMATCH' } } as const;
  }
  return {
    status: 200,
    body: {
      externalOrderId: order.externalOrderId,
      externalOrderNo: order.externalOrderNo,
      goodsName: order.goodsName,
      quantity: order.quantity,
      totalPriceKrw: order.totalPriceKrw,
      deliveryState: order.deliveryState,
      hasTracking: Boolean(order.trackingNumber),
      source: order.source,
      refreshedAt
    }
  } as const;
}
