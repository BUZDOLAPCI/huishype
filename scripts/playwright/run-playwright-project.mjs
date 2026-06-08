#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_PLAYWRIGHT_API_PORT,
  DEFAULT_PLAYWRIGHT_WEB_PORT,
  PLAYWRIGHT_APP_ROOT,
  PLAYWRIGHT_REPO_ROOT,
  applyPlaywrightPropertyTilePyramidFixtureEnvironment,
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
const playwrightBin = './node_modules/.bin/playwright';
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

let apiPort = Number.parseInt(
  process.env.PLAYWRIGHT_API_PORT || String(DEFAULT_PLAYWRIGHT_API_PORT),
  10
);
let webPort = Number.parseInt(
  process.env.PLAYWRIGHT_WEB_PORT || String(DEFAULT_PLAYWRIGHT_WEB_PORT),
  10
);
let apiUrl = `http://127.0.0.1:${apiPort}`;
let webUrl = `http://127.0.0.1:${webPort}`;
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

function updateRuntimePorts(nextApiPort, nextWebPort) {
  apiPort = nextApiPort;
  webPort = nextWebPort;
  apiUrl = `http://127.0.0.1:${apiPort}`;
  webUrl = `http://127.0.0.1:${webPort}`;
}

function syncRuntimeEnvironment(env = process.env) {
  env.PLAYWRIGHT_API_PORT = String(apiPort);
  env.PLAYWRIGHT_WEB_PORT = String(webPort);
  env.PLAYWRIGHT_WEB_URL = webUrl;
  env.API_URL = apiUrl;
  env.EXPO_PUBLIC_API_URL = apiUrl;
  applyPlaywrightRuntimeEnvironment(env);
  applyPlaywrightPropertyTilePyramidFixtureEnvironment(env);
}

function isAddressInUseError(error) {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE'
  );
}

function createIsolatedStaticWebRoot(sourceDir) {
  const runtimeRootParent = path.join(repoRoot, 'test-results', 'playwright', 'runtime');
  fs.mkdirSync(runtimeRootParent, { recursive: true });
  const runtimeRoot = fs.mkdtempSync(path.join(runtimeRootParent, 'visual-web-'));
  fs.cpSync(sourceDir, runtimeRoot, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
  return runtimeRoot;
}

async function claimPort(port, host = '127.0.0.1') {
  return await new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.once('error', reject);
    server.listen({ port, host }, () => {
      const address = server.address();
      const selectedPort = typeof address === 'object' && address ? address.port : port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(selectedPort);
      });
    });
  });
}

