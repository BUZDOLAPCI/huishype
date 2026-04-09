#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { startStaticWebServer } from './static-web-server.mjs';

const DEFAULT_API_PORT = 3101;
const DEFAULT_WEB_PORT = 8082;
const READY_TIMEOUT_MS = 120_000;
const EXPO_WEB_NODE_HEAP_MB = 8192;

const repoRoot = process.cwd();
const apiCwd = path.join(repoRoot, 'services', 'api');
const appCwd = path.join(repoRoot, 'apps', 'app');
const expoBin = './node_modules/.bin/expo';
const playwrightBin = './node_modules/.bin/playwright';
const require = createRequire(path.join(apiCwd, 'package.json'));

function resolveTsxRuntimePaths() {
  let tsxEntryPoint;

  try {
    tsxEntryPoint = require.resolve('tsx');
  } catch {
    throw new Error(
      'Unable to resolve tsx from the current workspace. Run pnpm install before Playwright.',
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

const apiPort = Number.parseInt(process.env.PLAYWRIGHT_API_PORT || String(DEFAULT_API_PORT), 10);
const webPort = Number.parseInt(process.env.PLAYWRIGHT_WEB_PORT || String(DEFAULT_WEB_PORT), 10);
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const runtimeNodeEnv = process.env.NODE_ENV || 'development';
const webExportNodeEnv = 'production';
const playwrightArgs = process.argv.slice(2);
let cleanupOnFatal = async () => {};

function assertPositivePort(value, name) {
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`${name} must be a valid TCP port, received "${value}"`);
  }
}

function getListeningPids(port) {
  try {
    const output = execFileSync(
      'lsof',
      [`-tiTCP:${port}`, '-sTCP:LISTEN'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();

    if (!output) {
      return [];
    }

    return [...new Set(
      output
        .split(/\s+/)
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid),
    )];
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
    'Stop the existing process or choose a different port.',
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

async function waitForFile(filePath, label, timeoutMs = READY_TIMEOUT_MS) {
  const startedAt = Date.now();

  while (true) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return;
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`${label} did not appear at ${filePath} within ${timeoutMs}ms`);
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function spawnService(command, args, env, cwd = repoRoot, stdio = ['ignore', 'inherit', 'inherit']) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio,
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
  spawnServiceImpl = spawnService,
  waitForHttpImpl = waitForHttp,
  waitForExitImpl = waitForExit,
  ensurePortAvailableImpl = ensurePortAvailable,
  stopServiceImpl = stopService,
}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await ensurePortAvailableImpl(port, label);

    const child = spawnServiceImpl(command, args, env, cwd);
    const exitPromise = waitForExitImpl(child, label, stopping);

    try {
      await Promise.race([waitForHttpImpl(readyUrl, label), exitPromise]);
      return { child, exitPromise };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      stopServiceImpl(child, 'SIGTERM');
      await Promise.race([
        exitPromise.catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);

      if (stopping.current || attempt === attempts) {
        break;
      }

      console.warn(
        `${label} failed to start on attempt ${attempt}/${attempts}: ${lastError.message}. Retrying...`,
      );
    }
  }

  throw lastError ?? new Error(`${label} failed to start`);
}

async function waitForChildExit(child, name, timeoutMs = 5_000) {
  if (!child) {
    return;
  }

  await Promise.race([
    new Promise((resolve) => {
      child.once('exit', resolve);
    }),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);

  if (child.exitCode === null && !child.killed) {
    stopService(child, 'SIGKILL');
  }
}

async function main() {
  assertPositivePort(apiPort, 'PLAYWRIGHT_API_PORT');
  assertPositivePort(webPort, 'PLAYWRIGHT_WEB_PORT');

  const childEnv = {
    ...process.env,
    EXPO_NO_INTERACTIVE: '1',
    NODE_ENV: runtimeNodeEnv,
    API_URL: apiUrl,
    EXPO_PUBLIC_API_URL: apiUrl,
    PLAYWRIGHT_API_PORT: String(apiPort),
    PLAYWRIGHT_WEB_PORT: String(webPort),
    PLAYWRIGHT_WEB_URL: webUrl,
    PLAYWRIGHT_DISABLE_WEBSERVER: '1',
  };

  let apiChild = null;
  let webRuntime = null;
  let playwrightChild = null;
  const stopping = { current: false };

  const stop = async (signal) => {
    if (stopping.current) {
      return;
    }

    stopping.current = true;
    stopService(playwrightChild, signal);
    stopService(apiChild, signal);
    await Promise.all([
      waitForChildExit(playwrightChild, 'Playwright'),
      waitForChildExit(apiChild, 'API server'),
      webRuntime?.stop?.() ?? Promise.resolve(),
    ]);
  };

  const onSignal = (signal) => {
    void stop(signal).finally(() => {
      process.exit(0);
    });
  };

  cleanupOnFatal = async () => {
    await stop('SIGTERM');
  };

  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  await ensurePortAvailable(webPort, 'Static web server');

  console.log(`Starting API server on ${apiUrl} ...`);
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
    spawnServiceImpl: (command, args, env, cwd) =>
      spawnService(command, args, env, cwd, ['ignore', 'ignore', 'ignore']),
  });
  apiChild = apiRuntime.child;

  console.log('Building Expo web bundle for Playwright runtime ...');
  execFileSync(
    expoBin,
    ['export', '--platform', 'web'],
    {
      cwd: appCwd,
      env: withNodeOption({
        ...childEnv,
        NODE_ENV: webExportNodeEnv,
      }, `--max-old-space-size=${EXPO_WEB_NODE_HEAP_MB}`),
      stdio: 'inherit',
    },
  );
  await waitForFile(path.join(appCwd, 'dist', 'index.html'), 'Exported web entrypoint');

  console.log(`Starting static web server on ${webUrl} ...`);
  webRuntime = startStaticWebServer({
    port: webPort,
    rootDir: path.join(appCwd, 'dist'),
    logger: {
      log: () => {},
      error: console.error,
    },
  });
  await webRuntime.ready;
  await waitForHttp(webUrl, 'Static web server');

  console.log(`Runtime ready: ${apiUrl} and ${webUrl}`);
  playwrightChild = spawnService(
    playwrightBin,
    ['test', ...playwrightArgs],
    childEnv,
    repoRoot,
  );

  const exitCode = await new Promise((resolve, reject) => {
    playwrightChild.once('exit', (code, signal) => {
      if (signal) {
        if (stopping.current) {
          resolve(0);
          return;
        }
        reject(new Error(`Playwright exited due to signal ${signal}`));
        return;
      }

      resolve(code ?? 1);
    });
    playwrightChild.once('error', reject);
  });

  await stop('SIGTERM');
  process.exit(Number(exitCode));
}

export { startServiceWithRetry, waitForExit, waitForHttp };

const isMainModule = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    Promise.resolve(cleanupOnFatal())
      .catch(() => {})
      .finally(() => {
        process.exit(1);
      });
  });
}
