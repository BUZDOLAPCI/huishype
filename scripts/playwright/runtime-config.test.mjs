import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveLatestWebDistDir } from './runtime-config.mjs';

async function withTempDirs(run) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'huishype-playwright-runtime-'));

  try {
    await run(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function writeEntrypoint(dir, body) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'index.html'), body);
}

test('resolveLatestWebDistDir prefers the freshest exported bundle', async () => {
  await withTempDirs(async (rootDir) => {
    const appDistDir = path.join(rootDir, 'apps', 'app', 'dist');
    const repoDistDir = path.join(rootDir, 'dist');

    await writeEntrypoint(appDistDir, '<html><body>stale</body></html>');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const startedAtMs = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeEntrypoint(repoDistDir, '<html><body>fresh</body></html>');

    const resolvedDir = resolveLatestWebDistDir({
      startedAtMs,
      candidates: [appDistDir, repoDistDir],
    });

    assert.equal(resolvedDir, repoDistDir);
  });
});

test('resolveLatestWebDistDir falls back to the newest available bundle when timestamps predate the run', async () => {
  await withTempDirs(async (rootDir) => {
    const appDistDir = path.join(rootDir, 'apps', 'app', 'dist');
    const repoDistDir = path.join(rootDir, 'dist');

    await writeEntrypoint(appDistDir, '<html><body>older</body></html>');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeEntrypoint(repoDistDir, '<html><body>newest</body></html>');

    const resolvedDir = resolveLatestWebDistDir({
      startedAtMs: Date.now() + 60_000,
      candidates: [appDistDir, repoDistDir],
    });

    assert.equal(resolvedDir, repoDistDir);
  });
});
