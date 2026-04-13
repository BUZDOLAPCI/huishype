#!/usr/bin/env node

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const DEFAULT_FLOW_PATH = 'apps/app/e2e/mobile/full-flow.yaml';
const CANONICAL_DEEPLINK_FLOW_PATH = 'apps/app/e2e/mobile/canonical-deeplink-smoke.yaml';
const CANONICAL_DEEPLINK_PREFLIGHT_FLOW_PATH =
  'apps/app/e2e/mobile/canonical-deeplink-preflight.yaml';
const CANONICAL_DEEPLINK_URL =
  process.env.HUISHYPE_MOBILE_CANONICAL_DEEPLINK ??
  'huishype:///eindhoven/5651ha/beeldbuisring/2';
const flowPathArg = process.argv[2] ?? DEFAULT_FLOW_PATH;
const LOCK_PATH = '/tmp/huishype-mobile-e2e.lock';
const LOCK_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_MAESTRO_ATTEMPTS = 3;
const EXPO_SERVICE_NAME = 'huishype-expo';
const POST_BOOTSTRAP_SETTLE_MS = 3000;
const PRE_MAESTRO_ATTEMPT_DELAY_MS = 1500;
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

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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

function runCapture(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: REPO_ROOT,
    shell: false,
    encoding: 'utf8',
    ...options,
  });
}

