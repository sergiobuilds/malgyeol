import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { InMemoryCareRequestRepository } from './care-support/repository.ts';
import { CareRequestError, CareRequestService } from './care-support/service.ts';
import { createCareRequestHandlers } from './http/careRequestRoutes.ts';
import { createCareVoiceHandlers } from './voice/careVoiceRoutes.ts';
import { CarePhoneCoordinator } from './care-support/phone.ts';
import { timingSafeEqual } from 'node:crypto';
import { SqliteCareRequestRepository } from './care-support/sqliteRepository.ts';
import { CareProviderDispatcher, SandboxCareProvider } from './care-support/provider.ts';

export function createCareApp() {
  const operationalEnabled = process.env.NODE_ENV !== 'production' || Boolean(process.env.CARE_LEDGER_PATH);
  const repository = process.env.CARE_LEDGER_PATH ? new SqliteCareRequestRepository(process.env.CARE_LEDGER_PATH) : new InMemoryCareRequestRepository();
  const service = new CareRequestService(repository);
  // Anonymous browser demos can never consume the operational phone quota or cases.
  const careHandlers = createCareRequestHandlers(new CareRequestService(new InMemoryCareRequestRepository()));
  const roleTokens = { PROVIDER: process.env.CARE_PROVIDER_TOKEN, RECIPIENT: process.env.CARE_RECIPIENT_TOKEN, OPERATOR: process.env.CARE_OPERATOR_TOKEN };
  const configuredTokens = Object.values(roleTokens).filter((v): v is string => Boolean(v));
  if (new Set(configuredTokens).size !== configuredTokens.length) throw new Error('CARE_ROLE_TOKENS_MUST_BE_DISTINCT');
  const providerName = process.env.CARE_PROVIDER_NAME ?? '찾아가는 푸드마켓';
  const automaticDispatchers = new Map(service.catalog().items.map(item => [item.providerName, new CareProviderDispatcher(repository, new SandboxCareProvider(item.providerName, repository))]));
  const dispatcher = automaticDispatchers.get(providerName) ?? new CareProviderDispatcher(repository, new SandboxCareProvider(providerName));
  const phone = new CarePhoneCoordinator(service);
  const agentSecret = process.env.AGENT_TOOL_SECRET;
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const dispatchConfirmed = async (caseId: string) => {
    const confirmed = await service.get(caseId);
    if (confirmed) return automaticDispatchers.get(confirmed.providerName)?.submit(caseId);
    return undefined;
  };
  const voice = operationalEnabled && publicBaseUrl && twilioAuthToken
    ? createCareVoiceHandlers({ authToken: twilioAuthToken, baseUrl: publicBaseUrl, service, onConfirmed: dispatchConfirmed })
    : undefined;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      if (request.method === 'GET' && ['/health', '/healthz', '/api/health'].includes(url.pathname)) {
        return sendJson(response, 200, {
          ok: true,
          product: 'care-plan-execution',
          payment: 'disabled',
          voice: !operationalEnabled ? 'demo-only' : agentSecret ? 'clawops-bridge-configured' : voice ? 'configured' : 'credential-gated',
          evidenceClass: 'SYNTHETIC_DEMO'
        });
      }
      if (url.pathname.startsWith('/api/care/')) {
        if (!operationalEnabled) return sendJson(response, 503, { error: 'DURABLE_LEDGER_REQUIRED' });
        const authorization = String(request.headers.authorization ?? '');
        const role = (Object.keys(roleTokens) as Array<keyof typeof roleTokens>).find(key => safeBearer(authorization, roleTokens[key]));
        if (!role) return sendJson(response, 403, { error: 'FORBIDDEN' });
        const scoped = (r: { providerName: string; beneficiaryRef: string }) => role === 'OPERATOR' || (role === 'PROVIDER' ? r.providerName === providerName : r.beneficiaryRef === 'demo-senior-01');
        if (request.method === 'GET' && url.pathname === '/api/care/inbox') {
          const requests = (await service.list()).filter(scoped).filter(r => role !== 'OPERATOR' || r.status === 'EXCEPTION' || r.status === 'REQUESTED' || r.dispatch === 'SENDING' || r.dispatch === 'UNKNOWN');
          const exceptions = role === 'OPERATOR' ? repository.transaction(ledger => Object.values(ledger.calls).filter(c => c.state === 'EXCEPTION').map(c => ({ caseId: c.caseId, reason: c.reason, state: c.state }))) : [];
          return sendJson(response, 200, { requests, exceptions, synthetic: true });
        }
        const match = url.pathname.match(/^\/api\/care\/requests\/(CARE-[a-zA-Z0-9-]+)\/(events|actions|submit|readback)$/);
        if (!match) return sendJson(response, 404, { error: 'NOT_FOUND' });
        const caseId = match[1]!;
        const value = await service.get(caseId);
        if (!value || !scoped(value)) return sendJson(response, 404, { error: 'NOT_FOUND' });
        if (request.method === 'GET' && match[2] === 'events') return sendJson(response, 200, { request: value, events: await service.events(caseId), synthetic: true });
        if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
        if (match[2] === 'submit' || match[2] === 'readback') {
          if (role !== 'PROVIDER') return sendJson(response, 403, { error: 'ROLE_FORBIDDEN' });
          const result = match[2] === 'submit' ? await dispatcher.submit(caseId) : await dispatcher.readback(caseId);
          return sendJson(response, 200, { request: result, synthetic: true });
        }
        const body = await readJson(request);
        const result = await service.act(caseId, String(body.action) as Parameters<typeof service.act>[1], typeof body.reason === 'string' ? body.reason : undefined, role);
        return sendJson(response, 200, { request: result, synthetic: true });
      }
      if (url.pathname.startsWith('/internal/care-agent/')) {
        if (!operationalEnabled) return sendJson(response, 503, { error: 'DURABLE_LEDGER_REQUIRED' });
        const supplied = String(request.headers.authorization ?? '');
        if (!safeBearer(supplied, agentSecret)) return sendJson(response, 403, { error: 'FORBIDDEN' });
        if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
        const body = await readJson(request);
        const callId = typeof body.callId === 'string' ? body.callId : '';
        if (!/^[A-Za-z0-9_-]{1,160}$/.test(callId)) return sendJson(response, 400, { error: 'INVALID_CALL_ID' });
        const operation = url.pathname.slice('/internal/care-agent/'.length);
        const result = operation === 'begin' ? phone.begin(callId)
          : operation === 'select' ? phone.select(callId, typeof body.text === 'string' ? body.text : '')
          : operation === 'confirm' ? await phone.confirm(callId, String(body.token ?? ''), String(body.digit ?? ''))
          : operation === 'end' ? phone.end(callId)
          : operation === 'status' ? phone.status(callId) : undefined;
        if (operation === 'confirm' && result?.state === 'CONFIRMED' && result.caseId) {
          await dispatchConfirmed(result.caseId);
        }
        return sendJson(response, result ? 200 : 404, result ?? { error: 'NOT_FOUND' });
      }
      if (url.pathname.startsWith('/api/demo/care/')) {
        const result = await careHandlers({
          method: request.method ?? 'GET',
          pathname: url.pathname,
          ...(request.method === 'POST' ? { body: await readJson(request) } : {})
        });
        return sendJson(response, result.status, result.body);
      }
      if (request.method === 'POST' && ['/voice/incoming', '/voice/request', '/voice/confirm'].includes(url.pathname)) {
        if (!voice || !publicBaseUrl) return sendJson(response, 503, { error: 'VOICE_CREDENTIALS_NOT_CONFIGURED' });
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
          ? voice.incoming(voiceRequest)
          : url.pathname === '/voice/request'
            ? await voice.request(voiceRequest)
            : await voice.confirm(voiceRequest);
        response.writeHead(result.status, { ...result.headers, ...securityHeaders() });
        return response.end(result.body);
      }
      if (request.method === 'GET' || request.method === 'HEAD') return serveStatic(url, response, request.method === 'HEAD');
      return sendJson(response, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      if (error instanceof CareRequestError) return sendJson(response, error.code === 'ROLE_FORBIDDEN' ? 403 : 409, { error: error.code });
      if (error instanceof RequestBodyError) return sendJson(response, error.status, { error: error.code });
      return sendJson(response, 500, { error: 'INTERNAL_SERVER_ERROR' });
    }
  });
  server.on('close', () => { if (repository instanceof SqliteCareRequestRepository) repository.close(); });
  return server;
}

