import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('public workflow preserves institution invite and 30-day order access handoffs', async () => {
  const source = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /institution-invite-form/);
  assert.match(source, /기관이 보낸 초대 링크/);
  assert.match(source, /issue-order-access/);
  assert.match(source, /copy-order-access/);
  assert.match(source, /30일/);
  assert.match(source, /TRACK_ORDER/);
  assert.match(source, /CANCEL_ORDER/);
});

test('public phone demo requires only user confirmation before direct ordering', async () => {
  const source = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('var DEMO_SCENES = {');
  const phoneStart = source.indexOf('phone: {', start);
  const phoneEnd = source.indexOf('risk: {', phoneStart);
  assert.notEqual(start, -1);
  assert.notEqual(phoneStart, -1);
  assert.notEqual(phoneEnd, -1);

  const phoneDemo = source.slice(phoneStart, phoneEnd);
  assert.match(phoneDemo, /이용자.*최종 확인/);
  assert.match(phoneDemo, /판매처.*바로 주문/);
  assert.doesNotMatch(phoneDemo, /기관 승인|담당자 승인|담당자 확인|승인함/);
});

test('ClawOps agent binds tool calls to call_id and feeds confirmed DTMF result to the voice session', async () => {
  const source = await readFile(new URL('../../scripts/clawops-vertex-agent.py', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /len\(active_cases\) != 1/);
  assert.match(source, /call_id: str/);
  assert.match(source, /active_cases\.get\(call_id\)/);
  assert.match(source, /server_result/);
  assert.match(source, /feed_dtmf/);
  assert.match(source, /except Exception:/);
  assert.match(source, /아직 주문하지 않았습니다/);
  assert.doesNotMatch(source, /담당자 확인으로 넘/);
});
