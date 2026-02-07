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
    baseURL: 'http://localhost:8081',
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
  webServer: process.env.CI
    ? {
        // CI: Serve pre-built static files (faster startup)
        command: `serve ${process.env.E2E_WEB_BUILD_PATH || 'apps/app/dist'} -l 8081`,
        url: 'http://localhost:8081',
        reuseExistingServer: false,
        timeout: 30 * 1000, // 30 seconds for static server
      }
    : {
        // Local: Use Expo dev server for hot reload
        command: 'pnpm --filter @huishype/app web',
        url: 'http://localhost:8081',
        reuseExistingServer: true,
        timeout: 120 * 1000, // 2 min for dev server
      },
  /* Output directory for test artifacts */
  outputDir: './test-results/playwright',
});
