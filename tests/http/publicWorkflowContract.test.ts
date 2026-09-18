import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createCareApp } from '../../src/careApp.ts';

test('public entrypoints serve their actual local styles and scripts', async t => {
  const server=createCareApp();server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  for(const route of ['/','/app','/ops','/tech']) {
    const response=await fetch(base+route);assert.equal(response.status,200);
    assert.match(response.headers.get('content-security-policy') ?? '',/script-src 'self'/);
    const html=await response.text();
    const assets=[...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/g)]
      .map(m=>m[1]!).filter(path=>/\.(?:js|css)(?:\?|$)/.test(path));
    assert.ok(assets.length>0,route);
    for(const path of assets) {
      const url=new URL(path,base+route);assert.equal(url.origin,base,'product assets must be self-hosted');
      const asset=await fetch(url);assert.equal(asset.status,200,`${route}: ${path}`);
      assert.ok((await asset.text()).length>0);
    }
  }
});

test('public entrypoints protect runtime files while requests are login-free', async t=>{
  const server=createCareApp();server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  for(const path of ['/.env','/.private/care-ledger.sqlite','/.private/coordination-routing.json','/src/careApp.ts','/assets/../../.secrets/care.env']) {
    assert.equal((await fetch(base+path)).status,404,path);
  }
  assert.equal((await fetch(base+'/api/coordination/requests')).status,200);
});
