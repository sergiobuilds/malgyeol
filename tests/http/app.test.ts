import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../../src/app.ts';

test('HTTP app serves health, synthetic normal demo and privacy-safe public case', async (t) => {
  const previousAuditSecret = process.env.AUDIT_READ_SECRET;
  const auditSecret = 'test-audit-secret-that-is-at-least-32-bytes';
  process.env.AUDIT_READ_SECRET = auditSecret;
  const server = createApp();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.close();
    if (previousAuditSecret === undefined) delete process.env.AUDIT_READ_SECRET;
    else process.env.AUDIT_READ_SECRET = previousAuditSecret;
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  for (const path of ['/', '/?v=home', '/app', '/ops', '/verify', '/tech', '/tokens.css', '/icons.js']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, `static app route ${path}`);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  const landing = await fetch(`${base}/`).then(response => response.text());
  assert.match(landing, /말 한마디가/);
  assert.match(landing, /AI가 아닌 사람이 최종 결정을/);
  assert.equal((landing.match(/<section\b/g) ?? []).length, 4);
  const productApp = await fetch(`${base}/?v=home`).then(response => response.text());
  assert.match(productApp, /id="app"/);
  const technicalPage = await fetch(`${base}/tech`).then(response => response.text());
  assert.match(technicalPage, /AI는 이해를 돕고,[\s\S]*규칙과 사람이 결정합니다\./);
  const storyPng = await fetch(`${base}/assets/story/elder-voice-hero.png`);
  assert.equal(storyPng.status, 200);
  assert.equal(storyPng.headers.get('content-type'), 'image/png');
  const storyWebp = await fetch(`${base}/assets/story/elder-support-arrival-480.webp`);
  assert.equal(storyWebp.status, 200);
  assert.equal(storyWebp.headers.get('content-type'), 'image/webp');
  const universalStoryWebp = await fetch(`${base}/assets/story/universal-agent-hero-960.webp`);
  assert.equal(universalStoryWebp.status, 200);
  assert.equal(universalStoryWebp.headers.get('content-type'), 'image/webp');
  for (const unsupportedStoryAsset of [
    '/assets/story/not-allowed.png',
    '/assets/story/elder-voice-hero-120.webp',
    '/assets/story/elder-voice-hero.svg'
  ]) {
    assert.equal((await fetch(`${base}${unsupportedStoryAsset}`)).status, 404, `unsupported story asset ${unsupportedStoryAsset}`);
  }
  for (const removedRoleRoute of ['/caregiver', '/merchant']) {
    assert.equal((await fetch(`${base}${removedRoleRoute}`)).status, 404, `removed role route ${removedRoleRoute}`);
  }
  const head = await fetch(`${base}/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('x-frame-options'), 'DENY');
  const run = await fetch(`${base}/api/demo/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: 'success' }) });
  assert.equal(run.status, 200);
  const result = await run.json() as { caseId: string; state: string };
  assert.equal(result.state, 'ORDERED');
  assert.equal((await fetch(`${base}/api/cases/${result.caseId}`)).status, 401);
  const auditHeaders = { authorization: `Bearer ${auditSecret}` };
  const publicCase = await fetch(`${base}/api/cases/${result.caseId}`, { headers: auditHeaders }).then(response => response.text());
  assert.equal(publicCase.includes('callSidHash'), false);
  assert.equal(publicCase.includes('beneficiaryRef'), false);
  const publicEvents = await fetch(`${base}/api/cases/${result.caseId}/events`, { headers: auditHeaders }).then(response => response.text());
  assert.equal(publicEvents.includes('callSidHash'), false);
  assert.equal(publicEvents.includes('beneficiaryRef'), false);
  assert.equal(publicEvents.includes('confirmationCommitment'), false);
  assert.equal(publicEvents.includes('candidate'), false);
  const listResponse = await fetch(`${base}/api/cases`);
  assert.equal(listResponse.status, 401);
  const exportResponse = await fetch(`${base}/api/cases/${result.caseId}/export.xlsx`);
  assert.equal(exportResponse.status, 401);

  for (let index = 0; index < 12; index += 1) {
    const response = await fetch(`${base}/api/food-support/interpret`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caseId: `web_rate_${index}`, text: '잡곡 한 봉지 찾아줘' })
    });
    assert.equal(response.status, 200);
  }
  const limited = await fetch(`${base}/api/food-support/interpret`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caseId: 'web_rate_limited', text: '잡곡 한 봉지 찾아줘' })
  });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json() as { error: string }).error, 'RATE_LIMITED');
});
