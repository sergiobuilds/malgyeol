import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

function collectTests(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTests(path);
    return entry.isFile() && entry.name.endsWith('.test.ts') && extname(path) === '.ts' ? [path] : [];
  });
}

const tests = collectTests('tests').sort();
if (tests.length === 0) {
  process.stderr.write('No TypeScript tests found under tests/.\n');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...tests], {
  stdio: 'inherit',
  env: process.env
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
