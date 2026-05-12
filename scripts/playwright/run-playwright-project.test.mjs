import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import {
  createApiDeathMonitor,
  resolveRuntimePort,
  startApiRestartControlServer,
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

test('ignores API child exit while benchmark restart is in progress', async () => {
  const child = new FakeChild();
  const stopping = { current: false };
  const apiRestarting = { current: true };
  const runtimeDeath = watchRuntimeDeaths({
    apiChild: child,
    webRuntime: { server: new FakeServer() },
    stopping,
    apiRestarting,
  });

  queueMicrotask(() => {
    child.exitCode = null;
    child.signalCode = 'SIGTERM';
    child.emit('exit', null, 'SIGTERM');
  });

  const result = await Promise.race([
    runtimeDeath.then(
      () => 'resolved',
      () => 'rejected',
    ),
    new Promise((resolve) => setTimeout(() => resolve('pending'), 25)),
  ]);

  assert.equal(result, 'pending');
});

test('API death monitor watches replacement API children after benchmark restart', async () => {
  const firstChild = new FakeChild();
  const secondChild = new FakeChild();
  const stopping = { current: false };
  const apiRestarting = { current: false };
  const monitor = createApiDeathMonitor({ stopping, apiRestarting });
  monitor.promise.catch(() => {});

  monitor.watch(firstChild);
  apiRestarting.current = true;
  firstChild.emit('exit', null, 'SIGTERM');
  apiRestarting.current = false;

  monitor.watch(secondChild);
  queueMicrotask(() => {
    secondChild.exitCode = 1;
    secondChild.emit('exit', 1, null);
  });

  await assert.rejects(
    monitor.promise,
    /API server exited unexpectedly with code 1 and signal null while Playwright was running/,
  );
});

test('benchmark API restart control server serializes restart requests', async () => {
  const calls = [];
  const control = await startApiRestartControlServer({
    restartApi: async () => {
      calls.push(Date.now());
    },
  });

  try {
    const response = await fetch(control.url, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls.length, 1);

    const missing = await fetch(control.url, { method: 'GET' });
    assert.equal(missing.status, 404);
  } finally {
    await control.close();
  }
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
