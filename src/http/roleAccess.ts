import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { CaseRepository } from '../e2e/caseRepository.ts';
import { projectPublicCase } from './publicProjection.ts';
import { buildRoleScopedWorkbook } from '../legacy/resultWorkbook.ts';
import {
  emptyWorkflow, RoleWorkflowConflictError, RoleWorkflowInputError,
  type RoleAccessLevel, type RoleWorkflowAction, type RoleWorkflowRepository
} from '../roles/workflow.ts';

export type ProductRole = 'caregiver' | 'ops' | 'merchant';

export interface RoleClaim {
  version: 'role-access-v2';
  role: ProductRole;
  accessLevel: RoleAccessLevel;
  subjectId: string;
  caseIds: string[];
  expiresAt: number;
}

export class RoleAccessTokenService {
  constructor(private readonly secret: string, private readonly now: () => number = Date.now) {
    if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('Role access secret must be at least 32 bytes');
  }

  issue(role: ProductRole, caseIds: string[] = [], ttlMs = 15 * 60_000, accessLevel: RoleAccessLevel = 'read', subjectId = 'anonymous-read'): { token: string; expiresAt: number } {
    validateRole(role);
    const scope = [...new Set(caseIds.map(validateCaseId))].sort();
    if (scope.length === 0) throw new Error('Role access requires a case scope');
    if (scope.length > 50) throw new Error('Too many case scopes');
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 60 * 60_000) throw new Error('Invalid role access TTL');
    if (accessLevel !== 'read' && accessLevel !== 'act') throw new Error('Invalid role access level');
    if (!/^[A-Za-z0-9_.:@-]{3,128}$/.test(subjectId)) throw new Error('Invalid role subject');
    if (accessLevel === 'act' && subjectId === 'anonymous-read') throw new Error('Action access requires a subject');
    const claim: RoleClaim = { version: 'role-access-v2', role, accessLevel, subjectId, caseIds: scope, expiresAt: this.now() + ttlMs };
    const encoded = Buffer.from(JSON.stringify(claim)).toString('base64url');
    return { token: `${encoded}.${this.signature(encoded)}`, expiresAt: claim.expiresAt };
  }

  verify(role: ProductRole, token: string | undefined): RoleClaim | undefined {
    if (!token) return undefined;
    const [encoded, suppliedHex, extra] = token.split('.');
    if (!encoded || !suppliedHex || extra || !/^[a-f0-9]{64}$/.test(suppliedHex)) return undefined;
    const supplied = Buffer.from(suppliedHex, 'hex');
    const expected = Buffer.from(this.signature(encoded), 'hex');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return undefined;
    try {
      const claim = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as RoleClaim;
      if (claim.version !== 'role-access-v2' || claim.role !== role || claim.expiresAt < this.now()) return undefined;
      if (claim.accessLevel !== 'read' && claim.accessLevel !== 'act') return undefined;
      if (typeof claim.subjectId !== 'string' || !/^[A-Za-z0-9_.:@-]{3,128}$/.test(claim.subjectId)) return undefined;
      if (!Array.isArray(claim.caseIds) || claim.caseIds.some(id => validateCaseId(id) !== id)) return undefined;
      return claim;
    } catch { return undefined; }
  }

  private signature(encoded: string): string {
    return createHmac('sha256', this.secret).update(encoded).digest('hex');
  }
}

