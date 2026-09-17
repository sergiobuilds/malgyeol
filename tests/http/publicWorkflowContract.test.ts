import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('public workflow exposes recipient, provider and exception-only operator handoffs', async () => {
  const source = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /수행기관에 요청하기/);
  assert.match(source, /PROVIDER_ACCEPT/);
  assert.match(source, /MARK_PROVIDED/);
  assert.match(source, /CONFIRM_RECEIPT/);
  assert.match(source, /RAISE_EXCEPTION/);
  assert.match(source, /정상 건은 줄이고/);
});

test('public product removes payment and direct commerce language', async () => {
  const source = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /개인별지원계획/);
  assert.match(source, /수행기관/);
  assert.match(source, /수령 확인/);
  assert.doesNotMatch(source, /결제|잔액 차감|농식품바우처|판매처.*주문/);
});
