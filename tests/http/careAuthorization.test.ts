import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createCareApp } from '../../src/careApp.ts';

test('HTTP role boundaries and anonymous demo isolation', async t => {
  const settings = { AGENT_TOOL_SECRET: 'agent-'.padEnd(40, 'a'), CARE_PROVIDER_TOKEN: 'provider-'.padEnd(40, 'p'), CARE_RECIPIENT_TOKEN: 'recipient-'.padEnd(40, 'r'), CARE_OPERATOR_TOKEN: 'operator-'.padEnd(40, 'o') };
  const previous = { ...process.env };
  Object.assign(process.env, settings);
  const server = createCareApp();
  for (const key of Object.keys(settings)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, token: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await fetch(base + '/api/care/inbox')).status, 403);
  assert.equal((await post('/internal/care-agent/begin', settings.CARE_RECIPIENT_TOKEN, { callId: 'secure-call' })).status, 403);
  await post('/internal/care-agent/begin', settings.AGENT_TOOL_SECRET, { callId: 'secure-call' });
  const selection = await (await post('/internal/care-agent/select', settings.AGENT_TOOL_SECRET, { callId: 'secure-call', text: '쌀' })).json() as any;
  await post('/internal/care-agent/confirm', settings.AGENT_TOOL_SECRET, { callId: 'secure-call', token: selection.token, digit: '1' });
  const demo = await (await fetch(base + '/api/demo/care/requests')).json() as any;
  assert.equal(demo.requests.length, 0);
  const path = `/api/care/requests/${selection.caseId}`;
  assert.equal((await post(path + '/actions', settings.CARE_RECIPIENT_TOKEN, { action: 'PROVIDER_ACCEPT' })).status, 403);
  assert.equal((await post(path + '/submit', settings.CARE_OPERATOR_TOKEN, {})).status, 403);
  assert.equal((await post(path + '/submit', settings.CARE_PROVIDER_TOKEN, {})).status, 200);
  assert.equal((await post(path + '/actions', settings.CARE_PROVIDER_TOKEN, { action: 'MARK_PROVIDED' })).status, 200);
  assert.equal((await post(path + '/actions', settings.CARE_PROVIDER_TOKEN, { action: 'CONFIRM_RECEIPT' })).status, 403);
  assert.equal((await post(path + '/actions', settings.CARE_RECIPIENT_TOKEN, { action: 'CONFIRM_RECEIPT' })).status, 200);
  const events = await (await fetch(base + path + '/events', { headers: { authorization: `Bearer ${settings.CARE_RECIPIENT_TOKEN}` } })).json() as any;
  assert.deepEqual(events.events.map((e: any) => e.type), ['REQUESTED', 'CONFIRMED', 'PROVIDER_SUBMITTED', 'PROVIDER_ACCEPTED', 'PROVIDED', 'RECIPIENT_CONFIRMED']);
});
