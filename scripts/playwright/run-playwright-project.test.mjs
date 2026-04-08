import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startServiceWithRetry } from './run-playwright-project.mjs';

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.killed = false;
  }

  kill(signal) {
    this.killed = true;
    this.signal = signal;
    return true;
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
