import { createHash, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';

const outputPath = process.argv[2] ?? 'proof/u6-cloud-run-evidence.json';
const nonce = randomBytes(6).toString('hex');
const image = `benefit-settlement-rail:u6-${nonce}`;
const container = `benefit-settlement-rail-u6-${nonce}`;
const port = await reservePort();
let containerStarted = false;

try {
  process.stderr.write('u6:building-image\n');
  const build = await command('docker', ['build', '--pull=false', '-t', image, '.']);
  requireSuccess(build, 'Docker image build');
  const imageIdResult = await command('docker', ['image', 'inspect', image, '--format', '{{.Id}}']);
  requireSuccess(imageIdResult, 'Docker image inspect');
  const imageId = imageIdResult.stdout.trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Docker image did not produce a content hash');

  const run = await command('docker', [
    'run', '--detach', '--rm', '--name', container,
    '--publish', `127.0.0.1:${port}:8080`, image
  ]);
  requireSuccess(run, 'Docker container start');
  containerStarted = true;
  process.stderr.write('u6:waiting-for-container\n');
  const dockerBase = `http://127.0.0.1:${port}`;
  await waitForHealth(dockerBase);
  process.stderr.write('u6:container-healthy\n');
  const dockerEvidence = await exercise(dockerBase);
  process.stderr.write('u6:checking-cloud-run\n');
  const cloudRun = await verifyCloudRun();

  const artifact = {
    schemaVersion: 'u6-cloud-run-evidence-v1',
    unitId: 'U6-cloud-run-evidence',
    status: cloudRun.status === 'LIVE_VERIFIED' ? 'PASS' : 'PASS_WITH_EXTERNAL_BLOCKERS',
    generatedAt: new Date().toISOString(),
    docker: {
      status: 'LIVE_VERIFIED',
      imageId,
      health: { ok: true, mode: 'synthetic-local', externalEvidence: 'credential-gated' },
      ...dockerEvidence
    },
    cloudRun,
    privacy: {
      syntheticOnly: true,
      secretsPersisted: false,
      mainnetUsed: false,
      governmentIntegrationClaimed: false
    }
  };
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ artifact: outputPath, status: artifact.status, imageId, cloudRun: cloudRun.status })}\n`);
} finally {
  process.stderr.write('u6:cleaning-container\n');
  if (containerStarted) await command('docker', ['stop', '--timeout', '2', container]);
}

async function verifyCloudRun() {
  const configuredUrl = process.env.CLOUD_RUN_SERVICE_URL?.replace(/\/$/, '');
  if (configuredUrl) {
    if (!configuredUrl.startsWith('https://')) throw new Error('CLOUD_RUN_SERVICE_URL must use HTTPS');
    const health = await getJson(`${configuredUrl}/healthz`);
    if (health.ok !== true) throw new Error('Cloud Run health check failed');
    return { status: 'LIVE_VERIFIED', serviceUrlSha256: sha256(configuredUrl), health, ...(await exercise(configuredUrl)) };
  }

  const project = process.env.GOOGLE_CLOUD_PROJECT ?? 'credential-gated-project';
  const service = process.env.CLOUD_RUN_SERVICE ?? 'benefit-settlement-rail';
  const region = process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1';
  const preflight = await command('gcloud', [
    'run', 'services', 'describe', service, '--project', project, '--region', region,
    '--format=value(status.url)', '--quiet'
  ]);
  if (preflight.exitCode === 0) {
    const serviceUrl = preflight.stdout.trim().replace(/\/$/, '');
    if (!serviceUrl.startsWith('https://')) throw new Error('gcloud returned no HTTPS Cloud Run service URL');
    const health = await getJson(`${serviceUrl}/healthz`);
    return { status: 'LIVE_VERIFIED', serviceUrlSha256: sha256(serviceUrl), health, ...(await exercise(serviceUrl)) };
  }
  return {
    status: 'BLOCKED_EXTERNAL_DEPENDENCY',
    blocker: {
      code: 'BLOCKED_EXTERNAL_DEPENDENCY', provider: 'cloud-run', operation: 'describe-deployment',
      subprocess: { exitCode: preflight.exitCode, stderrSha256: sha256(preflight.stderr) }
    },
    sideEffectsStarted: 0
  };
}

async function exercise(base) {
  const success = await postScenario(base, 'success');
  const blocked = await postScenario(base, 'blocked');
  if (success.state !== 'ORDERED' || !success.providerOrderId) throw new Error('Normal path did not reach ORDERED');
  if (blocked.state !== 'POLICY_BLOCKED' || blocked.providerOrderId || blocked.technicalProof?.paymentIntentId) {
    throw new Error('Blocked path crossed payment or order boundary');
  }
  const replayFirst = await getJson(`${base}/api/cases/${success.caseId}?technical=1`);
  const replaySecond = await getJson(`${base}/api/cases/${success.caseId}?technical=1`);
  const firstHash = hashJson(replayFirst);
  const secondHash = hashJson(replaySecond);
  if (firstHash !== secondHash || replayFirst.providerOrderId !== success.providerOrderId) {
    throw new Error('Replay changed the case or provider order evidence');
  }
  const serialized = JSON.stringify({ success, blocked, replayFirst });
  if (/\+\d{8,}|TWILIO_AUTH_TOKEN|PHONE_HMAC_SECRET|BEGIN PRIVATE KEY/i.test(serialized)) {
    throw new Error('Sensitive data detected in public evidence');
  }
  return {
    cases: {
      normal: { caseId: success.caseId, state: success.state, sha256: hashJson(success) },
      blocked: { caseId: blocked.caseId, state: blocked.state, paymentCrossed: false, sha256: hashJson(blocked) },
      replay: { caseId: success.caseId, stable: true, firstSha256: firstHash, secondSha256: secondHash }
    }
  };
}

async function postScenario(base, scenario) {
  return requestJson(`${base}/api/demo/run`, 'POST', { scenario });
}

async function getJson(url) {
  return requestJson(url, 'GET');
}

function requestJson(urlText, method, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlText);
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(url, {
      method,
      headers: body === undefined ? undefined : {
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body)
      },
      timeout: 15_000
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.once('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(`${urlText} returned ${response.statusCode}: ${text}`));
        }
        try { resolve(JSON.parse(text)); } catch (error) { reject(error); }
      });
    });
    request.once('timeout', () => request.destroy(new Error(`${urlText} timed out`)));
    request.once('error', reject);
    request.end(body);
  });
}

async function waitForHealth(base) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const health = await getJson(`${base}/healthz`);
      if (health.ok === true) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Docker health check timed out: ${String(lastError)}`);
}

function command(program, args) {
  return new Promise(resolve => {
    const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.once('error', error => resolve({ exitCode: 127, stdout, stderr: `${program}: ${error.message}` }));
    child.once('close', code => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not reserve Docker port'));
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

function requireSuccess(result, label) {
  if (result.exitCode !== 0) throw new Error(`${label} failed (${result.exitCode}): ${result.stderr}`);
}

function hashJson(value) {
  return sha256(JSON.stringify(sortObject(value)));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortObject(item)]));
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
