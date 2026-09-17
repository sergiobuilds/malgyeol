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

const vulnerabilities = report.vulnerabilities ?? {};
const packages = Object.keys(vulnerabilities);
const critical = report.metadata?.vulnerabilities?.critical ?? 0;
const high = report.metadata?.vulnerabilities?.high ?? 0;
const moderate = report.metadata?.vulnerabilities?.moderate ?? 0;
const low = report.metadata?.vulnerabilities?.low ?? 0;

if (packages.length || critical || high || moderate || low) {
  process.stderr.write(JSON.stringify({ packages, counts: { critical, high, moderate, low } }, null, 2) + '\n');
  process.exit(1);
}

process.stdout.write('Dependency audit passed with zero known vulnerabilities.\n');