function isKeyboardVisible() {
  const result = runCapture('adb', ['shell', 'dumpsys', 'input_method']);
  if (result.error || typeof result.status === 'number' && result.status !== 0) {
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

function waitForMetroReady() {
  const deadline = Date.now() + 2 * 60 * 1000;

  while (Date.now() < deadline) {
    const result = runCapture('curl', ['--silent', '--fail', 'http://localhost:8081/status']);
    if (
      !result.error &&
      result.status === 0 &&
      `${result.stdout ?? ''}`.includes('packager-status:running')
    ) {
      return true;
    }

    sleep(1000);
  }

  throw new Error('Timed out waiting for Expo Metro to report packager-status:running');
}

function bootstrapApp() {
  const expoServiceStatus = runCapture('systemctl', ['--user', 'is-active', EXPO_SERVICE_NAME]);
  const shouldRestartExpo =
    expoServiceStatus.error ||
    expoServiceStatus.status !== 0 ||
    `${expoServiceStatus.stdout ?? ''}`.trim() !== 'active';

  const steps = [
    ...(shouldRestartExpo ? [['systemctl', ['--user', 'restart', EXPO_SERVICE_NAME]]] : []),
    ['adb', ['logcat', '-c']],
    ['adb', ['reverse', 'tcp:8081', 'tcp:8081']],
    ['adb', ['reverse', 'tcp:3100', 'tcp:3100']],
    ['adb', ['shell', 'am', 'force-stop', 'nl.huishype.app']],
    ['adb', ['shell', 'pm', 'clear', 'nl.huishype.app']],
    ['adb', ['shell', 'am', 'start', '-W', '-n', 'nl.huishype.app/.MainActivity']],
    [
      'adb',
      [
        'shell',
        'am',
        'start',
        '-W',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        'exp+huishype://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081',
        'nl.huishype.app',
      ],
    ],
  ];

  for (const [command, args] of steps) {
    const result = run(command, args);
    if (!updateExitCode(result)) {
      return false;
    }

    if (command === 'systemctl') {
      waitForMetroReady();
    }
  }

  if (!shouldRestartExpo) {
    waitForMetroReady();
  }

  const waitForDeviceResult = run('adb', ['wait-for-device']);
  if (!updateExitCode(waitForDeviceResult)) {
    return false;
  }

  sleep(POST_BOOTSTRAP_SETTLE_MS);

  return dismissKeyboardIfVisible();
}

function openCanonicalDeepLink() {
  sleep(2000);

  const result = run(
    'adb',
    [
      'shell',
      'am',
      'start',
      '-W',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      CANONICAL_DEEPLINK_URL,
      'nl.huishype.app',
    ],
  );
  if (!updateExitCode(result)) {
    return false;
  }

  return true;
}

function runMaestroAttempt(flowPath, attempt) {
  console.log(`Maestro attempt ${attempt}/${MAX_MAESTRO_ATTEMPTS}: ${flowPath}`);

  const result = spawnSync('maestro', ['test', flowPath], {
    cwd: REPO_ROOT,
    shell: false,
    stdio: 'pipe',
    encoding: 'utf8',
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const isTransientFailure =
    typeof result.status === 'number' &&
    result.status !== 0 &&
    TRANSIENT_MAESTRO_PATTERNS.some((pattern) => combinedOutput.includes(pattern));

  return { result, isTransientFailure };
}

function runFlowWithRetries(
  flowPath,
  { requiresCanonicalDeepLink = false, bootstrapFlowPath = null } = {},
) {
  for (let attempt = 1; attempt <= MAX_MAESTRO_ATTEMPTS; attempt += 1) {
    sleep(PRE_MAESTRO_ATTEMPT_DELAY_MS);
    const { result, isTransientFailure } = runMaestroAttempt(flowPath, attempt);

    if (result.error) {
      console.error(result.error.message);
      process.exitCode = 1;
      return false;
    }

    if (result.status === 0) {
      process.exitCode = 0;
      return true;
    }

    process.exitCode = result.status ?? 1;

    if (!isTransientFailure || attempt === MAX_MAESTRO_ATTEMPTS) {
      return false;
    }

    console.warn('Retrying mobile flow after transient Maestro transport failure');

    if (!bootstrapApp()) {
      return false;
    }

    if (bootstrapFlowPath && !runFlowWithRetries(bootstrapFlowPath)) {
      return false;
    }

    if (requiresCanonicalDeepLink && !openCanonicalDeepLink()) {
      return false;
    }
  }

  return false;
}

let lockFd;

try {
  lockFd = acquireLock();

  const shouldRunCanonicalSmoke =
    flowPathArg === DEFAULT_FLOW_PATH &&
    fs.existsSync(path.join(REPO_ROOT, CANONICAL_DEEPLINK_FLOW_PATH));

  let succeeded = false;

  if (shouldRunCanonicalSmoke) {
    succeeded =
      bootstrapApp() &&
      runFlowWithRetries(CANONICAL_DEEPLINK_PREFLIGHT_FLOW_PATH) &&
      openCanonicalDeepLink() &&
      runFlowWithRetries(CANONICAL_DEEPLINK_FLOW_PATH, {
        requiresCanonicalDeepLink: true,
      });

    if (succeeded) {
      succeeded =
        bootstrapApp() &&
        runFlowWithRetries(CANONICAL_DEEPLINK_PREFLIGHT_FLOW_PATH) &&
        runFlowWithRetries(flowPathArg, {
          bootstrapFlowPath: CANONICAL_DEEPLINK_PREFLIGHT_FLOW_PATH,
        });
    }
  } else if (flowPathArg === CANONICAL_DEEPLINK_FLOW_PATH) {
    succeeded =
      bootstrapApp() &&
      runFlowWithRetries(CANONICAL_DEEPLINK_PREFLIGHT_FLOW_PATH) &&
      openCanonicalDeepLink() &&
      runFlowWithRetries(flowPathArg, { requiresCanonicalDeepLink: true });
  } else if (bootstrapApp()) {
    succeeded =
      runFlowWithRetries(CANONICAL_DEEPLINK_PREFLIGHT_FLOW_PATH) &&
      runFlowWithRetries(flowPathArg, {
        bootstrapFlowPath: CANONICAL_DEEPLINK_PREFLIGHT_FLOW_PATH,
      });
  }

  if (!succeeded && process.exitCode === 0) {
    process.exitCode = 1;
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