export function createRoleHandlers(repository: CaseRepository, tokens: RoleAccessTokenService, workflows: RoleWorkflowRepository) {
  return async (request: { method: string; pathname: string; authorization?: string; body?: Record<string, unknown> }) => {
    const match = request.pathname.match(/^\/api\/roles\/(caregiver|ops|merchant)\/(overview|actions|export\.xlsx)$/);
    if (!match) return { status: 404, body: { error: 'Not found' } };
    const role = match[1] as ProductRole;
    const resource = match[2]!;
    const token = request.authorization?.startsWith('Bearer ') ? request.authorization.slice(7) : undefined;
    const claim = tokens.verify(role, token);
    if (!claim) return { status: 401, body: { error: 'Unauthorized' } };

    if (request.method === 'POST' && resource === 'actions') {
      if (claim.accessLevel !== 'act') return { status: 403, body: { error: 'Role is read-only' } };
      try {
        const caseId = validateCaseIdInput(request.body?.caseId);
        if (!claim.caseIds.includes(caseId)) return { status: 403, body: { error: 'Case is outside role scope' } };
        const value = await repository.get(caseId);
        if (!value) return { status: 404, body: { error: 'Case not found' } };
        if (role === 'merchant' && !value.providerOrderId) return { status: 409, body: { error: 'Case has no supplier order' } };
        const workflow = await workflows.apply({
          caseId, role, subjectId: claim.subjectId,
          action: validateActionInput(request.body?.action),
          data: validateDataInput(request.body?.data),
          expectedRevision: validateRevisionInput(request.body?.expectedRevision)
        });
        return { status: 200, body: { role, accessLevel: claim.accessLevel, caseId, workflow } };
      } catch (error) {
        if (error instanceof RoleWorkflowInputError) return { status: 400, body: { error: error.message } };
        if (error instanceof RoleWorkflowConflictError) return { status: 409, body: { error: error.message } };
        throw error;
      }
    }

    const all = await repository.list(50);
    const scoped = all.filter(value => claim.caseIds.includes(value.caseId));
    const visible = role === 'merchant' ? scoped.filter(value => Boolean(value.providerOrderId)) : scoped;
    if (request.method === 'GET' && resource === 'export.xlsx') {
      if (role !== 'ops') return { status: 404, body: { error: 'Not found' } };
      return {
        status: 200, body: buildRoleScopedWorkbook(visible),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: 'malgyeol-role-scope.xlsx'
      };
    }
    if (request.method !== 'GET' || resource !== 'overview') return { status: 404, body: { error: 'Not found' } };
    const workflowValues = await Promise.all(visible.map(async value => await workflows.get(value.caseId) ?? emptyWorkflow(value.caseId, value.updatedAt)));
    return {
      status: 200,
      body: {
        role,
        readOnly: claim.accessLevel === 'read',
        accessLevel: claim.accessLevel,
        expiresAt: claim.expiresAt,
        capabilities: role === 'caregiver'
          ? ['CASE_READ', 'DELIVERY_READ', ...(claim.accessLevel === 'act' ? ['COAPPROVAL', 'CHANGE_REQUEST', 'DELIVERY_ISSUE', 'CANCEL_REQUEST'] : [])]
          : role === 'ops'
            ? ['CASE_READ', 'POLICY_READ', 'AUDIT_EXPORT', ...(claim.accessLevel === 'act' ? ['POLICY_REVIEW', 'CONSENT_RECORD', 'EXCEPTION_RESOLUTION'] : [])]
            : ['ORDER_READ', 'TRACKING_READ', ...(claim.accessLevel === 'act' ? ['FULFILLMENT_UPDATE', 'SUBSTITUTION_PROPOSAL', 'CANCEL_REFUND'] : [])],
        cases: visible.map((value, index) => ({
          ...projectPublicCase(value, false), workflow: workflowValues[index],
          canApproveCoApproval: role === 'caregiver'
            && workflowValues[index]?.caregiver.coApproval === 'REQUESTED'
            && workflowValues[index]?.caregiver.requestedByActorHash !== hashRoleSubject(claim.subjectId)
        })),
        generatedAt: Date.now()
      }
    };
  };
}

function validateCaseIdInput(value: unknown): string {
  if (typeof value !== 'string') throw new RoleWorkflowInputError('Invalid caseId');
  return validateCaseId(value);
}

function validateActionInput(value: unknown): RoleWorkflowAction {
  if (typeof value !== 'string' || !/^[A-Z_]{3,64}$/.test(value)) throw new RoleWorkflowInputError('Invalid action');
  return value as RoleWorkflowAction;
}

function validateRevisionInput(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RoleWorkflowInputError('Invalid expectedRevision');
  return value;
}

function validateDataInput(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RoleWorkflowInputError('Invalid data');
  return value as Record<string, unknown>;
}

function validateRole(value: string): asserts value is ProductRole {
  if (!['caregiver', 'ops', 'merchant'].includes(value)) throw new Error('Invalid product role');
}

function validateCaseId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid caseId');
  return value;
}

function hashRoleSubject(value: string): string {
  return createHash('sha256').update(`role-subject-v1:${value}`).digest('hex');
}
