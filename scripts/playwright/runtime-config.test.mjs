import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  applyPlaywrightRuntimeEnvironment,
  assertPlaywrightPropertyTilePyramidFixtureTargetIsSafe,
  createPlaywrightRuntimeSettings,
  DEFAULT_LOCAL_DATABASE_URL,
  getPlaywrightWebDistCandidates,
  PLAYWRIGHT_PROPERTY_TILE_PYRAMID_FIXTURE_ALLOW_ENV,
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
      /Unable to find an exported web bundle/
    );
  });
});

test('Playwright pyramid fixture target guard allows the default local DB with explicit wrapper opt-in', () => {
  const target = assertPlaywrightPropertyTilePyramidFixtureTargetIsSafe({
    NODE_ENV: 'development',
    DATABASE_URL: DEFAULT_LOCAL_DATABASE_URL,
    [PLAYWRIGHT_PROPERTY_TILE_PYRAMID_FIXTURE_ALLOW_ENV]: '1',
  });

  assert.equal(target.host, 'localhost');
  assert.equal(target.port, '5440');
  assert.equal(target.databaseName, 'huishype');
});

test('Playwright pyramid fixture target guard requires explicit opt-in', () => {
  assert.throws(
    () =>
      assertPlaywrightPropertyTilePyramidFixtureTargetIsSafe({
        NODE_ENV: 'test',
        DATABASE_URL: DEFAULT_LOCAL_DATABASE_URL,
      }),
    /PLAYWRIGHT_ALLOW_PROPERTY_TILE_PYRAMID_FIXTURE=1/
  );
});

test('Playwright pyramid fixture target guard rejects production mode', () => {
  assert.throws(
    () =>
      assertPlaywrightPropertyTilePyramidFixtureTargetIsSafe({
        NODE_ENV: 'production',
        DATABASE_URL: DEFAULT_LOCAL_DATABASE_URL,
        [PLAYWRIGHT_PROPERTY_TILE_PYRAMID_FIXTURE_ALLOW_ENV]: '1',
      }),
    /NODE_ENV=production/
  );
});

test('Playwright pyramid fixture target guard rejects remote database hosts', () => {
  assert.throws(
    () =>
      assertPlaywrightPropertyTilePyramidFixtureTargetIsSafe({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://huishype:secret@94.130.105.129:5432/huishype',
        [PLAYWRIGHT_PROPERTY_TILE_PYRAMID_FIXTURE_ALLOW_ENV]: '1',
      }),
    /database host "94\.130\.105\.129" is not local/
  );
});

test('Playwright pyramid fixture target guard rejects production-like database names', () => {
  assert.throws(
    () =>
      assertPlaywrightPropertyTilePyramidFixtureTargetIsSafe({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://huishype:secret@localhost:5440/huishype-production',
        [PLAYWRIGHT_PROPERTY_TILE_PYRAMID_FIXTURE_ALLOW_ENV]: '1',
      }),
    /looks production-like/
  );
});
