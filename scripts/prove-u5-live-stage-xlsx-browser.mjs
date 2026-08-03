import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import * as XLSX from '@e965/xlsx';
import WebSocket from 'ws';
import { createApp } from '../src/app.ts';

const outputPath = resolve(process.argv[2] ?? 'proof/u5-live-stage-xlsx-browser.json');
const expectedSheets = ['참여자별 집행', '주문·판매자', '차단·검토', '증빙 참조'];
const app = createApp();
app.listen(0, '127.0.0.1');
await once(app, 'listening');

let browser;
let profile;
try {
  const address = app.address();
  if (!address || typeof address === 'string') throw new Error('App address unavailable');
  const base = `http://127.0.0.1:${address.port}`;
  profile = await mkdtemp(join(tmpdir(), 'benefit-u5-chrome-'));
  browser = spawn('google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const devtools = await waitForDevtools(profile, browser);
  const targets = await fetch(`http://127.0.0.1:${devtools.port}/json/list`).then(response => response.json());
  const target = targets.find(value => value.type === 'page');
  if (!target?.webSocketDebuggerUrl) throw new Error('Chrome page target unavailable');
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Page.navigate', { url: base });
  await cdp.waitFor('Page.loadEventFired');
  await cdp.call('Runtime.evaluate', { expression: "document.querySelector('#success').click()" });

  const browserAssertion = await poll(async () => {
    const result = await cdp.call('Runtime.evaluate', {
      expression: `(() => {
        const stage = document.querySelector('#case');
        if (stage?.dataset.status !== 'ready') return null;
        return {
          caseId: document.querySelector('[data-case-id]')?.textContent,
          state: document.querySelector('[data-case-state]')?.textContent,
          stages: [...document.querySelectorAll('[data-stage]')].map(node => node.dataset.stage),
          exportCaseId: document.querySelector('[data-export-case-id]')?.dataset.exportCaseId,
          exportHref: document.querySelector('[data-export-case-id]')?.getAttribute('href')
        };
      })()`, returnByValue: true
    });
    return result.result?.value ?? null;
  }, 10_000);
  cdp.close();

  const requiredStages = ['CALL_CONNECTED', 'INTERPRETED', 'POLICY_CHECKING', 'CONFIRMED', 'PAID', 'ORDERED'];
  if (browserAssertion.state !== 'ORDERED') throw new Error('Browser stage did not reach ORDERED');
  if (JSON.stringify(browserAssertion.stages) !== JSON.stringify(requiredStages)) throw new Error('Browser stage contract failed');
  if (browserAssertion.exportCaseId !== browserAssertion.caseId) throw new Error('Browser export caseId diverged');

  const publicCase = await fetch(`${base}/api/cases/${browserAssertion.caseId}?technical=1`).then(response => response.json());
  if (publicCase.caseId !== browserAssertion.caseId || publicCase.state !== 'ORDERED') throw new Error('Public case diverged from browser stage');
  const workbookResponse = await fetch(`${base}${browserAssertion.exportHref}`);
  if (!workbookResponse.ok) throw new Error(`Workbook export failed: ${workbookResponse.status}`);
  const workbookBytes = Buffer.from(await workbookResponse.arrayBuffer());
  const workbook = XLSX.read(workbookBytes, { type: 'buffer' });
  if (JSON.stringify(workbook.SheetNames) !== JSON.stringify(expectedSheets)) throw new Error('Workbook sheet contract failed');
  const workbookCaseIds = Object.fromEntries(workbook.SheetNames.map(name => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: '' });
    return [name, [...new Set(rows.map(row => row.caseId).filter(Boolean))]];
  }));
  for (const name of ['참여자별 집행', '주문·판매자', '증빙 참조']) {
    if (JSON.stringify(workbookCaseIds[name]) !== JSON.stringify([browserAssertion.caseId])) throw new Error(`${name} caseId diverged`);
  }

  const artifact = {
    schemaVersion: 'u5-live-stage-xlsx-browser-evidence-v1',
    unitId: 'U5-live-stage-xlsx-browser',
    caseId: browserAssertion.caseId,
    status: 'PASS',
    browser: { engine: 'google-chrome-headless', assertion: browserAssertion, requiredStages },
    publicCase: { caseId: publicCase.caseId, state: publicCase.state, sandbox: publicCase.sandbox },
    workbook: { sheets: workbook.SheetNames, caseIdsBySheet: workbookCaseIds, sha256: createHash('sha256').update(workbookBytes).digest('hex') },
    privacy: { syntheticOnly: true, publicContainsBeneficiaryRef: JSON.stringify(publicCase).includes('beneficiaryRef'), publicContainsCallSidHash: JSON.stringify(publicCase).includes('callSidHash') }
  };
  if (artifact.privacy.publicContainsBeneficiaryRef || artifact.privacy.publicContainsCallSidHash) throw new Error('Public projection leaked private identifiers');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ artifact: outputPath, status: artifact.status, caseId: artifact.caseId, sheets: artifact.workbook.sheets })}\n`);
} finally {
  app.close();
  if (browser && browser.exitCode === null) {
    browser.kill('SIGTERM');
    await once(browser, 'exit');
  }
  if (profile) await rm(profile, { recursive: true, force: true });
}

async function waitForDevtools(profile, child) {
  const activePort = join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Chrome exited before CDP became ready: ${child.exitCode}`);
    try {
      const [port, path] = (await readFile(activePort, 'utf8')).trim().split('\n');
      if (port && path) return { port, path };
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Chrome CDP startup timed out');
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const events = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter?.reject(new Error(message.error.message)); else waiter?.resolve(message.result);
      return;
    }
    const waiter = events.get(message.method);
    if (waiter) { events.delete(message.method); waiter(message.params); }
  });
  return {
    call(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    waitFor(method) { return new Promise(resolve => events.set(method, resolve)); },
    close() { socket.close(); }
  };
}

async function poll(read, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Browser assertion timed out');
}
