import { timingSafeEqual } from 'node:crypto';
import { PhoneFoodCoordinator, PhoneFoodInputError } from '../food-support/phoneFoodCoordinator.ts';
import { PhoneEnrollmentInputError, type PhoneEnrollmentService } from '../food-support/phoneEnrollment.ts';

export interface PhoneFoodAgentRequest {
  method: string;
  pathname: string;
  authorization?: string;
  body?: Record<string, unknown>;
}

export function createPhoneFoodAgentHandlers(secret: string, coordinator: PhoneFoodCoordinator, enrollments?: PhoneEnrollmentService) {
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('AGENT_TOOL_SECRET must be at least 32 bytes');
  return async (request: PhoneFoodAgentRequest): Promise<{ status: number; body: unknown }> => {
    if (!authorized(request.authorization, secret)) return { status: 401, body: { error: 'Unauthorized' } };
    try {
      if (request.method === 'POST' && request.pathname === '/internal/food-agent/begin') {
        return { status: 200, body: await coordinator.begin(
          requiredString(request.body?.callId, 'callId'),
          optionalString(request.body?.callerNumber, 'callerNumber', 32)
        ) };
      }
      if (request.method === 'POST' && request.pathname === '/internal/food-agent/enrollment') {
        if (!enrollments) return { status: 503, body: { error: 'Phone enrollment is not configured' } };
        const body = request.body ?? {};
        return { status: 201, body: await enrollments.enroll({
          callerNumber: requiredString(body.callerNumber, 'callerNumber', 32),
          beneficiaryRef: requiredString(body.beneficiaryRef, 'beneficiaryRef', 128),
          programId: requiredString(body.programId, 'programId', 128),
          planId: requiredString(body.planId, 'planId', 128),
          budget: body.budget as any,
          source: requiredSource(body.source),
          recipient: body.recipient as any
        }) };
      }
      if (request.method === 'POST' && request.pathname === '/internal/food-agent/interpret') {
        return { status: 200, body: await coordinator.interpret(requiredString(request.body?.caseId, 'caseId'), requiredString(request.body?.text, 'text', 1000)) };
      }
      if (request.method === 'POST' && request.pathname === '/internal/food-agent/select') {
        return { status: 200, body: await coordinator.select(requiredString(request.body?.caseId, 'caseId'), requiredInteger(request.body?.candidateNumber, 'candidateNumber'), requiredInteger(request.body?.quantity, 'quantity')) };
      }
      if (request.method === 'POST' && request.pathname === '/internal/food-agent/confirmation') {
        return { status: 200, body: await coordinator.confirm(requiredString(request.body?.caseId, 'caseId'), requiredString(request.body?.digit, 'digit', 1)) };
      }
      const match = request.pathname.match(/^\/internal\/food-agent\/status\/([^/]+)$/);
      if (request.method === 'GET' && match) return { status: 200, body: await coordinator.status(decodeURIComponent(match[1]!)) };
      return { status: 404, body: { error: 'Not found' } };
    } catch (error) {
      if (error instanceof PhoneFoodInputError || error instanceof PhoneEnrollmentInputError) return { status: 400, body: { error: error.message } };
      throw error;
    }
  };
}

function optionalString(value: unknown, name: string, maximum: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredString(value, name, maximum);
}

function authorized(header: string | undefined, secret: string): boolean {
  const supplied = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && supplied.length > 0 && timingSafeEqual(supplied, expected);
}

function requiredString(value: unknown, name: string, maximum = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new PhoneFoodInputError(`Invalid ${name}`);
  return value.trim();
}

function requiredInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new PhoneFoodInputError(`Invalid ${name}`);
  return value;
}

function requiredSource(value: unknown): 'INSTITUTION' | 'SYNTHETIC_DEMO' {
  if (value !== 'INSTITUTION' && value !== 'SYNTHETIC_DEMO') throw new PhoneEnrollmentInputError('Invalid source');
  return value;
}