function safeBearer(supplied: string, token: string | undefined): boolean {
  if (!token || token.length < 32) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const body = Buffer.concat(await readBoundedBody(request)).toString('utf8');
  if (!body) return {};
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new RequestBodyError(400, 'INVALID_JSON');
  }
}

async function readForm(request: IncomingMessage): Promise<Record<string, string>> {
  return Object.fromEntries(new URLSearchParams(Buffer.concat(await readBoundedBody(request)).toString('utf8')).entries());
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

class RequestBodyError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

async function serveStatic(url: URL, response: ServerResponse, headOnly: boolean): Promise<void> {
  const appRoutes = new Set(['/app', '/ops', '/verify']);
  const file = url.pathname === '/'
    ? url.searchParams.has('v') ? 'index.html' : 'landing.html'
    : appRoutes.has(url.pathname) ? 'index.html'
      : ['/tech', '/tech.html'].includes(url.pathname) ? 'tech.html'
        : url.pathname.slice(1);
  const root = resolve(process.cwd(), 'public');
  const path = resolve(root, file);
  const asset = file.startsWith('assets/') && path.startsWith(root + sep) && ['.png', '.webp', '.jpg', '.svg', '.woff2'].includes(extname(file));
  if (!asset && !['index.html', 'landing.html', 'tech.html', 'app.js', 'styles.css', 'tokens.css', 'icons.js'].includes(file)) return sendJson(response, 404, { error: 'NOT_FOUND' });
  let bytes: Buffer;
  try { bytes = await readFile(path); } catch { return sendJson(response, 404, { error: 'NOT_FOUND' }); }
  const contentType = ({ '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' } as Record<string, string>)[extname(file)] ?? (extname(file) === '.css' ? 'text/css; charset=utf-8' : extname(file) === '.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
  response.writeHead(200, { 'content-type': contentType, ...securityHeaders() });
  response.end(headOnly ? undefined : bytes);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...securityHeaders() });
  response.end(JSON.stringify(value));
}

function securityHeaders(): Record<string, string> {
  return {
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://static.wanted.co.kr https://cdn.jsdelivr.net; font-src 'self' https://static.wanted.co.kr https://cdn.jsdelivr.net; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY'
  };
}
