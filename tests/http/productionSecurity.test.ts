import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp, resolvePhoneHmacSecret } from '../../src/app.ts';

test('production and live phone runtimes require a strong PHONE_HMAC_SECRET', () => {
  assert.throws(() => resolvePhoneHmacSecret({ NODE_ENV: 'production' }), /required/);
  assert.throws(() => resolvePhoneHmacSecret({ K_SERVICE: 'benefit-settlement-rail' }), /required/);
  assert.throws(() => resolvePhoneHmacSecret({ PUBLIC_BASE_URL: 'https://example.test' }), /required/);
  assert.throws(() => resolvePhoneHmacSecret({ PHONE_HMAC_SECRET: 'short' }), /at least 32/);
  assert.equal(resolvePhoneHmacSecret({ PHONE_HMAC_SECRET: 'a'.repeat(32), NODE_ENV: 'production' }), 'a'.repeat(32));
});

test('case list and XLSX require audit bearer access', async (t) => {
  const previous = process.env.AUDIT_READ_SECRET;
  const secret = 'audit-secret-that-is-at-least-32-bytes';
  process.env.AUDIT_READ_SECRET = secret;
  const server = createApp();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.close();
    if (previous === undefined) delete process.env.AUDIT_READ_SECRET;
    else process.env.AUDIT_READ_SECRET = previous;
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(`${base}/api/cases`)).status, 401);
  assert.equal((await fetch(`${base}/api/cases`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(`${base}/api/cases`, { headers: { authorization: `Bearer ${secret}` } })).status, 200);
  assert.equal((await fetch(`${base}/api/cases/case_missing/export.xlsx`, { headers: { authorization: `Bearer ${secret}` } })).status, 404);
});
