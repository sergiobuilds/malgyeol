import { hashMandate } from './policyHash.ts';
import type { Clock, OrderRequest, SigningEnvelope, MandateRepository, Signer } from './types.ts';

export class Coordinator {
  private readonly repo: MandateRepository;
  private readonly signer: Signer;
  private readonly clock: Clock;

  constructor(repo: MandateRepository, signer: Signer, clock: Clock) {
    this.repo = repo;
    this.signer = signer;
    this.clock = clock;
  }

  async authorizeAndSign(request: OrderRequest): Promise<{ signature: string }> {
    if (!request) throw new Error('Malformed: missing request');
    const mandate = await this.repo.getMandate(request.mandateId);
    if (!mandate) throw new Error('Mandate not found');
    const now = this.clock.now();
    if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Clock failure: invalid timestamp');
    if (now < mandate.validFrom) throw new Error('Temporal: not-yet-valid');
    if (now > mandate.validUntil) throw new Error('Temporal: expired');

    const sha256 = /^[a-f0-9]{64}$/;
    if (!sha256.test(request.consentCommitment)) throw new Error('Malformed: weak/malformed consentCommitment');
    if (!sha256.test(request.orderNonce)) throw new Error('Malformed: weak/malformed orderNonce');
    if (request.mandateId !== mandate.mandateId) throw new Error('Mismatch: wrong mandateId');
    if (request.fundId !== mandate.fundId) throw new Error('Mismatch: wrong fundId');
    if (request.sku !== mandate.approvedSku) throw new Error('Mismatch: wrong SKU');
    if (request.merchantId !== mandate.merchantId) throw new Error('Mismatch: wrong merchant');
    if (request.mint !== mandate.mint) throw new Error('Mismatch: wrong mint');
    if (request.destinationAccount !== mandate.escrowDestination) throw new Error('Mismatch: wrong destination');
    if (request.amount !== mandate.exactAmount) throw new Error('Mismatch: wrong amount');
    if (typeof request.amount !== 'bigint' || request.amount <= 0n) throw new Error('Malformed: invalid amount');

    const mandateHash = hashMandate(mandate);
    const reserveResult = await this.repo.reserve(mandate.mandateId, mandate.revision, mandateHash, request.amount, request.orderNonce);
    if (!reserveResult.success) throw new Error(`Reservation failed: ${reserveResult.reason}`);

    const envelope: SigningEnvelope = Object.freeze({
      mandateId: request.mandateId,
      fundId: request.fundId,
      merchantId: request.merchantId,
      mint: request.mint,
      destinationAccount: request.destinationAccount,
      amount: request.amount,
      consentCommitment: request.consentCommitment,
      orderNonce: request.orderNonce,
      mandateHash
    });

    let signature: { signature: string };
    try {
      signature = await this.signer.sign(envelope);
      if (!signature.signature) throw new Error('Signer returned an empty signature');
    } catch (error) {
      await this.repo.markTerminalState(request.orderNonce, 'SIGN_FAILED');
      throw new Error(`Signer failed: ${(error as Error).message}`);
    }
    await this.repo.markTerminalState(request.orderNonce, 'SIGNED');
    return signature;
  }
}
