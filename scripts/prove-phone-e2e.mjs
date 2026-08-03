import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as XLSX from '@e965/xlsx';
import { createApp } from '../src/app.ts';

const server = createApp();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server address unavailable');
  const base = `http://127.0.0.1:${address.port}`;
  const success = await run(base, 'success');
  const blocked = await run(base, 'blocked');
  if (success.state !== 'ORDERED' || !success.providerOrderId) throw new Error('Success scenario did not order');
  if (blocked.state !== 'POLICY_BLOCKED' || blocked.providerOrderId) throw new Error('Blocked scenario crossed the payment boundary');

  const workbookResponse = await fetch(`${base}/api/cases/${success.caseId}/export.xlsx`);
  if (!workbookResponse.ok) throw new Error('Workbook export failed');
  const workbookBytes = Buffer.from(await workbookResponse.arrayBuffer());
  const workbook = XLSX.read(workbookBytes);
  const expectedSheets = ['참여자별 집행', '주문·판매자', '차단·검토', '증빙 참조'];
  if (JSON.stringify(workbook.SheetNames) !== JSON.stringify(expectedSheets)) throw new Error('Workbook sheet contract failed');

  const replayCase = await run(base, 'success');
  const replayFirst = await fetch(`${base}/api/cases/${replayCase.caseId}`).then(response => response.json());
  const replaySecond = await fetch(`${base}/api/cases/${replayCase.caseId}`).then(response => response.json());
  if (replayFirst.providerOrderId !== replaySecond.providerOrderId) throw new Error('Order receipt changed during replay read');

  await mkdir('proof', { recursive: true });
  const common = {
    generatedAt: new Date().toISOString(),
    evidenceMode: 'synthetic-local',
    externalGates: { twilio: false, vertex: false, devnet: false },
    disclaimer: 'No external service or government funds were used.'
  };
  await writeFile('proof/e2e-phone-success.json', JSON.stringify({ ...common, scenario: 'success', result: success, workbook: { sheets: workbook.SheetNames, sha256: sha256(workbookBytes) } }, null, 2));
  await writeFile('proof/e2e-phone-blocked.json', JSON.stringify({ ...common, scenario: 'blocked', result: blocked, paymentCrossed: false }, null, 2));
  await writeFile('proof/e2e-phone-replay.json', JSON.stringify({ ...common, scenario: 'replay', caseId: replayCase.caseId, firstProviderOrderId: replayFirst.providerOrderId, secondProviderOrderId: replaySecond.providerOrderId, stable: true }, null, 2));
  process.stdout.write(JSON.stringify({ success: success.caseId, blocked: blocked.caseId, replay: replayCase.caseId, sheets: workbook.SheetNames }) + '\n');
} finally {
  server.close();
}

async function run(base, scenario) {
  const response = await fetch(`${base}/api/demo/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario })
  });
  if (!response.ok) throw new Error(`${scenario} scenario failed: ${response.status}`);
  return response.json();
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
