export interface MerchantOrderResult { providerOrderId: string; }
export type MerchantTrackingState = 'ORDERED' | 'PACKED' | 'SHIPPED' | 'DELIVERED';
export interface MerchantTrackingResult {
  providerOrderId: string;
  state: MerchantTrackingState;
  sandbox: true;
}
export interface MerchantAdapter {
  submit(input: {
    caseId: string;
    sku: string;
    quantity: number;
    merchantId: string;
    programAmountKrw: number;
    paymentIntentId: string;
  }): Promise<MerchantOrderResult>;
  track?(providerOrderId: string): Promise<MerchantTrackingResult>;
}
