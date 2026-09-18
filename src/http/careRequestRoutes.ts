import { CareRequestError, CareRequestService } from '../care-support/service.ts';
import type { CareServiceCode } from '../care-support/types.ts';

interface CareRouteRequest {
  method: string;
  pathname: string;
  body?: Record<string, unknown>;
}

export function createCareRequestHandlers(service: CareRequestService) {
  return async (request: CareRouteRequest): Promise<{ status: number; body: unknown }> => {
    try {
      if (request.method === 'GET' && request.pathname === '/api/demo/care/catalog') {
        return { status: 200, body: { ...service.catalog(), synthetic: true } };
      }
      if (request.method === 'GET' && request.pathname === '/api/demo/care/requests') {
        return { status: 200, body: { requests: await service.list(), synthetic: true } };
      }
      if (request.method === 'POST' && request.pathname === '/api/demo/care/requests') {
        const body = request.body ?? {};
        const value = await service.create({
          beneficiaryRef: requiredText(body.beneficiaryRef),
          serviceCode: requiredText(body.serviceCode) as CareServiceCode,
          itemCode: requiredText(body.itemCode),
          quantity: requiredNumber(body.quantity),
          preferredDate: requiredText(body.preferredDate),
          confirmed: body.confirmed === true
        });
        return { status: 201, body: { request: value, synthetic: true } };
      }
      const events = request.pathname.match(/^\/api\/demo\/care\/requests\/([^/]+)\/events$/);
      if (request.method === 'GET' && events) {
        const value = await service.get(decodeURIComponent(events[1]!));
        if (!value) return { status: 404, body: { error: 'REQUEST_NOT_FOUND' } };
        return { status: 200, body: { request: value, events: await service.events(value.caseId), synthetic: true } };
      }
      const action = request.pathname.match(/^\/api\/demo\/care\/requests\/([^/]+)\/actions$/);
      if (request.method === 'POST' && action) {
        const body = request.body ?? {};
        const value = await service.act(
          decodeURIComponent(action[1]!),
          requiredText(body.action) as 'PROVIDER_ACCEPT' | 'MARK_PROVIDED' | 'CONFIRM_RECEIPT' | 'RAISE_EXCEPTION',
          typeof body.reason === 'string' ? body.reason : undefined
        );
        return { status: 200, body: { request: value, synthetic: true } };
      }
      return { status: 404, body: { error: 'NOT_FOUND' } };
    } catch (error) {
      if (error instanceof CareRequestError) return { status: error.code === 'REQUEST_NOT_FOUND' ? 404 : 409, body: { error: error.code, message: error.message } };
      return { status: 400, body: { error: 'INVALID_CARE_REQUEST' } };
    }
  };
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('Required text');
  return value.trim();
}

function requiredNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Required number');
  return value;
}
