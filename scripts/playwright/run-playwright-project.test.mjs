import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startServiceWithRetry, watchRuntimeDeaths } from './run-playwright-project.mjs';

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
