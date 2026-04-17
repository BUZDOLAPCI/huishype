import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  applyPlaywrightRuntimeEnvironment,
  createPlaywrightRuntimeSettings,
  getPlaywrightWebDistCandidates,
  resolveLatestWebDistDir,
} from './runtime-config.mjs';

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
    const siblingDistDir = path.join(rootDir, 'other', 'dist');

    await writeEntrypoint(appDistDir, '<html><body>stale</body></html>');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const startedAtMs = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeEntrypoint(siblingDistDir, '<html><body>fresh</body></html>');

    const resolvedDir = resolveLatestWebDistDir({
      startedAtMs,
      candidates: [appDistDir, siblingDistDir],
    });

    assert.equal(resolvedDir, siblingDistDir);
  });
});

test('getPlaywrightWebDistCandidates only points at the app dist directory', async () => {
  await withTempDirs(async (rootDir) => {
    const candidates = getPlaywrightWebDistCandidates(rootDir);

    assert.deepEqual(candidates, [path.join(rootDir, 'apps', 'app', 'dist')]);
  });
});

test('createPlaywrightRuntimeSettings derives urls from the selected ports', () => {
  const settings = createPlaywrightRuntimeSettings({
    PLAYWRIGHT_API_PORT: '4123',
    PLAYWRIGHT_WEB_PORT: '9123',
    API_URL: 'http://example.com:9999',
    EXPO_PUBLIC_API_URL: 'http://example.org:1111',
    PLAYWRIGHT_WEB_URL: 'http://example.net:2222',
  });

  assert.equal(settings.apiPort, 4123);
  assert.equal(settings.webPort, 9123);
  assert.equal(settings.apiUrl, 'http://127.0.0.1:4123');
  assert.equal(settings.webUrl, 'http://127.0.0.1:9123');
  assert.equal(settings.webOrigin, 'http://127.0.0.1:9123');
});

test('applyPlaywrightRuntimeEnvironment rewrites inherited url env to match runtime ports', () => {
  const env = {
    PLAYWRIGHT_API_PORT: '4123',
    PLAYWRIGHT_WEB_PORT: '9123',
    API_URL: 'http://example.com:9999',
    EXPO_PUBLIC_API_URL: 'http://example.org:1111',
    PLAYWRIGHT_WEB_URL: 'http://example.net:2222',
  };

  const settings = applyPlaywrightRuntimeEnvironment(env);

  assert.equal(settings.apiUrl, 'http://127.0.0.1:4123');
  assert.equal(env.API_URL, 'http://127.0.0.1:4123');
  assert.equal(env.EXPO_PUBLIC_API_URL, 'http://127.0.0.1:4123');
  assert.equal(env.PLAYWRIGHT_API_PORT, '4123');
  assert.equal(env.PLAYWRIGHT_WEB_PORT, '9123');
  assert.equal(env.PLAYWRIGHT_WEB_URL, 'http://127.0.0.1:9123');
});

test('resolveLatestWebDistDir ignores a repo-root dist bundle when the app dist is missing', async () => {
  await withTempDirs(async (rootDir) => {
    const repoDistDir = path.join(rootDir, 'dist');

    await writeEntrypoint(repoDistDir, '<html><body>unrelated</body></html>');

    assert.throws(
      () => resolveLatestWebDistDir({ candidates: getPlaywrightWebDistCandidates(rootDir) }),
      /Unable to find an exported web bundle/,
    );
  });
});
