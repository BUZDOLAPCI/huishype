#!/usr/bin/env node

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const flowPathArg = process.argv[2] ?? 'apps/app/e2e/mobile/full-flow.yaml';
const PREFLIGHT_FLOW_PATH = 'apps/app/e2e/mobile/preflight.yaml';
const LOCK_PATH = '/tmp/huishype-mobile-e2e.lock';
const LOCK_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_MAESTRO_ATTEMPTS = 5;
const EXPO_SERVICE_NAME = 'huishype-expo.service';
const API_SERVICE_NAME = 'huishype-api.service';
const EXPO_DEV_CLIENT_URL =
  'exp+huishype://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081';
const METRO_STATUS_URL = 'http://127.0.0.1:8081/status';
const METRO_ANDROID_BUNDLE_URL = 'http://127.0.0.1:8081/index.bundle?platform=android&dev=true&minify=false';
const MARTIN_HEALTH_URL = 'http://127.0.0.1:3111/tiles/health';
const API_READY_URL = 'http://127.0.0.1:3100/health/ready';
const METRO_STATUS_TIMEOUT_MS = 45_000;
const METRO_BUNDLE_WARMUP_TIMEOUT_MS = 180_000;
const MARTIN_READY_TIMEOUT_MS = 120_000;
const API_READY_TIMEOUT_MS = 120_000;
const HTTP_REQUEST_TIMEOUT_MS = 30_000;
const POST_LAUNCH_SETTLE_MS = 5_000;
const MAESTRO_MAX_BUFFER_BYTES = 50 * 1024 * 1024;
const REVERSE_RULES = [
  ['tcp:8081', 'tcp:8081'],
  ['tcp:3100', 'tcp:3100'],
];
const TRANSIENT_MAESTRO_PATTERNS = [
  'UNAVAILABLE: Network closed for unknown reason',
  'Connection refused: localhost/127.0.0.1:7001',
  'UNAVAILABLE: io exception',
  'Not able to reach the gRPC server while doing android device call',
  'java.util.concurrent.TimeoutException',
  'dadb.forwarding.TcpForwarder.waitFor',
];

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
}

function runCapture(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: REPO_ROOT,
    shell: false,
    encoding: 'utf8',
    ...options,
  });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLockOwner() {
  try {
    const [pidLine] = fs.readFileSync(LOCK_PATH, 'utf8').split('\n');
    const pid = Number.parseInt(pidLine, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function acquireLock() {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(LOCK_PATH, 'wx');
      fs.writeFileSync(fd, `${process.pid}\n${flowPathArg}\n`);
      return fd;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      const ownerPid = readLockOwner();
      if (!processExists(ownerPid)) {
        try {
          fs.unlinkSync(LOCK_PATH);
          continue;
        } catch {
          // Another process may have already replaced the lock.
        }
      }

      sleep(1000);
    }
  }

  throw new Error(`Timed out waiting for mobile E2E lock at ${LOCK_PATH}`);
}

function releaseLock(lockFd) {
  try {
    fs.closeSync(lockFd);
  } catch {}

  try {
    fs.unlinkSync(LOCK_PATH);
  } catch {}
}

function updateExitCode(result) {
  if (result.error) {
    console.error(result.error.message);
    process.exitCode = 1;
    return false;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exitCode = result.status;
    return false;
  }

  return true;
}

function requireCommandSuccess(result, errorMessage) {
  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(output ? `${errorMessage}\n${output}` : errorMessage);
  }
}

async function fetchTextWithTimeout(url, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  }

  return text;
}

