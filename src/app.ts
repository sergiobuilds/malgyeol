import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { CaseCoordinator, type AudioPurchaseInterpreter } from './e2e/caseCoordinator.ts';
import { InMemoryCaseRepository } from './e2e/inMemoryCaseRepository.ts';
import { FirestoreCaseRepository } from './e2e/firestoreCaseRepository.ts';
import { DemoMerchantAdapter } from './e2e/demoMerchantAdapter.ts';
import { InMemoryPaymentExecutor } from './e2e/inMemoryPaymentExecutor.ts';
import { projectPublicCase, projectPublicEvent } from './http/publicProjection.ts';
import { buildResultWorkbook } from './legacy/resultWorkbook.ts';
import type { BenefitCase, InterpretedPurchase } from './e2e/types.ts';
import { HttpAudioInterpreter } from './voice/httpAudioInterpreter.ts';
import { createVoiceHandlers } from './voice/twilioRoutes.ts';
import { createClawOpsVoiceHandlers } from './voice/clawopsRoutes.ts';
import { AgentInputError, createAgentHandlers } from './http/agentRoutes.ts';
import { HttpMerchantSandboxAdapter } from './merchant/httpMerchantAdapter.ts';
import { createMerchantSandboxNodeHandler, MerchantSandbox } from './merchant/sandbox.ts';
import { FirestoreMerchantSandboxStore } from './merchant/store.ts';
import {
  FileSpecialOfferCredentialProvider,
  HmacPaidActionApprovalVerifier,
  SpecialOfferCatalogAdapter,
  SpecialOfferOrderAdapter
} from './food-support/specialOffer.ts';
import { createFoodSupportHandlers, FoodSupportInputError } from './http/foodSupportRoutes.ts';
import { ContinuationTokenService } from './http/continuationToken.ts';
import { FirestoreConversationRepository, InMemoryConversationRepository } from './food-support/conversationRepository.ts';
import { createRoleHandlers, RoleAccessTokenService } from './http/roleAccess.ts';
import { FileFoodBudgetProvider } from './food-support/budgetProvider.ts';
import type { FoodBudgetProvider } from './food-support/budgetProvider.ts';
import { FirestoreRoleWorkflowRepository, InMemoryRoleWorkflowRepository } from './roles/workflow.ts';
import { FoodSessionTokenService } from './http/foodSessionToken.ts';
import { createSpecialOfferOrderHandlers, SpecialOfferOrderInputError } from './http/specialOfferOrderRoutes.ts';
import { createPublicFoodOrderProofReader } from './http/publicFoodOrderProof.ts';
import { FirestorePaidOrderExecutionStore } from './food-support/firestorePaidOrderExecutionStore.ts';
import { FirestoreFoodBudgetLedger, InMemoryFoodBudgetLedger } from './food-support/budgetLedger.ts';
import { rollupReconciledSpecialOfferOrder, rollupSpecialOfferOrder } from './food-support/orderRollup.ts';
import { HttpFoodTextInterpreter } from './food-support/httpFoodTextInterpreter.ts';
import {
  FirestorePhoneFoodRepository,
  InMemoryPhoneFoodRepository,
  PhoneFoodCoordinator,
  phoneOrderTermsMatch
} from './food-support/phoneFoodCoordinator.ts';
import { createPhoneFoodAgentHandlers } from './http/phoneFoodAgentRoutes.ts';
import {
  createDeliveryEvidenceHandlers,
  DeliveryEvidenceInputError,
  DeliveryEvidenceNotFoundError,
  FirestoreDeliveryEvidenceRepository,
  InMemoryDeliveryEvidenceRepository
} from './delivery/evidence.ts';
import {
  ApprovalRequestCipher,
  FirestoreApprovalRequestRepository,
  InMemoryApprovalRequestRepository
} from './food-support/approvalRequests.ts';
import {
  FirestorePhoneEnrollmentRepository,
  InMemoryPhoneEnrollmentRepository,
  PhoneEnrollmentService
} from './food-support/phoneEnrollment.ts';
import { createCanonicalCaseLedger } from './case-ledger/factory.ts';

class SyntheticInterpreter implements AudioPurchaseInterpreter {
  async analyzeAudio(bytes: Uint8Array): Promise<InterpretedPurchase> {
    const blocked = Buffer.from(bytes).toString('utf8').includes('blocked');
    return {
      requestedCategory: blocked ? 'TOBACCO' : 'ASSISTIVE_EQUIPMENT',
      requestedSku: blocked ? 'TOBACCO_01' : 'ASSISTIVE_STAND_AID_01',
      quantity: 1,
      substitutionsAllowed: false,
      referencesApprovedPlan: true,
      confidence: 0.97,
      ambiguityReasons: [],
      safeUserSummary: blocked ? '금지 품목 요청' : '승인된 기립 보조기 요청'
    };
  }
}

