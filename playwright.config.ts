import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration for HuisHype web app.
 * See https://playwright.dev/docs/test-configuration
 *
 * NOTE: The Expo dev server compiles the Metro bundle on first request,
 * which can take 30-60+ seconds. All web/integration projects use a
 * 60s timeout to accommodate this. A global setup project warms the
 * bundle before any browser tests run.
 */

const PLAYWRIGHT_API_PORT = Number.parseInt(process.env.PLAYWRIGHT_API_PORT || '3101', 10);
const PLAYWRIGHT_WEB_PORT = Number.parseInt(process.env.PLAYWRIGHT_WEB_PORT || '8082', 10);
const PLAYWRIGHT_API_URL = `http://127.0.0.1:${PLAYWRIGHT_API_PORT}`;
const PLAYWRIGHT_WEB_URL = `http://127.0.0.1:${PLAYWRIGHT_WEB_PORT}`;

process.env.API_URL = PLAYWRIGHT_API_URL;
process.env.EXPO_PUBLIC_API_URL = PLAYWRIGHT_API_URL;
process.env.PLAYWRIGHT_API_PORT = String(PLAYWRIGHT_API_PORT);
process.env.PLAYWRIGHT_WEB_PORT = String(PLAYWRIGHT_WEB_PORT);
process.env.PLAYWRIGHT_WEB_URL = PLAYWRIGHT_WEB_URL;

export default defineConfig({
  testDir: './apps/app/e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI */
  workers: process.env.CI ? 1 : undefined,
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
    /* Navigation timeout - Expo dev server can be slow on first load */
    navigationTimeout: 45_000,
    /* Action timeout */
    actionTimeout: 15_000,
  },
  /* Global timeout for all tests - Metro bundler's first compile is slow */
  timeout: 60_000,
  /* Configure projects for major browsers */
  projects: process.env.CI
    ? [
        // CI: Only run on Chromium to speed up tests
        {
          name: 'visual',
          testDir: './apps/app/e2e/visual',
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
          testDir: './apps/app/e2e/integration',
          use: { ...devices['Desktop Chrome'] },
        },
        {
          name: 'flows',
          testDir: './apps/app/e2e/flows',
          use: { ...devices['Desktop Chrome'] },
        },
      ]
    : [
        // Local: Full browser matrix
        {
          name: 'visual',
          testDir: './apps/app/e2e/visual',
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
          testDir: './apps/app/e2e/integration',
          use: { ...devices['Desktop Chrome'] },
        },
        {
          name: 'flows',
          testDir: './apps/app/e2e/flows',
          use: { ...devices['Desktop Chrome'] },
        },
      ],
  /* Run local dev server before starting the tests */
  webServer: {
    // Start the dedicated test-only API and Expo web servers on isolated ports.
    command: 'node ./scripts/playwright/integration-runtime.mjs',
    url: PLAYWRIGHT_WEB_URL,
    reuseExistingServer: false,
    timeout: 120 * 1000, // Expo web startup can be slow on the first request
  },
  /* Output directory for test artifacts */
  outputDir: './test-results/playwright',
});
