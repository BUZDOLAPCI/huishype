import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * Playwright E2E test configuration for HuisHype web app.
 * This is a local config for running tests from the apps/web directory.
 * For full test runs, use the root playwright.config.ts instead.
 */
export default defineConfig({
  testDir: './e2e',
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
    ...(process.env.CI ? [['github', {}] as [string, any]] : []),
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
  projects: process.env.CI
    ? [
        // CI: Only run on Chromium to speed up tests
        {
          name: 'visual',
          testDir: './e2e/visual',
          use: {
            ...devices['Desktop Chrome'],
            viewport: { width: 1280, height: 720 },
            screenshot: 'on',
            trace: 'on-first-retry',
            video: 'on-first-retry',
          },
          timeout: 90000, // 90 seconds per test in CI
        },
        {
          name: 'integration',
          testDir: './e2e/integration',
          use: { ...devices['Desktop Chrome'] },
        },
        {
          name: 'flows',
          testDir: './e2e/flows',
          use: { ...devices['Desktop Chrome'] },
          timeout: 60000,
        },
      ]
    : [
        // Local: Full browser matrix
        {
          name: 'visual',
          testDir: './e2e/visual',
          use: {
            ...devices['Desktop Chrome'],
            viewport: { width: 1280, height: 720 },
            screenshot: 'on',
            trace: 'retain-on-failure',
            video: 'retain-on-failure',
          },
          workers: 2,
          timeout: 120000,
        },
        {
          name: 'integration',
          testDir: './e2e/integration',
          use: { ...devices['Desktop Chrome'] },
        },
        {
          name: 'flows',
          testDir: './e2e/flows',
          use: { ...devices['Desktop Chrome'] },
          timeout: 60000,
        },
      ],
  /* Run local dev server before starting the tests */
  webServer: process.env.CI
    ? {
        // CI: Serve the Vite build through preview for deterministic startup.
        command: 'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 8081 --strictPort',
        url: 'http://localhost:8081',
        reuseExistingServer: false,
        timeout: 30 * 1000, // 30 seconds for preview server
      }
    : {
        // Local: Use the Vite dev server for hot reload
        command: 'pnpm web',
        url: 'http://localhost:8081',
        reuseExistingServer: true,
        timeout: 120 * 1000, // 2 min for dev server
      },
  /* Output directory for test artifacts */
  outputDir: path.resolve(__dirname, '../../test-results/playwright'),
});
