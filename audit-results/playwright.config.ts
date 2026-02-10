import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 120000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:8081',
    viewport: { width: 1440, height: 900 },
    headless: true,
    screenshot: 'off',
    trace: 'off',
  },
  reporter: [['list']],
});
