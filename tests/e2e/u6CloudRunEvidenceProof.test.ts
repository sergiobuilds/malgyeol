import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('U6 proof records a real Docker image and stable normal, blocked and replay hashes', async () => {
  const artifact = JSON.parse(await readFile('proof/u6-cloud-run-evidence.json', 'utf8'));
  assert.equal(artifact.unitId, 'U6-cloud-run-evidence');
  assert.match(artifact.status, /^PASS(?:_WITH_EXTERNAL_BLOCKERS)?$/);
  assert.equal(artifact.docker.status, 'LIVE_VERIFIED');
  assert.match(artifact.docker.imageId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(artifact.docker.cases.normal.state, 'ORDERED');
  assert.equal(artifact.docker.cases.blocked.state, 'POLICY_BLOCKED');
  assert.equal(artifact.docker.cases.blocked.paymentCrossed, false);
  assert.equal(artifact.docker.cases.replay.stable, true);
  assert.equal(artifact.docker.cases.replay.firstSha256, artifact.docker.cases.replay.secondSha256);
  for (const hash of [artifact.docker.cases.normal.sha256, artifact.docker.cases.blocked.sha256, artifact.docker.cases.replay.firstSha256]) {
    assert.match(hash, /^[a-f0-9]{64}$/);
  }
  if (artifact.cloudRun.status === 'BLOCKED_EXTERNAL_DEPENDENCY') {
    assert.equal(artifact.status, 'PASS_WITH_EXTERNAL_BLOCKERS');
    assert.equal(artifact.cloudRun.blocker.code, 'BLOCKED_EXTERNAL_DEPENDENCY');
    assert.notEqual(artifact.cloudRun.blocker.subprocess.exitCode, 0);
    assert.equal(artifact.cloudRun.sideEffectsStarted, 0);
  } else {
    assert.equal(artifact.cloudRun.status, 'LIVE_VERIFIED');
  }
  assert.deepEqual(artifact.privacy, {
    syntheticOnly: true, secretsPersisted: false, mainnetUsed: false, governmentIntegrationClaimed: false
  });
});