export function createApp() {
  const agentToolSecret = process.env.AGENT_TOOL_SECRET;
  const auditReadSecret = process.env.AUDIT_READ_SECRET;
  const publicProofCaseIds = new Set((process.env.PUBLIC_PROOF_CASE_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean));
  const repo = process.env.CASE_REPOSITORY === 'firestore'
    ? new FirestoreCaseRepository()
    : new InMemoryCaseRepository();
  const canonicalProduction = Boolean(process.env.K_SERVICE) || process.env.NODE_ENV === 'production';
  const canonicalLedger = createCanonicalCaseLedger({
    mode: canonicalProduction ? process.env.CASE_REPOSITORY : process.env.CASE_REPOSITORY ?? 'memory',
    production: canonicalProduction
  });
  const publicCostLimiter = new FixedWindowRateLimiter();
  const payment = new InMemoryPaymentExecutor();
  const interpreter = process.env.AI_INTERPRETER_ENDPOINT
    ? new HttpAudioInterpreter({
      endpoint: process.env.AI_INTERPRETER_ENDPOINT,
      ...(process.env.AI_INTERPRETER_BEARER_TOKEN ? { bearerToken: process.env.AI_INTERPRETER_BEARER_TOKEN } : {}),
      ...(process.env.AI_MODEL_ID ? { modelId: process.env.AI_MODEL_ID } : {}),
      ...(process.env.AI_PROVIDER_NAME ? { providerName: process.env.AI_PROVIDER_NAME } : {})
    })
    : new SyntheticInterpreter();
  const merchantSandbox = createMerchantSandboxNodeHandler(new MerchantSandbox(
    process.env.CASE_REPOSITORY === 'firestore' ? new FirestoreMerchantSandboxStore() : undefined
  ), agentToolSecret);
  const merchant = process.env.MERCHANT_SANDBOX_URL
    ? new HttpMerchantSandboxAdapter(process.env.MERCHANT_SANDBOX_URL, fetch, agentToolSecret)
    : new DemoMerchantAdapter();
  const coordinator = new CaseCoordinator(
    repo,
    interpreter,
    payment,
    merchant,
    Date.now,
    resolvePhoneHmacSecret(process.env)
  );
  const continuationTokens = new ContinuationTokenService(resolvePhoneHmacSecret(process.env));
  const foodSessionTokens = new FoodSessionTokenService(resolvePhoneHmacSecret(process.env));
  const roleTokens = new RoleAccessTokenService(resolvePhoneHmacSecret(process.env));
  const roleWorkflows = process.env.CASE_REPOSITORY === 'firestore'
    ? new FirestoreRoleWorkflowRepository()
    : new InMemoryRoleWorkflowRepository();
  const roleHandlers = createRoleHandlers(repo, roleTokens, roleWorkflows);
  const deliveryEvidenceRepository = process.env.CASE_REPOSITORY === 'firestore'
    ? new FirestoreDeliveryEvidenceRepository()
    : new InMemoryDeliveryEvidenceRepository();
  const deliveryEvidenceHandlers = agentToolSecret
    ? createDeliveryEvidenceHandlers({ repository: deliveryEvidenceRepository, operatorSecret: agentToolSecret, roleTokens })
    : undefined;
  const specialOfferCredentials = new FileSpecialOfferCredentialProvider(process.env.SPECIAL_OFFER_API_KEY_FILE);
  const foodCatalog = new SpecialOfferCatalogAdapter(specialOfferCredentials);
  const fileFoodBudget = new FileFoodBudgetProvider(process.env.FOOD_SUPPORT_BUDGET_FILE);
  const phoneFoodCases = process.env.CASE_REPOSITORY === 'firestore'
    ? new FirestorePhoneFoodRepository()
    : new InMemoryPhoneFoodRepository();
  const syntheticPhoneBudget = parseSyntheticPhoneBudget(process.env.PHONE_SYNTHETIC_DEMO_BUDGET_KRW);
  const approvalRequests = process.env.CASE_REPOSITORY === 'firestore'
    ? new FirestoreApprovalRequestRepository()
    : new InMemoryApprovalRequestRepository();
  const foodBudgetLedger = process.env.CASE_REPOSITORY === 'firestore'
    ? new FirestoreFoodBudgetLedger()
    : new InMemoryFoodBudgetLedger();
  const approvalCipher = process.env.APPROVAL_DATA_KEY_BASE64
    ? new ApprovalRequestCipher(process.env.APPROVAL_DATA_KEY_BASE64)
    : undefined;
  const phoneEnrollments = approvalCipher ? new PhoneEnrollmentService(
    process.env.CASE_REPOSITORY === 'firestore'
      ? new FirestorePhoneEnrollmentRepository()
      : new InMemoryPhoneEnrollmentRepository(),
    approvalCipher,
    resolvePhoneHmacSecret(process.env)
  ) : undefined;
  const foodBudget: FoodBudgetProvider = {
    async get(caseId) {
      const institutionBudget = await fileFoodBudget.get(caseId);
      if (institutionBudget) return institutionBudget;
      return (await phoneFoodCases.get(caseId))?.budget;
    }
  };
  const paidActionSecret = process.env.PAID_ACTION_HMAC_SECRET;
  const paidApprovals = paidActionSecret ? new HmacPaidActionApprovalVerifier(paidActionSecret) : undefined;
  const specialOfferOrders = paidApprovals && agentToolSecret
    ? new SpecialOfferOrderAdapter(
      specialOfferCredentials,
      fetch,
      'https://specialoffer.kr',
      paidApprovals,
      undefined,
      process.env.CASE_REPOSITORY === 'firestore' ? new FirestorePaidOrderExecutionStore() : undefined
    )
    : undefined;
  const publicFoodOrderProof = specialOfferOrders
    ? createPublicFoodOrderProofReader(specialOfferOrders)
    : undefined;
  const foodConversations = process.env.CASE_REPOSITORY === 'firestore' ? new FirestoreConversationRepository() : new InMemoryConversationRepository();
  const foodTextInterpreter = process.env.AI_INTERPRETER_ENDPOINT
    ? new HttpFoodTextInterpreter({
      endpoint: process.env.AI_INTERPRETER_ENDPOINT,
      ...(process.env.AI_INTERPRETER_BEARER_TOKEN ? { bearerToken: process.env.AI_INTERPRETER_BEARER_TOKEN } : {}),
      ...(process.env.AI_MODEL_ID ? { modelId: process.env.AI_MODEL_ID } : {}),
      ...(process.env.AI_PROVIDER_NAME ? { providerName: process.env.AI_PROVIDER_NAME } : {})
    })
    : undefined;
  const foodSupportHandlers = createFoodSupportHandlers(
    foodCatalog,
    async (caseId, token) => continuationTokens.verify(caseId, token) && Boolean(await repo.get(caseId)),
    foodConversations,
    caseId => foodBudget.get(caseId),
    async caseId => (await repo.get(caseId))?.state === 'ORDERED',
    async caseId => {
      const [phoneEvents, conversation, workflow] = await Promise.all([
        repo.events(caseId), foodConversations.get(caseId), roleWorkflows.get(caseId)
      ]);
      const events = [
        ...phoneEvents.map(value => ({ source: 'PHONE' as const, event: value.state, at: value.at, sequence: value.sequence })),
        ...(conversation?.turns.map((value, index) => ({
          source: 'WEB' as const, event: 'INTERPRETED', at: value.createdAt, sequence: index + 1,
          queryHash: value.query.text
        })) ?? []),
        ...(workflow?.events.map(value => ({
          source: 'ROLE' as const, event: value.action, at: value.at, sequence: value.sequence, role: value.role
        })) ?? [])
      ];
      return events.sort((a, b) => a.at - b.at || a.source.localeCompare(b.source) || a.sequence - b.sequence);
    },
    (caseId, sessionId) => foodSessionTokens.issue(caseId, sessionId),
    (caseId, token) => foodSessionTokens.verify(caseId, token),
    foodTextInterpreter ? text => foodTextInterpreter.interpret(text) : undefined
  );
  const specialOfferOrderHandlers = specialOfferOrders && paidApprovals && agentToolSecret
    ? createSpecialOfferOrderHandlers({
      catalog: foodCatalog,
      budgets: foodBudget,
      orders: specialOfferOrders,
      paidApprovals,
      operatorSecret: agentToolSecret,
      validateSession: async (caseId, token) => foodSessionTokens.verify(caseId, token),
      isDuplicateCase: async caseId => (await repo.get(caseId))?.state === 'ORDERED',
      authorizeOperator: (authorization, caseId, accessLevel) => {
        const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
        const claim = roleTokens.verify('ops', token);
        return Boolean(claim && claim.caseIds.includes(caseId) && (accessLevel === 'read' || claim.accessLevel === 'act'));
      },
      approvalRequests,
      budgetLedger: foodBudgetLedger,
      resolveBudgetScope: async caseId => {
        const value = await repo.get(caseId);
        if (!value) return undefined;
        return {
          beneficiaryRef: value.beneficiaryRef,
          programId: value.programId,
          periodKey: new Date().toISOString().slice(0, 7)
        };
      },
      rollupOrder: value => rollupSpecialOfferOrder(repo, roleWorkflows, value),
      rollupReconciledOrder: async value => {
        await rollupReconciledSpecialOfferOrder(repo, roleWorkflows, value);
        const phone = await phoneFoodCases.get(value.caseId);
        if (phone && (phone.status !== 'ORDERED' || phone.externalOrderId !== value.order.externalOrderId)) {
          await phoneFoodCases.save({
            ...phone, revision: phone.revision + 1, status: 'ORDERED',
            externalOrderId: value.order.externalOrderId, updatedAt: value.at
          });
        }
      },
      ...(approvalCipher ? { approvalCipher } : {})
    })
    : undefined;
  const phoneFoodCoordinator = new PhoneFoodCoordinator(
    repo,
    phoneFoodCases,
    foodCatalog,
    fileFoodBudget,
    canonicalLedger,
    Date.now,
    syntheticPhoneBudget,
    phoneEnrollments,
    specialOfferOrderHandlers ? async ({
      caseId, goodsNo, quantity, originalUtterance,
      expectedProductName, expectedSellerCode, expectedTotalPriceKrw, expectedPolicySnapshotHash,
      recipient
    }) => {
      const session = foodSessionTokens.issue(caseId, `phone-${caseId}`);
      const orderBody = {
        caseId, goodsNo, quantity, originalUtterance, recipient,
        sessionAccessToken: session.token
      };
      const previewResult = await specialOfferOrderHandlers({
        method: 'POST', pathname: '/api/food-support/order-preview', body: orderBody
      });
      if (previewResult.status !== 200) throw new Error('Phone order preview failed');
      const preview = previewResult.body as {
        preview: { productName: string; sellerCode: string; totalPriceKrw: number; consentCommitment: string };
        policySnapshotHash: string;
        consentExpiresAt: number;
        previewProof: string;
      };
      if (!phoneOrderTermsMatch(
        {
          productName: expectedProductName, sellerCode: expectedSellerCode,
          totalPriceKrw: expectedTotalPriceKrw, policySnapshotHash: expectedPolicySnapshotHash
        },
        {
          productName: preview.preview.productName, sellerCode: preview.preview.sellerCode,
          totalPriceKrw: preview.preview.totalPriceKrw, policySnapshotHash: preview.policySnapshotHash
        }
      )) {
        return { status: 'TERMS_CHANGED' as const };
      }
      const orderResult = await specialOfferOrderHandlers({
        method: 'POST', pathname: '/api/food-support/order-submit-direct', authorization: `Bearer ${agentToolSecret}`, body: {
          ...orderBody,
          expectedConsentExpiresAt: preview.consentExpiresAt,
          expectedConsentCommitment: preview.preview.consentCommitment,
          expectedTotalKrw: preview.preview.totalPriceKrw,
          previewProof: preview.previewProof
        }
      });
      const result = orderResult.body as {
        status?: string;
        reason?: 'IN_FLIGHT' | 'AMBIGUOUS_RESPONSE';
        order?: { externalOrderId?: string };
      };
      if (orderResult.status === 201 && result.order?.externalOrderId) {
        return { status: 'SUBMITTED' as const, externalOrderId: result.order.externalOrderId };
      }
      if (result.status === 'ORDER_RECONCILIATION_REQUIRED') {
        return {
          status: 'ORDER_RECONCILIATION_REQUIRED' as const,
          reason: result.reason === 'IN_FLIGHT' ? 'IN_FLIGHT' as const : 'AMBIGUOUS_RESPONSE' as const
        };
      }
      throw new Error('Phone direct order failed');
    } : undefined
  );
  const demoCoordinator = new CaseCoordinator(repo, new SyntheticInterpreter(), new InMemoryPaymentExecutor(), new DemoMerchantAdapter());
  const agentHandlers = agentToolSecret
    ? createAgentHandlers(agentToolSecret, coordinator, caseId => repo.get(caseId), continuationTokens, roleTokens)
    : undefined;
  const phoneFoodAgentHandlers = agentToolSecret
    ? createPhoneFoodAgentHandlers(agentToolSecret, phoneFoodCoordinator, phoneEnrollments)
    : undefined;
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
  const voice = publicBaseUrl && twilioAuthToken && twilioAccountSid ? createVoiceHandlers({
    authToken: twilioAuthToken,
    baseUrl: publicBaseUrl,
    async capture(callSid, recordingUrl) {
      const authorization = Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');
      const bytes = await fetchRecording(`${recordingUrl}.mp3`, 'https://api.twilio.com', new Set(['api.twilio.com']), { authorization: `Basic ${authorization}` });
      const value = await coordinator.capture(callSid, bytes, 'audio/mpeg');
      return value;
    },
    confirm: (caseId, digit) => coordinator.confirm(caseId, digit)
  }) : undefined;
  const clawOpsSigningKey = process.env.CLAWOPS_SIGNING_KEY;
  const clawOpsVoice = publicBaseUrl && clawOpsSigningKey ? createClawOpsVoiceHandlers({
    signingKey: clawOpsSigningKey,
    baseUrl: publicBaseUrl,
    async capture(callId, recordingUrl) {
      const clawOpsHeaders = process.env.CLAWOPS_API_KEY ? { authorization: `Bearer ${process.env.CLAWOPS_API_KEY}` } : undefined;
      const bytes = await fetchRecording(recordingUrl, 'https://api.claw-ops.com', new Set(['api.claw-ops.com']), clawOpsHeaders);
      const value = await coordinator.capture(callId, bytes, 'audio/wav');
      return value;
    },
    confirm: (caseId, digit) => coordinator.confirm(caseId, digit)
  }) : undefined;

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      if (url.pathname.startsWith('/sandbox/')) return merchantSandbox(request, response);
      if (request.method === 'GET' && ['/health', '/healthz', '/api/health'].includes(url.pathname)) {
        let externalEvidence = 'credential-gated';
        try {
          if (await specialOfferCredentials.getCredential()) externalEvidence = 'specialoffer-credential-loaded';
        } catch {
          externalEvidence = 'credential-invalid';
        }
        return sendJson(response, 200, {
          ok: true,
          mode: process.env.AI_INTERPRETER_ENDPOINT ? 'ai-provider-enabled' : 'deterministic-local',
          externalEvidence
        });
      }
      const publicCostLimit = checkPublicCostLimit(request, url, publicCostLimiter);
      if (publicCostLimit) return sendJson(response, 429, publicCostLimit);
      if (request.method === 'GET' && url.pathname === '/api/demo/food-order-proof') {
        if (!publicFoodOrderProof) return sendJson(response, 503, { error: 'SUPPLIER_READBACK_UNAVAILABLE' });
        const result = await publicFoodOrderProof();
        return sendJson(response, result.status, result.body);
      }
      if (url.pathname.startsWith('/api/food-support/')) {
        if (specialOfferOrderHandlers && [
          '/api/food-support/order-preview', '/api/food-support/order-submit', '/api/food-support/order-access', '/api/food-support/order-status',
          '/api/food-support/approval-request', '/api/food-support/approval-list', '/api/food-support/approval-execute',
          '/api/food-support/approval-refresh-preview', '/api/food-support/approval-refresh-confirm',
          '/api/food-support/order-reconcile', '/api/food-support/order-reconcile-direct'
        ].includes(url.pathname)) {
          const result = await specialOfferOrderHandlers({
            method: request.method ?? 'GET',
            pathname: url.pathname,
            authorization: Array.isArray(request.headers.authorization) ? request.headers.authorization[0] : request.headers.authorization,
            ...(request.method === 'POST' ? { body: await readJson(request) } : {})
          });
          return sendJson(response, result.status, result.body);
        }
        const result = await foodSupportHandlers({
          method: request.method ?? 'GET',
          pathname: url.pathname,
          searchParams: url.searchParams,
          ...(request.method === 'POST' ? { body: await readJson(request) } : {})
        });
        return sendJson(response, result.status, result.body);
      }
      if (url.pathname.startsWith('/api/delivery-evidence/')) {
        if (!deliveryEvidenceHandlers) return sendJson(response, 503, { error: 'Delivery evidence is not configured' });
        const result = await deliveryEvidenceHandlers({
          method: request.method ?? 'GET',
          pathname: url.pathname,
          searchParams: url.searchParams,
          authorization: Array.isArray(request.headers.authorization) ? request.headers.authorization[0] : request.headers.authorization,
          ...(request.method === 'POST' ? { body: await readJson(request) } : {})
        });
        return sendJson(response, result.status, result.body);
      }
      if (url.pathname.startsWith('/api/roles/')) {
        const result = await roleHandlers({
          method: request.method ?? 'GET',
          pathname: url.pathname,
          authorization: Array.isArray(request.headers.authorization) ? request.headers.authorization[0] : request.headers.authorization,
          ...(request.method === 'POST' ? { body: await readJson(request) } : {})
        });
        if (Buffer.isBuffer(result.body)) {
          response.writeHead(result.status, {
            'content-type': result.contentType ?? 'application/octet-stream',
            ...(result.filename ? { 'content-disposition': `attachment; filename="${result.filename}"` } : {})
          });
          return response.end(result.body);
        }
        return sendJson(response, result.status, result.body);
      }
      if (url.pathname.startsWith('/internal/food-agent/')) {
        if (!phoneFoodAgentHandlers) return sendJson(response, 404, { error: 'Not found' });
        const result = await phoneFoodAgentHandlers({
          method: request.method ?? 'GET',
          pathname: url.pathname,
          authorization: Array.isArray(request.headers.authorization) ? request.headers.authorization[0] : request.headers.authorization,
          ...(request.method === 'POST' ? { body: await readJson(request) } : {})
        });
        return sendJson(response, result.status, result.body);
      }
      if (url.pathname.startsWith('/internal/agent/')) {
        if (!agentHandlers) return sendJson(response, 503, { error: 'Agent tool bridge is not configured' });
        const result = await agentHandlers({
          method: request.method ?? 'GET',
          pathname: url.pathname,
          authorization: Array.isArray(request.headers.authorization) ? request.headers.authorization[0] : request.headers.authorization,
          ...(request.method === 'POST' ? { body: await readJson(request) } : {})
        });
        return sendJson(response, result.status, result.body);
      }
      if (request.method === 'POST' && url.pathname.startsWith('/voice/')) {
        if (!voice || !publicBaseUrl) return sendJson(response, 503, { error: 'Twilio credentials are not configured' });
        const verificationParams = await readForm(request);
        const params = { ...verificationParams };
        for (const [name, value] of url.searchParams) params[name] = value;
        const voiceRequest = {
          signature: String(request.headers['x-twilio-signature'] ?? ''),
          params,
          verificationParams,
          url: `${publicBaseUrl}${url.pathname}${url.search}`
        };
        const result = url.pathname === '/voice/incoming'
          ? await voice.incoming(voiceRequest)
          : url.pathname === '/voice/recorded'
            ? await voice.recorded(voiceRequest)
            : await voice.confirm(voiceRequest);
        response.writeHead(result.status, result.headers);
        return response.end(result.body);
      }
      if (request.method === 'POST' && url.pathname.startsWith('/clawops/voice/')) {
        if (!clawOpsVoice || !publicBaseUrl) return sendJson(response, 503, { error: 'ClawOps credentials are not configured' });
        const verificationParams = await readForm(request);
        const params = { ...verificationParams };
        for (const [name, value] of url.searchParams) params[name] = value;
        const voiceRequest = {
          signature: String(request.headers['x-signature'] ?? ''),
          params,
          url: `${publicBaseUrl}${url.pathname}${url.search}`
        };
        const result = url.pathname === '/clawops/voice/incoming'
          ? await clawOpsVoice.incoming(voiceRequest)
          : url.pathname === '/clawops/voice/recorded'
            ? await clawOpsVoice.recorded(voiceRequest)
            : await clawOpsVoice.confirm(voiceRequest);
        response.writeHead(result.status, result.headers);
        return response.end(result.body);
      }
      if (request.method === 'POST' && url.pathname === '/api/demo/run') {
        const body = await readJson(request);
        const scenario = body.scenario === 'blocked' ? 'blocked' : 'success';
        const value = await demoCoordinator.capture(`SYNTHETIC-${Date.now()}`, Buffer.from(scenario), 'audio/mpeg');
        const result = value.state === 'AWAITING_CONFIRMATION' ? await demoCoordinator.confirm(value.caseId, '1') : value;
        return sendJson(response, 200, projectPublicCase(result, true));
      }
      const caseMatch = url.pathname.match(/^\/api\/cases\/([^/]+)$/);
      if (request.method === 'GET' && caseMatch) {
        if (!publicProofCaseIds.has(caseMatch[1]!)) {
          const auditGate = requireAuditReadAccess(request, auditReadSecret);
          if (auditGate) return sendJson(response, auditGate.status, auditGate.body);
        }
        const value = await repo.get(caseMatch[1]!);
        return value ? sendJson(response, 200, projectPublicCase(value, url.searchParams.get('technical') === '1')) : sendJson(response, 404, { error: 'Case not found' });
      }
      const eventMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/events$/);
      if (request.method === 'GET' && eventMatch) {
        if (!publicProofCaseIds.has(eventMatch[1]!)) {
          const auditGate = requireAuditReadAccess(request, auditReadSecret);
          if (auditGate) return sendJson(response, auditGate.status, auditGate.body);
        }
        if (!await repo.get(eventMatch[1]!)) return sendJson(response, 404, { error: 'Case not found' });
        const events = await repo.events(eventMatch[1]!);
        return sendJson(response, 200, events.map(projectPublicEvent));
      }
      const exportMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/export\.xlsx$/);
      if (request.method === 'GET' && exportMatch) {
        const auditGate = requireAuditReadAccess(request, auditReadSecret);
        if (auditGate) return sendJson(response, auditGate.status, auditGate.body);
        const value = await repo.get(exportMatch[1]!);
        if (!value) return sendJson(response, 404, { error: 'Case not found' });
        const workbook = buildResultWorkbook([value]);
        response.writeHead(200, {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename="${value.caseId}.xlsx"`
        });
        return response.end(workbook);
      }
      if (request.method === 'GET' && url.pathname === '/api/cases') {
        const auditGate = requireAuditReadAccess(request, auditReadSecret);
        if (auditGate) return sendJson(response, auditGate.status, auditGate.body);
        const values: BenefitCase[] = await repo.list(50);
        return sendJson(response, 200, values.map(value => projectPublicCase(value, false)));
      }
      if (request.method === 'GET' || request.method === 'HEAD') return serveStatic(url, response, request.method === 'HEAD');
      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      if (error instanceof RequestBodyError) return sendJson(response, error.status, { error: error.code });
      if (error instanceof FoodSupportInputError) return sendJson(response, 400, { error: 'INVALID_FOOD_SUPPORT_INPUT' });
      if (error instanceof SpecialOfferOrderInputError) return sendJson(response, 400, { error: 'INVALID_SPECIAL_OFFER_ORDER' });
      if (error instanceof AgentInputError) return sendJson(response, 400, { error: 'INVALID_AGENT_INPUT' });
      if (error instanceof DeliveryEvidenceInputError) return sendJson(response, 400, { error: 'INVALID_DELIVERY_EVIDENCE', message: error.message });
      if (error instanceof DeliveryEvidenceNotFoundError) return sendJson(response, 404, { error: 'DELIVERY_EVIDENCE_NOT_FOUND' });
      sendJson(response, 500, { error: 'Internal server error' });
    }
  });
}

function parseSyntheticPhoneBudget(value: string | undefined): { remainingKrw: number; maximumPurchaseKrw: number } | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^\d{1,9}$/.test(value)) throw new Error('PHONE_SYNTHETIC_DEMO_BUDGET_KRW must be a positive integer');
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('PHONE_SYNTHETIC_DEMO_BUDGET_KRW must be a positive integer');
  return { remainingKrw: amount, maximumPurchaseKrw: amount };
}

export function resolvePhoneHmacSecret(env: NodeJS.ProcessEnv): string {
  const value = env.PHONE_HMAC_SECRET;
  if (value !== undefined) {
    if (Buffer.byteLength(value, 'utf8') < 32) throw new Error('PHONE_HMAC_SECRET must be at least 32 bytes');
    return value;
  }
  const liveRuntime = env.NODE_ENV === 'production' || Boolean(env.K_SERVICE) || Boolean(env.PUBLIC_BASE_URL) || Boolean(env.TWILIO_AUTH_TOKEN) || Boolean(env.CLAWOPS_SIGNING_KEY);
  if (liveRuntime) throw new Error('PHONE_HMAC_SECRET is required for a live or production runtime');
  return 'synthetic-demo-only-phone-hmac-secret';
}

function requireAuditReadAccess(request: IncomingMessage, secret: string | undefined): { status: number; body: { error: string } } | undefined {
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) return { status: 503, body: { error: 'Audit read API is not configured' } };
  const authorization = Array.isArray(request.headers.authorization) ? request.headers.authorization[0] : request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return { status: 401, body: { error: 'Unauthorized' } };
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return { status: 401, body: { error: 'Unauthorized' } };
  return undefined;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks = await readBoundedBody(request);
  if (chunks.length === 0) return {};
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestBodyError(400, 'INVALID_JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestBodyError(400, 'INVALID_JSON_BODY');
  return value as Record<string, unknown>;
}

async function readForm(request: IncomingMessage): Promise<Record<string, string>> {
  const chunks = await readBoundedBody(request);
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')).entries());
}

class RequestBodyError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

async function fetchRecording(
  rawUrl: string,
  baseUrl: string,
  allowedHosts: Set<string>,
  headers?: Record<string, string>,
  maximumBytes = 25 * 1024 * 1024
): Promise<Uint8Array> {
  let url: URL;
  try { url = new URL(rawUrl, baseUrl); } catch { throw new Error('Invalid recording URL'); }
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error('Recording URL is not allowed');
  const init: RequestInit = { redirect: 'error', signal: AbortSignal.timeout(15_000) };
  if (headers) init.headers = headers;
  const recording = await fetch(url, init);
  if (!recording.ok || !recording.body) throw new Error(`Recording fetch failed: ${recording.status}`);
  const declaredLength = Number(recording.headers.get('content-length') ?? 0);
  if (declaredLength > maximumBytes) throw new Error('Recording is too large');
  const reader = recording.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) { await reader.cancel(); throw new Error('Recording is too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function readBoundedBody(request: IncomingMessage, maximumBytes = 1_048_576): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maximumBytes) throw new RequestBodyError(413, 'REQUEST_BODY_TOO_LARGE');
    chunks.push(bytes);
  }
  return chunks;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...securityHeaders() });
  response.end(JSON.stringify(value));
}

class FixedWindowRateLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  consume(key: string, maximum: number, windowMs = 60_000, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const current = this.entries.get(key);
    if (!current || current.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count >= maximum) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
    }
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

function checkPublicCostLimit(
  request: IncomingMessage,
  url: URL,
  limiter: FixedWindowRateLimiter
): { error: string; retryAfterSeconds: number } | undefined {
  const route = request.method === 'POST' && url.pathname === '/api/food-support/interpret'
    ? { name: 'interpret', maximum: 12 }
    : request.method === 'GET' && ['/api/food-support/catalog', '/api/food-support/catalog-item'].includes(url.pathname)
      ? { name: 'catalog', maximum: 30 }
      : request.method === 'POST' && url.pathname === '/api/demo/run'
        ? { name: 'demo', maximum: 6 }
        : request.method === 'GET' && url.pathname === '/api/demo/food-order-proof'
          ? { name: 'supplier-proof', maximum: 30 }
          : undefined;
  if (!route) return undefined;
  const forwarded = Array.isArray(request.headers['x-forwarded-for'])
    ? request.headers['x-forwarded-for'].at(-1)
    : request.headers['x-forwarded-for'];
  const forwardedChain = forwarded?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
  const client = (forwardedChain.at(-1) || request.socket.remoteAddress || 'unknown').slice(0, 128);
  const global = limiter.consume(`${route.name}:global`, route.maximum * 5);
  const perClient = limiter.consume(`${route.name}:client:${client}`, route.maximum);
  const result = global.allowed ? perClient : global;
  return result.allowed ? undefined : { error: 'RATE_LIMITED', retryAfterSeconds: result.retryAfterSeconds };
}

async function serveStatic(url: URL, response: ServerResponse, headOnly = false): Promise<void> {
  const pathname = url.pathname;
  const appRoutes = new Set(['/app', '/ops', '/verify']);
  const techRoutes = new Set(['/tech', '/tech.html']);
  const file = pathname === '/'
    ? url.searchParams.has('v') ? 'index.html' : 'landing.html'
    : appRoutes.has(pathname) ? 'index.html'
      : techRoutes.has(pathname) ? 'tech.html'
        : pathname.slice(1);
  const deliveryAsset = /^assets\/delivery-evidence\/synthetic-(received-ok|damaged-rice|wrong-item)\.webp$/.test(file);
  const storyNames = new Set([
    'elder-voice-hero', 'elder-support-arrival', 'universal-agent-hero', 'parent-hands-full',
    'cafe-owner-replenishment', 'temporary-barrier-worker', 'wheelchair-independent-shopper',
    'student-everyday-request', 'household-order-arrival', 'supplier-fulfillment',
    'team-procurement', 'everyday-commerce-street', 'agent-commerce-collective',
    'app-only-barrier', 'subsidy-choice-burden'
  ]);
  const storyPng = file.match(/^assets\/story\/([a-z0-9-]+)\.png$/);
  const storyWebp = file.match(/^assets\/story\/([a-z0-9-]+)-(480|960|1536)\.webp$/);
  const storyAsset = Boolean((storyPng && storyNames.has(storyPng[1])) || (storyWebp && storyNames.has(storyWebp[1])));
  if (!deliveryAsset && !storyAsset && !['index.html', 'landing.html', 'tech.html', 'landing.js', 'tech.js', 'app.js', 'icons.js', 'styles.css', 'tokens.css'].includes(file)) return sendJson(response, 404, { error: 'Not found' });
  const bytes = await readFile(join(process.cwd(), 'public', file));
  const contentType = extname(file) === '.css' ? 'text/css; charset=utf-8'
    : extname(file) === '.js' ? 'text/javascript; charset=utf-8'
      : extname(file) === '.webp' ? 'image/webp'
        : extname(file) === '.png' ? 'image/png'
          : 'text/html; charset=utf-8';
  response.writeHead(200, { 'content-type': contentType, ...securityHeaders() });
  response.end(headOnly ? undefined : bytes);
}

function securityHeaders(): Record<string, string> {
  return {
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://static.wanted.co.kr https://cdn.jsdelivr.net; font-src 'self' https://static.wanted.co.kr https://cdn.jsdelivr.net; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'permissions-policy': 'camera=(), microphone=(self), geolocation=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY'
  };
}
