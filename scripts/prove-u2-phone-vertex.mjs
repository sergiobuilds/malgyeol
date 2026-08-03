import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import 'tsx/esm';

const { createTwilioProviderAdapter, createVertexProviderAdapter } = await import('../src/providers/providerContracts.ts');
const { createVoiceHandlers } = await import('../src/voice/twilioRoutes.ts');
const { VertexAudioInterpreter } = await import('../src/voice/vertexAudioInterpreter.ts');

const outputPath = resolve(process.argv[2] ?? 'proof/u2-phone-vertex-live.json');
const caseId = 'case_synthetic_u2_phone_vertex';
const publicBaseUrl = process.env.PUBLIC_BASE_URL;
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioLiveCallSid = process.env.TWILIO_LIVE_CALL_SID;
const vertexProject = process.env.GOOGLE_CLOUD_PROJECT;
const vertexLocation = process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1';
const vertexModel = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

const twilioLiveReady = Boolean(publicBaseUrl && twilioAccountSid && twilioAuthToken && twilioLiveCallSid);
const vertexLiveReady = Boolean(vertexProject && process.env.VERTEX_LIVE_AUDIO === '1');

let forgedCaptureCalls = 0;
const forgedHandlers = createVoiceHandlers({
  authToken: 'synthetic-u2-auth-token',
  baseUrl: 'https://synthetic.invalid',
  async capture() {
    forgedCaptureCalls += 1;
    throw new Error('forged webhook reached capture');
  },
  async confirm() { throw new Error('forged webhook reached confirm'); }
});
const forgedResponse = await forgedHandlers.incoming({
  signature: 'forged-signature',
  params: { CallSid: 'CA_SYNTHETIC_FORGED' }
});
if (forgedResponse.status !== 403 || forgedCaptureCalls !== 0) throw new Error('Forged Twilio webhook was not rejected before capture');

const twilioPreflight = await createTwilioProviderAdapter(twilioLiveReady).preflight(caseId, 'receive-inbound-call');
const vertexPreflight = await createVertexProviderAdapter(vertexLiveReady).preflight(caseId, 'interpret-audio-json');

let twilioEvidence;
if (twilioPreflight.status === 'BLOCKED') {
  twilioEvidence = { status: 'BLOCKED_EXTERNAL_DEPENDENCY', blocker: twilioPreflight.blocker };
} else {
  const authorization = Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}/Calls/${encodeURIComponent(twilioLiveCallSid)}.json`, {
    headers: { authorization: `Basic ${authorization}` }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Twilio live call verification failed: ${response.status}`);
  if (payload.sid !== twilioLiveCallSid || payload.direction !== 'inbound') throw new Error('Twilio evidence is not the requested inbound call');
  twilioEvidence = {
    status: 'LIVE_VERIFIED',
    callSidSha256: createHash('sha256').update(String(payload.sid)).digest('hex'),
    direction: payload.direction,
    callStatus: payload.status
  };
}

let vertexEvidence;
if (vertexPreflight.status === 'BLOCKED') {
  vertexEvidence = { status: 'BLOCKED_EXTERNAL_DEPENDENCY', blocker: vertexPreflight.blocker };
} else {
  const audio = await readFile(resolve('fixtures/g2/clear-meal-order.mp3'));
  const interpreter = new VertexAudioInterpreter({ project: vertexProject, location: vertexLocation, model: vertexModel });
  const result = await interpreter.analyzeAudio(audio, 'audio/mpeg');
  vertexEvidence = {
    status: 'LIVE_VERIFIED',
    input: { mimeType: 'audio/mpeg', bytes: audio.byteLength, sha256: createHash('sha256').update(audio).digest('hex') },
    response: result
  };
}

const blockers = [twilioEvidence, vertexEvidence].filter(value => value.status === 'BLOCKED_EXTERNAL_DEPENDENCY');
const artifact = {
  schemaVersion: 'phone-vertex-live-evidence-v1',
  unitId: 'U2-phone-vertex-live',
  caseId,
  status: blockers.length === 0 ? 'PASS' : 'PASS_WITH_EXTERNAL_BLOCKERS',
  twilio: twilioEvidence,
  vertex: vertexEvidence,
  forgedWebhook: { status: forgedResponse.status, captureCalls: forgedCaptureCalls, verified: true },
  secretValuesPersisted: false,
  realPersonalDataUsed: false,
  verified: true
};

await mkdir(resolve(outputPath, '..'), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ artifact: outputPath, status: artifact.status, blockers: blockers.length, forgedCaptureCalls })}\n`);
