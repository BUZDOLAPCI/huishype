#!/usr/bin/env node

import { spawn } from 'node:child_process';

const DEFAULT_API_PORT = 3101;
const DEFAULT_WEB_PORT = 8082;
const READY_TIMEOUT_MS = 120_000;

const apiPort = Number.parseInt(process.env.PLAYWRIGHT_API_PORT || String(DEFAULT_API_PORT), 10);
const webPort = Number.parseInt(process.env.PLAYWRIGHT_WEB_PORT || String(DEFAULT_WEB_PORT), 10);
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const runtimeNodeEnv = process.env.NODE_ENV || 'development';

function assertPositivePort(value, name) {
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`${name} must be a valid TCP port, received "${value}"`);
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

function spawnService(command, args, env) {
  const child = spawn(command, args, {
    env,
    stdio: 'inherit',
    shell: false,
  });

  child.on('error', (error) => {
    console.error(`${command} ${args.join(' ')} failed to start:`, error);
    process.exit(1);
  });

  return child;
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

async function main() {
  assertPositivePort(apiPort, 'PLAYWRIGHT_API_PORT');
  assertPositivePort(webPort, 'PLAYWRIGHT_WEB_PORT');

  const childEnv = {
    ...process.env,
    NODE_ENV: runtimeNodeEnv,
  };

  const apiChild = spawnService(
    'pnpm',
    ['--filter', '@huishype/api', 'dev'],
    {
      ...childEnv,
      PORT: String(apiPort),
    },
  );

  const stopping = { current: false };
  const apiExit = waitForExit(apiChild, 'API server', stopping);
  let webChild = null;
  let webExit = Promise.resolve();

  const stop = async (signal) => {
    if (stopping.current) {
      return;
    }

    stopping.current = true;
    apiChild.kill(signal);
    if (webChild) {
      webChild.kill(signal);
    }

    await Promise.race([
      Promise.allSettled([apiExit, webExit]),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  };

  const onSignal = (signal) => {
    void stop(signal).finally(() => {
      process.exit(0);
    });
  };

  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  console.log(`Waiting for API at ${apiUrl} ...`);
  await Promise.race([waitForHttp(`${apiUrl}/health`, 'API server'), apiExit]);
  if (stopping.current) {
    return;
  }

  webChild = spawnService(
    'pnpm',
    ['--filter', '@huishype/app', 'exec', 'expo', 'start', '--web', '--port', String(webPort)],
    {
      ...childEnv,
      EXPO_PUBLIC_API_URL: apiUrl,
    },
  );

  webExit = waitForExit(webChild, 'Expo web server', stopping);

  console.log(`Waiting for Expo web at ${webUrl} ...`);
  await Promise.race([waitForHttp(webUrl, 'Expo web server'), apiExit, webExit]);
  if (stopping.current) {
    return;
  }
  console.log(`Integration runtime ready: ${apiUrl} and ${webUrl}`);

  try {
    await Promise.race([apiExit, webExit]);
  } finally {
    await stop('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
