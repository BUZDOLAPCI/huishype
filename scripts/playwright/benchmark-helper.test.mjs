import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const require = createRequire(path.join(repoRoot, 'services', 'api', 'package.json'));

function resolveTsxLoaderPath() {
  const tsxEntryPoint = require.resolve('tsx');
  return path.join(path.dirname(tsxEntryPoint), 'loader.mjs');
}

test('benchmark helper node tests are part of the Playwright harness gate', async () => {
  const {
    NODE_TEST_CONTEXT: _nodeTestContext,
    NODE_TEST_WORKER_ID: _nodeTestWorkerId,
    ...childEnv
  } = process.env;

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ['--import', resolveTsxLoaderPath(), '--test', 'apps/app/e2e/helpers/benchmark.test.mts'],
    {
      cwd: repoRoot,
      env: {
        ...childEnv,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
      timeout: 30_000,
    }
  );

  const output = `${stdout}\n${stderr}`;
  const testsSummary = output.match(/(?:^|\n)[#ℹ]\s*tests\s+(\d+)/);
  const tapPlan = output.match(/(?:^|\n)1\.\.(\d+)(?:\n|$)/);
  const testCount = Number(testsSummary?.[1] ?? tapPlan?.[1] ?? 0);
  assert.ok(testCount > 0, `Expected benchmark helper tests to run.\n${output}`);
});
