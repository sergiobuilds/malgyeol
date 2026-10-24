import test from 'node:test';
import assert from 'node:assert/strict';
import { Connection, PublicKey } from '@solana/web3.js';

test('Solana v1 RPC client preserves request IDs and decodes single and batch responses', async () => {
  const calls: unknown[] = [];
  const connection = new Connection('https://rpc.invalid', {
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      calls.push(request);
      const respond = (item: { id: string; method: string; jsonrpc: string }) => {
        assert.equal(item.jsonrpc, '2.0');
        assert.equal(typeof item.id, 'string');
        assert.ok(item.id.length > 0);
        return {
          jsonrpc: '2.0', id: item.id,
          result: item.method === 'getBalance' ? { context: { slot: 123 }, value: 42 } : null
        };
      };
      return new Response(JSON.stringify(Array.isArray(request) ? request.map(respond) : respond(request)));
    }
  });

  assert.deepEqual(await connection.getBalanceAndContext(PublicKey.default), {
    context: { slot: 123 }, value: 42
  });
  assert.deepEqual(await connection.getParsedTransactions(['first-signature', 'second-signature']), [null, null]);
  assert.equal(calls.length, 2);
  assert.ok(Array.isArray(calls[1]));
});

test('Solana v1 RPC client propagates JSON-RPC server errors', async () => {
  const connection = new Connection('https://rpc.invalid', {
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'compatibility error' }
      }));
    }
  });
  await assert.rejects(connection.getSlot(), /compatibility error/);
});