async function waitForHttpReady(url, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = `${label} did not respond`;

  while (Date.now() < deadline) {
    try {
      await fetchTextWithTimeout(url, HTTP_REQUEST_TIMEOUT_MS);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    sleep(1000);
  }

  throw new Error(`${label} never became ready at ${url}. Last error: ${lastError}`);
}

async function waitForMetroStatus(timeoutMs = METRO_STATUS_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'Metro status endpoint did not respond';

  while (Date.now() < deadline) {
    try {
      const statusText = await fetchTextWithTimeout(METRO_STATUS_URL, HTTP_REQUEST_TIMEOUT_MS);
      if (statusText.includes('packager-status:running')) {
        return;
      }

      lastError = `Unexpected Metro status payload: ${statusText.trim()}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    sleep(1000);
  }

  throw new Error(`Metro status endpoint never became ready. Last error: ${lastError}`);
}

async function warmMetroAndroidBundle(timeoutMs = METRO_BUNDLE_WARMUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'Android bundle warmup did not start';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(METRO_ANDROID_BUNDLE_URL, {
        signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await response.arrayBuffer();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    sleep(2000);
  }

  throw new Error(`Metro Android bundle warmup timed out. Last error: ${lastError}`);
}

function ensureAdbReverse(rule) {
  requireCommandSuccess(
    runCapture('adb', ['reverse', ...rule]),
    `Failed to register adb reverse ${rule.join(' -> ')}`,
  );

  const reverseList = runCapture('adb', ['reverse', '--list']);
  requireCommandSuccess(reverseList, 'Failed to inspect adb reverse rules');

  const output = `${reverseList.stdout ?? ''}\n${reverseList.stderr ?? ''}`;
  if (!output.includes(`${rule[0]} ${rule[1]}`)) {
    throw new Error(`adb reverse rule ${rule.join(' -> ')} was not active`);
  }
}

function restartExpoService(reason) {
  console.warn(`Restarting ${EXPO_SERVICE_NAME}: ${reason}`);
  requireCommandSuccess(
    runCapture('systemctl', ['--user', 'restart', EXPO_SERVICE_NAME]),
    `Failed to restart ${EXPO_SERVICE_NAME}`,
  );
}

function restartApiService(reason) {
  console.warn(`Restarting ${API_SERVICE_NAME}: ${reason}`);
  requireCommandSuccess(
    runCapture('systemctl', ['--user', 'restart', API_SERVICE_NAME]),
    `Failed to restart ${API_SERVICE_NAME}`,
  );
}

function ensureMartinContainerRunning() {
  requireCommandSuccess(
    runCapture('docker', ['compose', '--profile', 'martin', 'up', '-d', 'martin']),
    'Failed to start local Martin container for mobile E2E',
  );
}

function rebuildMapProjections() {
  requireCommandSuccess(
    run('pnpm', ['--filter', '@huishype/api', 'db:rebuild-map-projections']),
    'Failed to rebuild map projections before mobile E2E',
  );
}

async function prepareMartinAndApiForAndroidLaunch({ allowApiRestart } = { allowApiRestart: true }) {
  ensureMartinContainerRunning();
  await waitForHttpReady(MARTIN_HEALTH_URL, 'Martin', MARTIN_READY_TIMEOUT_MS);
  rebuildMapProjections();

  try {
    await waitForHttpReady(API_READY_URL, 'API readiness', API_READY_TIMEOUT_MS);
  } catch (error) {
    if (!allowApiRestart) {
      throw error;
    }

    restartApiService(error instanceof Error ? error.message : String(error));
    await waitForHttpReady(API_READY_URL, 'API readiness', API_READY_TIMEOUT_MS);
  }
}

async function prepareMetroForAndroidLaunch({ allowRestart } = { allowRestart: true }) {
  try {
    await waitForMetroStatus();
    await warmMetroAndroidBundle();
  } catch (error) {
    if (!allowRestart) {
      throw error;
    }

    restartExpoService(error instanceof Error ? error.message : String(error));
    await waitForMetroStatus(METRO_BUNDLE_WARMUP_TIMEOUT_MS);
    await warmMetroAndroidBundle(METRO_BUNDLE_WARMUP_TIMEOUT_MS);
  }
}

function isKeyboardVisible() {
  const result = runCapture('adb', ['shell', 'dumpsys', 'input_method']);
  if (result.error || (typeof result.status === 'number' && result.status !== 0)) {
    return false;
  }

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  return output.includes('mInputShown=true') || output.includes('isInputShown=true');
}

function dismissKeyboardIfVisible() {
  if (!isKeyboardVisible()) {
    return true;
  }

  const dismissResult = run('adb', ['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
  if (!updateExitCode(dismissResult)) {
    return false;
  }

  return true;
}

function launchExpoDevClient() {
  requireCommandSuccess(
    runCapture('adb', [
      'shell',
      'am',
      'start',
      '-W',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      EXPO_DEV_CLIENT_URL,
      'nl.huishype.app',
    ]),
    'Failed to launch Expo dev client deep link',
  );
}

function createFlowForAttempt(flowPath) {
  if (flowPath === PREFLIGHT_FLOW_PATH) {
    return path.resolve(REPO_ROOT, flowPath);
  }

  const composedFlowPath = `/tmp/huishype-maestro-composed-${process.pid}.yaml`;
  fs.writeFileSync(
    composedFlowPath,
    `appId: nl.huishype.app\n---\n# Preflight owns Expo dev-client first-launch normalization before the real flow.\n- runFlow: ${path.resolve(REPO_ROOT, PREFLIGHT_FLOW_PATH)}\n- runFlow: ${path.resolve(REPO_ROOT, flowPath)}\n`,
    'utf8',
  );
  return composedFlowPath;
}

async function bootstrapApp({ allowMetroRestart = true, allowApiRestart = true } = {}) {
  try {
    requireCommandSuccess(
      runCapture('adb', ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']),
      'Failed to wake Android device',
    );

    for (const rule of REVERSE_RULES) {
      ensureAdbReverse(rule);
    }

    await prepareMartinAndApiForAndroidLaunch({ allowApiRestart });
    await prepareMetroForAndroidLaunch({ allowRestart: allowMetroRestart });

    requireCommandSuccess(
      runCapture('adb', ['shell', 'am', 'force-stop', 'nl.huishype.app']),
      'Failed to stop app',
    );
    requireCommandSuccess(
      runCapture('adb', ['shell', 'pm', 'clear', 'nl.huishype.app']),
      'Failed to clear app data',
    );

    launchExpoDevClient();
    sleep(POST_LAUNCH_SETTLE_MS);
    return dismissKeyboardIfVisible();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return false;
  }
}

function runMaestroFlow(flowPath, label, attempt, totalAttempts) {
  console.log(`${label} attempt ${attempt}/${totalAttempts}`);
  const logPath = `/tmp/huishype-maestro-${process.pid}-${attempt}-${Date.now()}.log`;
  const command = `set -o pipefail; maestro test ${shellQuote(flowPath)} 2>&1 | tee ${shellQuote(logPath)}`;

  const result = spawnSync('bash', ['-lc', command], {
    cwd: REPO_ROOT,
    shell: false,
    stdio: 'inherit',
    encoding: 'utf8',
    maxBuffer: MAESTRO_MAX_BUFFER_BYTES,
  });
  const combinedOutput = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  const hasFailed =
    !!result.error ||
    (typeof result.status === 'number' ? result.status !== 0 : true) ||
    !!result.signal;
  const isTransientFailure =
    hasFailed &&
    TRANSIENT_MAESTRO_PATTERNS.some((pattern) => combinedOutput.includes(pattern));

  return { result, isTransientFailure };
}

async function main() {
  let lockFd;
  const flowToRun = createFlowForAttempt(flowPathArg);

  try {
    lockFd = acquireLock();

    for (let attempt = 1; attempt <= MAX_MAESTRO_ATTEMPTS; attempt += 1) {
      if (!(await bootstrapApp({ allowMetroRestart: attempt === 1, allowApiRestart: attempt === 1 }))) {
        return;
      }

      const { result, isTransientFailure } = runMaestroFlow(
        flowToRun,
        'Maestro flow',
        attempt,
        MAX_MAESTRO_ATTEMPTS,
      );

      if (result.error) {
        console.error(result.error.message);
        process.exitCode = 1;
        break;
      }

      if (result.status === 0 && !result.signal) {
        process.exitCode = 0;
        break;
      }

      process.exitCode = result.status ?? 1;

      if (!isTransientFailure || attempt === MAX_MAESTRO_ATTEMPTS) {
        break;
      }

      console.warn('Retrying mobile flow after transient Maestro transport failure');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (lockFd !== undefined) {
      releaseLock(lockFd);
    }
  }

  const finalize = run('node', ['./scripts/visual-overhaul/finalize-mobile-artifacts.mjs']);
  if (finalize.error) {
    console.error(finalize.error.message);
    process.exitCode = 1;
  } else if (typeof finalize.status === 'number' && finalize.status !== 0 && process.exitCode === 0) {
    process.exitCode = finalize.status;
  }
}

await main();
