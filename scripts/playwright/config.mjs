import fs from 'node:fs';
import path from 'node:path';
import { devices } from '@playwright/test';
import {
  PLAYWRIGHT_FLOW_TEST_DIR,
  PLAYWRIGHT_INTEGRATION_TEST_DIR,
  PLAYWRIGHT_REPO_ROOT,
  PLAYWRIGHT_TEST_DIR,
  PLAYWRIGHT_VISUAL_TEST_DIR,
  applyPlaywrightRuntimeEnvironment,
} from './runtime-config.mjs';

/** @typedef {import('@playwright/test').PlaywrightTestConfig} PlaywrightTestConfig */

const WELCOME_MODAL_DISMISSED_KEY = 'huishype_welcome_modal_dismissed_v1';
const WELCOME_MODAL_DISMISSED_VALUE = '1';

export function ensureDefaultStorageState(runtime) {
  const storageDir = path.join(runtime.artifactRoot, 'storage');
  const storageStatePath = path.join(storageDir, 'default-state.json');

  fs.mkdirSync(storageDir, { recursive: true });
  fs.writeFileSync(
    storageStatePath,
    JSON.stringify(
      {
        cookies: [],
        origins: [
          {
            origin: runtime.webOrigin,
            localStorage: [
              {
                name: WELCOME_MODAL_DISMISSED_KEY,
                value: WELCOME_MODAL_DISMISSED_VALUE,
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
  );

  return storageStatePath;
}

/** @returns {PlaywrightTestConfig} */
export function createPlaywrightConfig() {
  const runtime = applyPlaywrightRuntimeEnvironment();
  const storageState = ensureDefaultStorageState(runtime);
  const disableWebServer = process.env.PLAYWRIGHT_DISABLE_WEBSERVER === '1';
  const isCi = !!process.env.CI;
  const benchmarkTestDir = path.join(PLAYWRIGHT_TEST_DIR, 'benchmark');
  const sharedVisualUse = {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 720 },
    screenshot: 'on',
  };
  /** @type {PlaywrightTestConfig['reporter']} */
  const reporter = [
    ['html', { open: 'never', outputFolder: runtime.htmlReportDir }],
    ['list'],
    ...(isCi ? [['github']] : []),
  ];
  /** @type {PlaywrightTestConfig['projects']} */
  const projects = [
    {
      name: 'visual',
      testDir: PLAYWRIGHT_VISUAL_TEST_DIR,
      use: {
        ...sharedVisualUse,
        trace: isCi ? 'on-first-retry' : 'retain-on-failure',
        video: isCi ? 'on-first-retry' : 'retain-on-failure',
      },
    },
    {
      name: 'integration',
      testDir: PLAYWRIGHT_INTEGRATION_TEST_DIR,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'flows',
      testDir: PLAYWRIGHT_FLOW_TEST_DIR,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'benchmark',
      testDir: benchmarkTestDir,
      use: {
        ...devices['Desktop Chrome'],
        trace: 'off',
        screenshot: 'off',
        video: 'off',
      },
    },
  ];

  return {
    testDir: PLAYWRIGHT_TEST_DIR,
    fullyParallel: true,
    forbidOnly: isCi,
    retries: isCi ? 2 : 0,
    workers: 1,
    reporter,
    use: {
      baseURL: runtime.webUrl,
      trace: 'on-first-retry',
      screenshot: 'only-on-failure',
      video: 'on-first-retry',
      navigationTimeout: 45_000,
      actionTimeout: 15_000,
      storageState,
    },
    timeout: 60_000,
    projects,
    webServer: disableWebServer
      ? undefined
      : {
          command: `node ${path.join(PLAYWRIGHT_REPO_ROOT, 'scripts', 'playwright', 'integration-runtime.mjs')}`,
          url: runtime.webUrl,
          reuseExistingServer: false,
          timeout: 120_000,
        },
    outputDir: runtime.artifactRoot,
  };
}
