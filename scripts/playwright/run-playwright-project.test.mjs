import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  clearExpoWebExportRoots,
  resolveExpoWebExportRoot,
  resolveRuntimePort,
  startStaticWebServerWithRetry,
  startServiceWithRetry,
  waitForChildExit,
  watchRuntimeDeaths,
} from './run-playwright-project.mjs';

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.killed = false;
    this.exitCode = null;
    this.signalCode = null;
  }

  kill(signal) {
    this.killed = true;
    this.signal = signal;
    return true;
  }
}

class FakeServer extends EventEmitter {
  constructor() {
    super();
    this.listening = true;
  }

  close() {
    this.listening = false;
    this.emit('close');
  }
}

test('fails fast when the API child exits before readiness', async () => {
  const child = new FakeChild();
  const stopSignals = [];
  const stopping = { current: false };

  const startup = startServiceWithRetry({
    label: 'API server',
    command: 'node',
    args: ['fake-api'],
    env: {},
    cwd: process.cwd(),
    port: 31_010,
    readyUrl: 'http://127.0.0.1:31_010/health',
    stopping,
    attempts: 1,
    spawnServiceImpl: () => child,
    waitForHttpImpl: () => new Promise(() => {}),
    ensurePortAvailableImpl: async () => {},
    stopServiceImpl: (service, signal) => {
      stopSignals.push(signal);
      service.kill(signal);
    },
  });

  queueMicrotask(() => {
    child.emit('exit', 1, null);
  });

  await assert.rejects(
    Promise.race([
      startup,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('startup did not fail fast')), 1_500);
      }),
    ]),
    /API server exited unexpectedly with code 1 and signal null/,
  );

  assert.deepEqual(stopSignals, ['SIGTERM']);
  assert.equal(child.killed, true);
  assert.equal(stopping.current, false);
});

test('reports mid-run API death with a useful error', async () => {
  const child = new FakeChild();
  const stopping = { current: false };
  const runtimeDeath = watchRuntimeDeaths({
    apiChild: child,
    webRuntime: { server: new FakeServer() },
    stopping,
  });

  queueMicrotask(() => {
    child.exitCode = 1;
    child.emit('exit', 1, null);
  });

  await assert.rejects(
    runtimeDeath,
    /API server exited unexpectedly with code 1 and signal null while Playwright was running/,
  );
});

test('reports unexpected static web server shutdown during a run', async () => {
  const stopping = { current: false };
  const webServer = new FakeServer();
  const runtimeDeath = watchRuntimeDeaths({
    apiChild: new FakeChild(),
    webRuntime: { server: webServer },
    stopping,
  });

  queueMicrotask(() => {
    webServer.close();
  });

  await assert.rejects(
    runtimeDeath,
    /Static web server closed unexpectedly while Playwright was running/,
  );
});

test('waitForChildExit escalates to SIGKILL for a hung child process', async () => {
  const child = new FakeChild();
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    child.killed = true;
    if (signal === 'SIGKILL') {
      child.signalCode = 'SIGKILL';
      queueMicrotask(() => {
        child.emit('exit', null, 'SIGKILL');
      });
    }
    return true;
  };

  await waitForChildExit(child, 'hung child', 5);

  assert.deepEqual(signals, ['SIGKILL']);
});

test('resolveRuntimePort falls back to an ephemeral port when the default is busy', async () => {
  const occupied = createServer();
  await new Promise((resolve) => {
    occupied.listen(0, '127.0.0.1', resolve);
  });

  const address = occupied.address();
  assert.ok(address && typeof address === 'object');
  const busyPort = address.port;

  const resolvedPort = await resolveRuntimePort(busyPort);

  assert.notEqual(resolvedPort, busyPort);

  await new Promise((resolve, reject) => {
    occupied.close((error) => (error ? reject(error) : resolve()));
  });
});

test('resolveRuntimePort honors explicitly requested busy ports', async () => {
  const occupied = createServer();
  await new Promise((resolve) => {
    occupied.listen(0, '127.0.0.1', resolve);
  });

  const address = occupied.address();
  assert.ok(address && typeof address === 'object');
  const busyPort = address.port;

  await assert.rejects(
    resolveRuntimePort(busyPort, { strict: true }),
    (error) => error?.code === 'EADDRINUSE',
  );

  await new Promise((resolve, reject) => {
    occupied.close((error) => (error ? reject(error) : resolve()));
  });
});

test('startStaticWebServerWithRetry retries on EADDRINUSE with a fresh port', async () => {
  const selectedPorts = [];
  const stoppedPorts = [];
  const busyError = Object.assign(
    new Error('listen EADDRINUSE: address already in use 127.0.0.1:8082'),
    { code: 'EADDRINUSE' },
  );

  const firstReady = Promise.reject(busyError);
  firstReady.catch(() => {});

  const startStaticWebServerImpl = ({ port }) => {
    selectedPorts.push(port);

    if (selectedPorts.length === 1) {
      return {
        ready: firstReady,
        stop: async () => {
          stoppedPorts.push(port);
        },
      };
    }

    return {
      ready: Promise.resolve(),
      stop: async () => {
        stoppedPorts.push(port);
      },
    };
  };

  const resolveRuntimePortImpl = async (port) => {
    if (selectedPorts.length === 0) {
      return port;
    }

    return 41_001;
  };

  const runtime = await startStaticWebServerWithRetry({
    port: 8082,
    rootDir: '/tmp/does-not-matter',
    logger: { log() {}, error() {} },
    attempts: 2,
    resolveRuntimePortImpl,
    startStaticWebServerImpl,
  });

  assert.equal(runtime.port, 41_001);
  assert.deepEqual(selectedPorts, [8082, 41_001]);
  assert.deepEqual(stoppedPorts, [8082]);

  await runtime.runtime.stop();
});

test('resolveExpoWebExportRoot prefers the dist root that actually contains the fresh export', async () => {
  const repoRootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'huishype-playwright-root-'));
  const appDir = path.join(repoRootDir, 'apps', 'app');
  const appDistDir = path.join(appDir, 'dist');
  const workspaceDistDir = path.join(repoRootDir, 'dist');
  const staleEntrypoint = path.join(appDistDir, 'index.html');
  const freshEntrypoint = path.join(workspaceDistDir, 'index.html');

  await fs.mkdir(appDistDir, { recursive: true });
  await fs.mkdir(workspaceDistDir, { recursive: true });
  await fs.writeFile(staleEntrypoint, 'stale app export');
  await fs.writeFile(freshEntrypoint, 'fresh workspace export');

  const staleTime = new Date('2026-04-12T08:00:00.000Z');
  const freshTime = new Date('2026-04-12T08:00:10.000Z');
  await fs.utimes(staleEntrypoint, staleTime, staleTime);
  await fs.utimes(freshEntrypoint, freshTime, freshTime);

  try {
    const resolved = await resolveExpoWebExportRoot({
      repoRootDir,
      appDir,
      timeoutMs: 50,
    });

    assert.equal(resolved.rootDir, workspaceDistDir);

    clearExpoWebExportRoots({ repoRootDir, appDir });
    await assert.rejects(
      resolveExpoWebExportRoot({
        repoRootDir,
        appDir,
        timeoutMs: 10,
      }),
      /Exported web entrypoint did not appear in any expected dist root/,
    );
  } finally {
    await fs.rm(repoRootDir, { recursive: true, force: true });
  }
});
