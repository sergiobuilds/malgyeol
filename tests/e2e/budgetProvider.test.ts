import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileFoodBudgetProvider } from '../../src/food-support/budgetProvider.ts';

test('food budget provider reads only a mode-600 case-scoped institution record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'food-budget-'));
  const file = join(directory, 'budgets.json');
  await writeFile(file, JSON.stringify({ cases: { web_case_one: { remainingKrw: 50000, maximumPurchaseKrw: 30000 } } }));
  await chmod(file, 0o600);
  const provider = new FileFoodBudgetProvider(file);
  assert.deepEqual(await provider.get('web_case_one'), { remainingKrw: 50000, maximumPurchaseKrw: 30000 });
  assert.equal(await provider.get('web_missing'), undefined);
  await chmod(file, 0o644);
  await assert.rejects(provider.get('web_case_one'), /mode 600/);
});
