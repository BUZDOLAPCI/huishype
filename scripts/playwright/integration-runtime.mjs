#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_PLAYWRIGHT_API_PORT,
  DEFAULT_PLAYWRIGHT_WEB_PORT,
  PLAYWRIGHT_APP_ROOT,
  PLAYWRIGHT_PROPERTY_TILE_PYRAMID_FIXTURE_ALLOW_ENV,
  PLAYWRIGHT_REPO_ROOT,
  applyPlaywrightRuntimeEnvironment,
  assertPlaywrightPropertyTilePyramidFixtureTargetIsSafe,
  resolveLatestWebDistDir,
} from './runtime-config.mjs';
import { startStaticWebServer } from './static-web-server.mjs';

const READY_TIMEOUT_MS = 120_000;
const EXPO_WEB_NODE_HEAP_MB = 8192;
const repoRoot = PLAYWRIGHT_REPO_ROOT;
const apiCwd = path.join(repoRoot, 'services', 'api');
const appCwd = PLAYWRIGHT_APP_ROOT;
const expoBin = './node_modules/.bin/expo';
const require = createRequire(path.join(apiCwd, 'package.json'));

function resolveTsxRuntimePaths() {
  let tsxEntryPoint;

  try {
    tsxEntryPoint = require.resolve('tsx');
  } catch {
    throw new Error(
      'Unable to resolve tsx from the current workspace. Run pnpm install before Playwright.'
    );
  }

  const tsxDistDir = path.dirname(tsxEntryPoint);
  const tsxPreflight = path.join(tsxDistDir, 'preflight.cjs');
  const tsxLoaderPath = path.join(tsxDistDir, 'loader.mjs');

  if (!fs.existsSync(tsxPreflight) || !fs.existsSync(tsxLoaderPath)) {
    throw new Error(`Unable to locate tsx dist files from ${tsxEntryPoint}`);
  }

  return {
    tsxPreflight,
    tsxLoader: pathToFileURL(tsxLoaderPath).href,
  };
}

const { tsxPreflight, tsxLoader } = resolveTsxRuntimePaths();

const apiPort = Number.parseInt(
  process.env.PLAYWRIGHT_API_PORT || String(DEFAULT_PLAYWRIGHT_API_PORT),
  10
);
const webPort = Number.parseInt(
  process.env.PLAYWRIGHT_WEB_PORT || String(DEFAULT_PLAYWRIGHT_WEB_PORT),
  10
);
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const runtimeNodeEnv = process.env.NODE_ENV || 'development';
const webExportNodeEnv = 'production';
let cleanupOnFatal = async () => {};

function assertPositivePort(value, name) {
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`${name} must be a valid TCP port, received "${value}"`);
  }
}

function getListeningPids(port) {
  try {
    const output = execFileSync('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    if (!output) {
      return [];
    }

    return [
      ...new Set(
        output
          .split(/\s+/)
          .map((value) => Number.parseInt(value, 10))
          .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid)
      ),
    ];
  } catch {
    return [];
  }
}

async function ensurePortAvailable(port, label) {
  const pids = getListeningPids(port);
  if (pids.length === 0) {
    return;
  }

  throw new Error(
    `${label} port ${port} is already in use by PID(s) ${pids.join(', ')}. ` +
      'Stop the existing process or choose a different port.'
  );
}

async function waitForHttp(url, label) {
  const startedAt = Date.now();

  while (true) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep waiting until the service responds.
    }

    if (Date.now() - startedAt > READY_TIMEOUT_MS) {
      throw new Error(`${label} did not become ready at ${url} within ${READY_TIMEOUT_MS}ms`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

function spawnService(command, args, env, cwd = repoRoot) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: false,
  });

  child.on('error', (error) => {
    console.error(`${command} ${args.join(' ')} failed to start:`, error);
    process.exit(1);
  });

  return child;
}

function stopService(child, signal) {
  if (!child || child.killed) {
    return;
  }

  try {
    child.kill(signal);
  } catch {
    // Ignore shutdown races.
  }
}

function withNodeOption(env, option) {
  const current = env.NODE_OPTIONS?.trim();
  if (!current) {
    return { ...env, NODE_OPTIONS: option };
  }
  if (current.includes(option)) {
    return env;
  }
  return { ...env, NODE_OPTIONS: `${current} ${option}` };
}

function waitForExit(child, name, stopping) {
  return new Promise((resolve, reject) => {
    child.once('exit', (code, signal) => {
      if (stopping.current) {
        resolve();
        return;
      }

      reject(new Error(`${name} exited unexpectedly with code ${code} and signal ${signal}`));
    });
  });
}

