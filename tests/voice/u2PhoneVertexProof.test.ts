import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

test('U2 proof records credential blockers and rejects forged webhooks without capture', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'benefit-u2-proof-'));
  const output = join(directory, 'proof.json');
  const result = await runProof(output);
  assert.equal(result.exitCode, 0, result.stderr);
  const artifact = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(artifact.unitId, 'U2-phone-vertex-live');
  assert.equal(artifact.status, 'PASS_WITH_EXTERNAL_BLOCKERS');
  assert.equal(artifact.twilio.blocker.code, 'BLOCKED_EXTERNAL_DEPENDENCY');
  assert.equal(artifact.vertex.blocker.code, 'BLOCKED_EXTERNAL_DEPENDENCY');
  assert.notEqual(artifact.twilio.blocker.subprocess.exitCode, 0);
  assert.notEqual(artifact.vertex.blocker.subprocess.exitCode, 0);
  assert.deepEqual(artifact.forgedWebhook, { status: 403, captureCalls: 0, verified: true });
});

function runProof(output: string): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/prove-u2-phone-vertex.mjs', output], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? '', NODE_PATH: process.env.NODE_PATH ?? '' },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ exitCode: code ?? 1, stderr }));
  });
}
