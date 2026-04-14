import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration for HuisHype web app.
 * See https://playwright.dev/docs/test-configuration
 *
 * The runtime bootstrap builds the active Vite app and serves it through
 * `vite preview` on an isolated port for deterministic browser tests.
 */

const PLAYWRIGHT_API_PORT = Number.parseInt(process.env.PLAYWRIGHT_API_PORT || '3101', 10);
const PLAYWRIGHT_WEB_PORT = Number.parseInt(process.env.PLAYWRIGHT_WEB_PORT || '8082', 10);
const PLAYWRIGHT_API_URL = `http://127.0.0.1:${PLAYWRIGHT_API_PORT}`;
const PLAYWRIGHT_WEB_URL = `http://127.0.0.1:${PLAYWRIGHT_WEB_PORT}`;
const DISABLE_WEBSERVER = process.env.PLAYWRIGHT_DISABLE_WEBSERVER === '1';

process.env.API_URL = PLAYWRIGHT_API_URL;
process.env.VITE_API_URL = PLAYWRIGHT_API_URL;
process.env.VITE_GOOGLE_CLIENT_ID =
  process.env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
process.env.PLAYWRIGHT_API_PORT = String(PLAYWRIGHT_API_PORT);
process.env.PLAYWRIGHT_WEB_PORT = String(PLAYWRIGHT_WEB_PORT);
process.env.PLAYWRIGHT_WEB_URL = PLAYWRIGHT_WEB_URL;

export default defineConfig({
  testDir: './apps/web/e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Local runs share a single API/Vite runtime; saturating all CPU cores makes the
   * browser tests flaky by overdriving that shared server pair.
   */
  workers: 1,
  /* Reporter to use */
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
    ...(process.env.CI ? [['github' as const]] : []),
  ],
  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL: PLAYWRIGHT_WEB_URL,
    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',
    /* Capture screenshot on failure */
    screenshot: 'only-on-failure',
    /* Capture video on failure */
    video: 'on-first-retry',
    /* Navigation timeout - preview startup and initial map/data loading can be slow */
    navigationTimeout: 45_000,
    /* Action timeout */
    actionTimeout: 15_000,
  },
  /* Global timeout for all tests */
  timeout: 60_000,
  /* Configure projects for major browsers */
  projects: process.env.CI
    ? [
        // CI: Only run on Chromium to speed up tests
        {
          name: 'visual',
          testDir: './apps/web/e2e/visual',
          use: {
            ...devices['Desktop Chrome'],
            viewport: { width: 1280, height: 720 },
            screenshot: 'on',
            trace: 'on-first-retry',
            video: 'on-first-retry',
          },
        },
        {
          name: 'integration',
          testDir: './apps/web/e2e/integration',
          use: { ...devices['Desktop Chrome'] },
        },
        {
          name: 'flows',
          testDir: './apps/web/e2e/flows',
          use: { ...devices['Desktop Chrome'] },
        },
      ]
    : [
        // Local: Full browser matrix
        {
          name: 'visual',
          testDir: './apps/web/e2e/visual',
          use: {
            ...devices['Desktop Chrome'],
            viewport: { width: 1280, height: 720 },
            screenshot: 'on',
            trace: 'retain-on-failure', // Changed from 'on' to avoid artifact race conditions
            video: 'retain-on-failure', // Changed from 'on' to avoid artifact race conditions
          },
        },
        {
          name: 'integration',
          testDir: './apps/web/e2e/integration',
          use: { ...devices['Desktop Chrome'] },
        },
        {
          name: 'flows',
          testDir: './apps/web/e2e/flows',
          use: { ...devices['Desktop Chrome'] },
        },
      ],
  /* Run local dev server before starting the tests */
  webServer: DISABLE_WEBSERVER
    ? undefined
    : {
        // Start the dedicated test-only API and Vite preview servers on isolated ports.
        command: 'node ./scripts/playwright/integration-runtime.mjs',
        url: PLAYWRIGHT_WEB_URL,
        // Always start a fresh runtime so Playwright never attaches to a stale
        // server left behind by a previous run.
        reuseExistingServer: false,
        timeout: 120 * 1000,
      },
  /* Output directory for test artifacts */
  outputDir: './test-results/playwright',
});
