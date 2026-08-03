import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('U3 proof gates x402 and Solana behind policy and one-time consent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'benefit-u3-proof-'));
  const output = join(directory, 'proof.json');
  const result = await runProof(output);
  assert.equal(result.exitCode, 0, result.stderr);
  const artifact = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(artifact.unitId, 'U3-x402-solana-devnet');
  assert.equal(artifact.status, 'PASS_WITH_EXTERNAL_BLOCKERS');
  assert.equal(artifact.boundary.policyBeforeConsentBeforePayment, true);
  assert.deepEqual(artifact.calls.approved, { x402: 1, solanaDevnet: 1 });
  assert.deepEqual(artifact.calls.policyBlocked, { x402: 0, solanaDevnet: 0 });
  assert.deepEqual(artifact.calls.rejectedReplay, { x402: 0, solanaDevnet: 0 });
  assert.deepEqual(artifact.calls.approvedReplayAdditional, { x402: 0, solanaDevnet: 0 });
  assert.equal(artifact.external.sideEffectsStarted, 0);
  assert.deepEqual(artifact.external.blockers.map((value: { provider: string }) => value.provider), ['x402', 'solana-devnet']);
  assert.ok(artifact.external.blockers.every((value: { subprocess: { exitCode: number } }) => value.subprocess.exitCode !== 0));
  assert.equal(artifact.mainnetUsed, false);
});

function runProof(output: string): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/prove-u3-x402-solana.mjs', output], {
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
