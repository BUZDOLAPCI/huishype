import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration for HuisHype web app.
 * See https://playwright.dev/docs/test-configuration
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
  },
  /* Configure projects for major browsers */
  projects: [
    // Visual E2E tests - runs against real app, catches real issues
    {
      name: 'visual',
      testDir: './apps/app/e2e/visual',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        screenshot: 'on', // Always capture screenshots
        trace: 'on', // Always capture trace for debugging
        video: 'on', // Always capture video
      },
      // Visual tests have longer timeout since they test real app behavior
      timeout: 60000, // 60 seconds per test
    },
    // Integration tests (API-only, no web server needed)
    {
      name: 'integration',
      testDir: './apps/app/e2e/integration',
      use: { ...devices['Desktop Chrome'] },
    },
    // Web E2E tests
    {
      name: 'chromium',
      testDir: './apps/app/e2e/web',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testDir: './apps/app/e2e/web',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testDir: './apps/app/e2e/web',
      use: { ...devices['Desktop Safari'] },
    },
    /* Test against mobile viewports */
    {
      name: 'Mobile Chrome',
      testDir: './apps/app/e2e/web',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      testDir: './apps/app/e2e/web',
      use: { ...devices['iPhone 12'] },
    },
  ],
  /* Run local dev server before starting the tests */
  webServer: {
    command: 'pnpm --filter @huishype/app web',
    url: 'http://localhost:8081',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000, // 2 minutes to start the server
  },
  /* Output directory for test artifacts */
  outputDir: './test-results/playwright',
});
