import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('U5 proof binds browser stage, public case and XLSX to one caseId', async () => {
  const artifact = JSON.parse(await readFile('proof/u5-live-stage-xlsx-browser.json', 'utf8'));
  assert.equal(artifact.unitId, 'U5-live-stage-xlsx-browser');
  assert.equal(artifact.status, 'PASS');
  assert.equal(artifact.browser.assertion.caseId, artifact.caseId);
  assert.equal(artifact.browser.assertion.exportCaseId, artifact.caseId);
  assert.equal(artifact.publicCase.caseId, artifact.caseId);
  assert.deepEqual(artifact.browser.assertion.stages, artifact.browser.requiredStages);
  assert.deepEqual(artifact.workbook.sheets, ['참여자별 집행', '주문·판매자', '차단·검토', '증빙 참조']);
  for (const name of ['참여자별 집행', '주문·판매자', '증빙 참조']) assert.deepEqual(artifact.workbook.caseIdsBySheet[name], [artifact.caseId]);
  assert.equal(artifact.privacy.publicContainsBeneficiaryRef, false);
  assert.equal(artifact.privacy.publicContainsCallSidHash, false);
});
