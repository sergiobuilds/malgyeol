import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function environmentKeys(path: string): Set<string> {
  const keys = new Set<string>();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (match) keys.add(match[1]!);
  }
  return keys;
}

function referencedKeys(paths: string[]): Set<string> {
  const keys = new Set<string>();
  const direct = /process\.env\.([A-Z][A-Z0-9_]*)/g;
  const indexed = /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g;
  for (const inputPath of paths) {
    const candidates = /\.[a-z]+$/i.test(inputPath) ? [inputPath] : filesUnder(inputPath);
    for (const path of candidates) {
      if (!/\.(?:ts|mjs)$/.test(path)) continue;
      const source = readFileSync(path, 'utf8');
      for (const pattern of [direct, indexed]) {
        pattern.lastIndex = 0;
        for (const match of source.matchAll(pattern)) keys.add(match[1]!);
      }
    }
  }
  return keys;
}

test('environment example uses names recognized by application code', () => {
  const runtime = referencedKeys(['src/server.ts', 'src/careApp.ts']);
  const runtimeExample = environmentKeys('.env.example');

  assert.deepEqual([...runtimeExample].filter(key => !runtime.has(key)), []);
});

test('application runtime variables are represented in the runtime example', () => {
  const runtime = referencedKeys(['src/server.ts', 'src/careApp.ts']);
  const runtimeExample = environmentKeys('.env.example');
  const platformManaged = new Set(['K_SERVICE']);
  assert.deepEqual([...runtime].filter(key => !runtimeExample.has(key) && !platformManaged.has(key)).sort(), []);
});
