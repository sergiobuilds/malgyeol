import { timingSafeEqual } from 'node:crypto';
import type { CaseCoordinator } from '../e2e/caseCoordinator.ts';
import type { BenefitCase, InterpretedPurchase } from '../e2e/types.ts';
import { projectPublicCase } from './publicProjection.ts';
import type { ContinuationTokenService } from './continuationToken.ts';
import type { ProductRole, RoleAccessTokenService } from './roleAccess.ts';

export interface AgentRouteRequest {
  method: string;
  pathname: string;
  authorization?: string;
  body?: Record<string, unknown>;
}

export interface AgentRouteResponse {
  status: number;
  body: unknown;
}

export class AgentInputError extends Error {}

export function createAgentHandlers(
  secret: string,
  coordinator: CaseCoordinator,
  getCase: (caseId: string) => Promise<BenefitCase | undefined>,
  continuationTokens?: ContinuationTokenService,
  roleTokens?: RoleAccessTokenService
) {
  if (secret.length < 32) throw new Error('AGENT_TOOL_SECRET must be at least 32 characters');

  return async (request: AgentRouteRequest): Promise<AgentRouteResponse> => {
    if (!authorized(request.authorization, secret)) return { status: 401, body: { error: 'Unauthorized' } };

    if (request.method === 'POST' && request.pathname === '/internal/agent/begin') {
      const callId = requiredString(request.body?.callId, 'callId');
      const value = await coordinator.beginCall(callId);
      return { status: 200, body: projectPublicCase(value, false) };
    }
    if (request.method === 'POST' && request.pathname === '/internal/agent/interpretation') {
      const caseId = requiredString(request.body?.caseId, 'caseId');
      const interpretation = parseInterpretation(request.body?.interpretation);
      const value = await coordinator.submitInterpretation(caseId, interpretation);
      return { status: 200, body: projectPublicCase(value, false) };
    }
    if (request.method === 'POST' && request.pathname === '/internal/agent/confirmation') {
      const caseId = requiredString(request.body?.caseId, 'caseId');
      const digit = requiredString(request.body?.digit, 'digit');
      const value = await coordinator.confirm(caseId, digit);
      return { status: 200, body: projectPublicCase(value, false) };
    }
    if (request.method === 'POST' && request.pathname === '/internal/agent/role-access') {
      if (!roleTokens) return { status: 503, body: { error: 'Role access is not configured' } };
      const role = requiredString(request.body?.role, 'role') as ProductRole;
      if (!['caregiver', 'ops', 'merchant'].includes(role)) return { status: 400, body: { error: 'Invalid role' } };
      const rawCaseIds = request.body?.caseIds;
      if (rawCaseIds !== undefined && (!Array.isArray(rawCaseIds) || !rawCaseIds.every(value => typeof value === 'string'))) {
        return { status: 400, body: { error: 'Invalid caseIds' } };
      }
      if (!Array.isArray(rawCaseIds) || rawCaseIds.length === 0) return { status: 400, body: { error: 'Role access requires caseIds' } };
      const accessLevel = request.body?.accessLevel === undefined ? 'read' : requiredString(request.body.accessLevel, 'accessLevel');
      if (accessLevel !== 'read' && accessLevel !== 'act') return { status: 400, body: { error: 'Invalid accessLevel' } };
      const subjectId = requiredString(request.body?.subjectId, 'subjectId');
      if (!/^[A-Za-z0-9_.:@-]{3,128}$/.test(subjectId)) return { status: 400, body: { error: 'Invalid subjectId' } };
      const caseIds = rawCaseIds as string[];
      const existing = await Promise.all(caseIds.map(caseId => getCase(caseId)));
      if (existing.some(value => !value)) return { status: 404, body: { error: 'Role scope contains an unknown case' } };
      const issued = roleTokens.issue(role, caseIds, undefined, accessLevel, subjectId);
      return { status: 200, body: { role, accessLevel, accessToken: issued.token, expiresAt: issued.expiresAt } };
    }
    const continuationMatch = request.pathname.match(/^\/internal\/agent\/continuation\/([^/]+)$/);
    if (request.method === 'POST' && continuationMatch) {
      if (!continuationTokens) return { status: 503, body: { error: 'Phone-to-web continuation is not configured' } };
      const caseId = decodeURIComponent(continuationMatch[1]!);
      const value = await getCase(caseId);
      if (!value) return { status: 404, body: { error: 'Case not found' } };
      const issued = continuationTokens.issue(caseId);
      return {
        status: 200,
        body: {
          caseId,
          continuationToken: issued.token,
          expiresAt: issued.expiresAt,
          path: `/?v=voice&caseId=${encodeURIComponent(caseId)}#continuation=${encodeURIComponent(issued.token)}`
        }
      };
    }
    const statusMatch = request.pathname.match(/^\/internal\/agent\/status\/([^/]+)$/);
    if (request.method === 'GET' && statusMatch) {
      const value = await getCase(decodeURIComponent(statusMatch[1]!));
      return value
        ? { status: 200, body: projectPublicCase(value, false) }
        : { status: 404, body: { error: 'Case not found' } };
    }
    return { status: 404, body: { error: 'Not found' } };
  };
}

function authorized(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) throw new AgentInputError(`Invalid ${name}`);
  return value;
}

function parseInterpretation(value: unknown): InterpretedPurchase {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentInputError('Invalid interpretation');
  const input = value as Record<string, unknown>;
  const ambiguityReasons = input.ambiguityReasons;
  if (!Array.isArray(ambiguityReasons) || !ambiguityReasons.every(reason => typeof reason === 'string' && reason.length <= 256)) {
    throw new AgentInputError('Invalid ambiguityReasons');
  }
  if (typeof input.quantity !== 'number' || !Number.isSafeInteger(input.quantity)) throw new AgentInputError('Invalid quantity');
  if (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new AgentInputError('Invalid confidence');
  if (typeof input.substitutionsAllowed !== 'boolean' || typeof input.referencesApprovedPlan !== 'boolean') throw new AgentInputError('Invalid interpretation flags');
  return {
    requestedCategory: requiredString(input.requestedCategory, 'requestedCategory'),
    requestedSku: requiredString(input.requestedSku, 'requestedSku'),
    quantity: input.quantity,
    substitutionsAllowed: input.substitutionsAllowed,
    referencesApprovedPlan: input.referencesApprovedPlan,
    confidence: input.confidence,
    ambiguityReasons,
    safeUserSummary: requiredString(input.safeUserSummary, 'safeUserSummary'),
    ...(input.verbatimUserRequest === undefined ? {} : {
      verbatimUserRequest: requiredString(input.verbatimUserRequest, 'verbatimUserRequest')
    })
  };
}