async function resolveRuntimePort(port, { strict = false, host = '127.0.0.1' } = {}) {
  try {
    return await claimPort(port, host);
  } catch (error) {
    if (strict || !(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE') {
      throw error;
    }

    return await claimPort(0, host);
  }
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
    if (child.exitCode !== null || child.signalCode !== null) {
      if (stopping.current) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${name} exited unexpectedly with code ${child.exitCode} and signal ${child.signalCode}`
        )
      );
      return;
    }

    child.once('exit', (code, signal) => {
      if (stopping.current) {
        resolve();
        return;
      }

      reject(new Error(`${name} exited unexpectedly with code ${code} and signal ${signal}`));
    });
  });
}

function watchRuntimeDeaths({
  apiChild,
  webRuntime,
  stopping,
  apiRestarting = { current: false },
}) {
  return new Promise((resolve, reject) => {
    const fail = (message) => {
      if (stopping.current) {
        resolve();
        return;
      }

      reject(new Error(`${message} while Playwright was running`));
    };

    if (apiChild) {
      if (apiChild.exitCode !== null || apiChild.signalCode !== null) {
        fail(
          `API server exited unexpectedly with code ${apiChild.exitCode} and signal ${apiChild.signalCode}`
        );
        return;
      }

      apiChild.once('exit', (code, signal) => {
        if (apiRestarting.current) {
          return;
        }
        fail(`API server exited unexpectedly with code ${code} and signal ${signal}`);
      });
    }

    const webServer = webRuntime?.server;
    if (webServer) {
      webServer.once('close', () => {
        fail('Static web server closed unexpectedly');
      });

      webServer.once('error', (error) => {
        const message = error instanceof Error ? error.message : String(error);
        fail(`Static web server failed unexpectedly: ${message}`);
      });
    }
  });
}

function createApiDeathMonitor({ stopping, apiRestarting }) {
  let rejectPromise;
  const promise = new Promise((_, reject) => {
    rejectPromise = reject;
  });

  return {
    promise,
    watch(child) {
      if (!child) {
        return;
      }

      if (child.exitCode !== null || child.signalCode !== null) {
        if (!stopping.current && !apiRestarting.current) {
          rejectPromise(
            new Error(
              `API server exited unexpectedly with code ${child.exitCode} and signal ${child.signalCode} while Playwright was running`
            )
          );
        }
        return;
      }

      child.once('exit', (code, signal) => {
        if (stopping.current || apiRestarting.current) {
          return;
        }
        rejectPromise(
          new Error(
            `API server exited unexpectedly with code ${code} and signal ${signal} while Playwright was running`
          )
        );
      });
    },
  };
}

async function startApiRestartControlServer({ restartApi }) {
  const server = createHttpServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/restart-api') {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    Promise.resolve()
      .then(() => restartApi())
      .then(() => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: true }));
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'restart_failed', message }));
      });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address !== 'object') {
    throw new Error('Unable to bind benchmark API restart control server');
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}/restart-api`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
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

function spawnService(
  command,
  args,
  env,
  cwd = repoRoot,
  stdio = ['ignore', 'inherit', 'inherit']
) {
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
  if (!child || child.killed || child.exitCode !== null || child.signalCode !== null) {
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
        `${label} failed to start on attempt ${attempt}/${attempts}: ${lastError.message}. Retrying...`
      );
    }
  }

  throw lastError ?? new Error(`${label} failed to start`);
}

async function waitForChildExit(child, name, timeoutMs = 5_000) {
  if (!child) {
    return;
  }

  if (child.exitCode !== null || child.signalCode !== null) {
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
    await Promise.race([
      new Promise((resolve) => {
        child.once('exit', resolve);
      }),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }
}

async function main() {
  const apiPortRequested = process.env.PLAYWRIGHT_API_PORT != null;
  const webPortRequested = process.env.PLAYWRIGHT_WEB_PORT != null;

  assertPositivePort(apiPort, 'PLAYWRIGHT_API_PORT');
  assertPositivePort(webPort, 'PLAYWRIGHT_WEB_PORT');

  updateRuntimePorts(
    await resolveRuntimePort(apiPort, { strict: apiPortRequested }),
    await resolveRuntimePort(webPort, { strict: webPortRequested })
  );

  syncRuntimeEnvironment(process.env);

  let apiRestartUrl = null;
  const createChildEnv = () => ({
    ...process.env,
    EXPO_NO_INTERACTIVE: '1',
    NODE_ENV: runtimeNodeEnv,
    API_URL: apiUrl,
    EXPO_PUBLIC_API_URL: apiUrl,
    PLAYWRIGHT_API_PORT: String(apiPort),
    PLAYWRIGHT_WEB_PORT: String(webPort),
    PLAYWRIGHT_WEB_URL: webUrl,
    PLAYWRIGHT_DISABLE_WEBSERVER: '1',
    PLAYWRIGHT_REPO_ROOT: repoRoot,
    PLAYWRIGHT_DISABLE_OFFICIAL_VALUATION_HYDRATION_QUEUE: '1',
    ...(apiRestartUrl ? { BENCHMARK_API_RESTART_URL: apiRestartUrl } : {}),
  });

  let childEnv = createChildEnv();
  const fixtureTarget = assertPlaywrightPropertyTilePyramidFixtureTargetIsSafe(childEnv, {
    requireExplicitAllow: false,
  });

  let apiChild = null;
  let apiExitPromise = Promise.resolve();
  let webRuntime = null;
  let staticWebRoot = null;
  let apiRestartControl = null;
  let playwrightChild = null;
  let playwrightExitPromise = Promise.resolve(0);
  const stopping = { current: false };
  const apiRestarting = { current: false };
  const enableApiRestartControl = process.env.BENCHMARK_BACKEND_COLD === '1';
  const apiDeathMonitor = createApiDeathMonitor({ stopping, apiRestarting });
  apiDeathMonitor.promise.catch(() => {});

  const stop = async (signal) => {
    if (stopping.current) {
      return;
    }

    stopping.current = true;
    stopService(playwrightChild, signal);
    stopService(apiChild, signal);
    await Promise.all([
      waitForChildExit(playwrightChild, 'Playwright process').catch(() => {}),
      waitForChildExit(apiChild, 'API server').catch(() => {}),
      Promise.resolve()
        .then(() => webRuntime?.stop?.())
        .catch(() => {}),
      Promise.resolve()
        .then(() => apiRestartControl?.close?.())
        .catch(() => {}),
      Promise.resolve().then(() => {
        if (staticWebRoot) {
          fs.rmSync(staticWebRoot, { recursive: true, force: true });
          staticWebRoot = null;
        }
      }),
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

  const startApiServer = async () => {
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
    apiExitPromise = apiRuntime.exitPromise.catch(() => {});
    apiDeathMonitor.watch(apiChild);
  };

  await startApiServer();

  if (enableApiRestartControl) {
    let restartChain = Promise.resolve();
    apiRestartControl = await startApiRestartControlServer({
      restartApi: async () => {
        restartChain = restartChain.then(async () => {
          apiRestarting.current = true;
          try {
            stopService(apiChild, 'SIGTERM');
            await waitForChildExit(apiChild, 'API server');
            childEnv = createChildEnv();
            await startApiServer();
          } finally {
            apiRestarting.current = false;
          }
        });
        await restartChain;
      },
    });
    apiRestartUrl = apiRestartControl.url;
    childEnv = createChildEnv();
    console.log(`Benchmark API restart control ready at ${apiRestartUrl}`);
  }

  console.log('Building Expo web bundle for Playwright runtime ...');
  const exportStartedAtMs = Date.now();
  execFileSync(expoBin, ['export', '--platform', 'web', '--clear'], {
    cwd: appCwd,
    env: withNodeOption(
      {
        ...childEnv,
        NODE_ENV: webExportNodeEnv,
      },
      `--max-old-space-size=${EXPO_WEB_NODE_HEAP_MB}`
    ),
    stdio: 'inherit',
  });
  const exportedWebRoot = resolveLatestWebDistDir({ startedAtMs: exportStartedAtMs });
  await waitForFile(path.join(exportedWebRoot, 'index.html'), 'Exported web entrypoint');
  staticWebRoot = createIsolatedStaticWebRoot(exportedWebRoot);
  console.log(`Using exported web bundle from ${exportedWebRoot}`);

  const staticWebServerAttempts = webPortRequested ? 1 : 3;
  let lastStaticWebServerError = null;

  for (let attempt = 1; attempt <= staticWebServerAttempts; attempt += 1) {
    updateRuntimePorts(apiPort, await resolveRuntimePort(webPort, { strict: webPortRequested }));
    syncRuntimeEnvironment(process.env);
    childEnv = createChildEnv();

    console.log(`Starting static web server on ${webUrl} ...`);
    const candidateRuntime = startStaticWebServer({
      port: webPort,
      rootDir: staticWebRoot,
      runtimeConfig: {
        apiUrl,
      },
      logger: {
        log: () => {},
        error: console.error,
      },
    });

    try {
      await candidateRuntime.ready;
      await waitForHttp(webUrl, 'Static web server');
      webRuntime = candidateRuntime;
      break;
    } catch (error) {
      lastStaticWebServerError = error instanceof Error ? error : new Error(String(error));
      await Promise.resolve(candidateRuntime.stop?.()).catch(() => {});

      if (
        stopping.current ||
        webPortRequested ||
        attempt === staticWebServerAttempts ||
        !isAddressInUseError(lastStaticWebServerError)
      ) {
        throw lastStaticWebServerError;
      }

      console.warn(
        `Static web server failed to bind on attempt ${attempt}/${staticWebServerAttempts}: ${lastStaticWebServerError.message}. Retrying with a fresh port...`
      );
    }
  }

  if (!webRuntime) {
    throw lastStaticWebServerError ?? new Error('Static web server failed to start');
  }

  console.log(`Runtime ready: ${apiUrl} and ${webUrl}`);
  const runtimeDeathPromise = watchRuntimeDeaths({
    webRuntime,
    stopping,
  });
  playwrightChild = spawnService(playwrightBin, ['test', ...playwrightArgs], childEnv, repoRoot);

  playwrightExitPromise = new Promise((resolve, reject) => {
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

  const exitCode = await Promise.race([
    playwrightExitPromise,
    runtimeDeathPromise,
    apiDeathMonitor.promise,
  ]);

  await stop('SIGTERM');
  process.exit(Number.isInteger(exitCode) ? exitCode : 0);
}

export {
  createApiDeathMonitor,
  resolveRuntimePort,
  startApiRestartControlServer,
  startServiceWithRetry,
  waitForChildExit,
  waitForExit,
  waitForHttp,
  watchRuntimeDeaths,
};

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
