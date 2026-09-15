import { spawnSync } from 'node:child_process';

const audit = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' });
if (audit.error) throw audit.error;

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  process.stderr.write(audit.stderr || audit.stdout || 'npm audit returned no JSON\n');
  process.exit(1);
}

if (report.error || !report.metadata?.vulnerabilities || !report.vulnerabilities) {
  process.stderr.write(JSON.stringify(report.error ?? report, null, 2) + '\n');
  process.exit(1);
}

const allowedAdvisories = new Set([1103747, 1164823]);
const allowedPackages = new Set([
  '@solana/buffer-layout-utils',
  '@solana/spl-token',
  'bigint-buffer',
  'jayson',
  'stream-json'
]);
const vulnerabilities = report.vulnerabilities ?? {};
const packages = Object.keys(vulnerabilities);
const advisoryIds = new Set();

for (const value of Object.values(vulnerabilities)) {
  for (const via of value.via ?? []) {
    if (typeof via === 'object' && typeof via.source === 'number') advisoryIds.add(via.source);
  }
}

const unexpectedPackages = packages.filter(name => !allowedPackages.has(name));
const unexpectedAdvisories = [...advisoryIds].filter(id => !allowedAdvisories.has(id));
const critical = report.metadata?.vulnerabilities?.critical ?? 0;
const high = report.metadata?.vulnerabilities?.high ?? 0;
const moderate = report.metadata?.vulnerabilities?.moderate ?? 0;

if (unexpectedPackages.length || unexpectedAdvisories.length || critical > 0 || high > 3 || moderate > 2) {
  process.stderr.write(JSON.stringify({
    unexpectedPackages,
    unexpectedAdvisories,
    counts: { critical, high, moderate }
  }, null, 2) + '\n');
  process.exit(1);
}

process.stdout.write(`Dependency audit baseline held: ${packages.length} findings, ${high} high, ${moderate} moderate, ${critical} critical.\n`);