async function startServiceWithRetry({
  label,
  command,
  args,
  env,
  cwd,
  port,
  readyUrl,
  stopping,
  attempts = 2,
}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await ensurePortAvailable(port, label);

    const child = spawnService(command, args, env, cwd);
    const exitPromise = waitForExit(child, label, stopping);

    try {
      await Promise.race([waitForHttp(readyUrl, label), exitPromise]);
      return { child, exitPromise };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      stopService(child, 'SIGTERM');
      await Promise.race([
        exitPromise.catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);

      if (stopping.current || attempt === attempts) {
        break;
      }

      console.warn(
        `${label} failed to start on attempt ${attempt}/${attempts}: ${lastError.message}. Retrying...`
      );
    }
  }

  throw lastError ?? new Error(`${label} failed to start`);
}

async function main() {
  assertPositivePort(apiPort, 'PLAYWRIGHT_API_PORT');
  assertPositivePort(webPort, 'PLAYWRIGHT_WEB_PORT');
  process.env.PLAYWRIGHT_API_PORT = String(apiPort);
  process.env.PLAYWRIGHT_WEB_PORT = String(webPort);
  process.env.PLAYWRIGHT_WEB_URL = webUrl;
  process.env.API_URL = apiUrl;
  process.env.EXPO_PUBLIC_API_URL = apiUrl;
  applyPlaywrightRuntimeEnvironment(process.env);

  const childEnv = {
    ...process.env,
    EXPO_NO_INTERACTIVE: '1',
    NODE_ENV: runtimeNodeEnv,
    PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: process.env.PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM || '10',
  };
  const fixtureTarget = assertPlaywrightPropertyTilePyramidFixtureTargetIsSafe(childEnv, {
    requireExplicitAllow: false,
  });
  childEnv[PLAYWRIGHT_PROPERTY_TILE_PYRAMID_FIXTURE_ALLOW_ENV] = '1';
  // Detached service children do not keep the supervisor event loop alive by
  // themselves. Hold a lightweight interval open so this process remains the
  // lifetime owner until Playwright signals shutdown.
  const supervisorKeepAlive = setInterval(() => {}, 60_000);

  const stopping = { current: false };
  let apiChild = null;
  let webServerRuntime = null;
  let apiExit = Promise.resolve();

  console.log(
    `Ensuring Playwright property tile pyramid fixture in ${fixtureTarget.databaseName} on ${fixtureTarget.host}:${fixtureTarget.port} ...`
  );
  execFileSync(
    process.execPath,
    [
      '--require',
      tsxPreflight,
      '--import',
      tsxLoader,
      'scripts/ensure-playwright-property-tile-pyramid.ts',
    ],
    {
      cwd: apiCwd,
      env: childEnv,
      stdio: 'inherit',
    }
  );

  console.log(`Waiting for API at ${apiUrl} ...`);
  const apiRuntime = await startServiceWithRetry({
    label: 'API server',
    command: process.execPath,
    args: ['--require', tsxPreflight, '--import', tsxLoader, 'src/index.ts'],
    env: {
      ...childEnv,
      PORT: String(apiPort),
    },
    cwd: apiCwd,
    port: apiPort,
    readyUrl: `${apiUrl}/health`,
    stopping,
  });
  apiChild = apiRuntime.child;
  apiExit = apiRuntime.exitPromise;

  const stop = async (signal) => {
    if (stopping.current) {
      return;
    }

    stopping.current = true;
    stopService(apiChild, signal);
    if (webServerRuntime) {
      await webServerRuntime.stop().catch(() => {});
    }

    await Promise.race([
      Promise.allSettled([apiExit]),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    clearInterval(supervisorKeepAlive);
  };

  cleanupOnFatal = async () => {
    await stop('SIGTERM');
  };

  const onSignal = (signal) => {
    void stop(signal).finally(() => {
      process.exit(0);
    });
  };

  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  if (stopping.current) {
    return;
  }

  console.log('Building Expo web bundle for Playwright runtime ...');
  const exportStartedAtMs = Date.now();
  execFileSync(expoBin, ['export', '--platform', 'web', '--clear'], {
    cwd: appCwd,
    env: withNodeOption(
      {
        ...childEnv,
        NODE_ENV: webExportNodeEnv,
        EXPO_PUBLIC_API_URL: apiUrl,
      },
      `--max-old-space-size=${EXPO_WEB_NODE_HEAP_MB}`
    ),
    stdio: 'inherit',
  });
  const exportedWebRoot = resolveLatestWebDistDir({ startedAtMs: exportStartedAtMs });

  console.log(`Waiting for static web server at ${webUrl} ...`);
  await ensurePortAvailable(webPort, 'Static web server');
  webServerRuntime = startStaticWebServer({
    port: webPort,
    rootDir: exportedWebRoot,
    runtimeConfig: {
      apiUrl,
    },
  });
  await webServerRuntime.ready;
  await waitForHttp(webUrl, 'Static web server');
  if (stopping.current) {
    return;
  }
  console.log(`Integration runtime ready: ${apiUrl} and ${webUrl}`);

  try {
    await apiExit;
  } finally {
    await stop('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error);
  Promise.resolve(cleanupOnFatal())
    .catch(() => {})
    .finally(() => {
      process.exitCode = 1;
    });
});
