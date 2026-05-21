import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildPropertyCommentsRoute } from '@/src/utils/property-route';
import { getCanonicalTestPropertyRoute } from './helpers/test-property-route';
import { createTestUser } from './helpers/test-user';
import { getPlaywrightApiUrl } from '../helpers/runtime';
import {
  NETWORK_ALLOWED_CONSOLE_PATTERNS,
  attachConsoleErrorCollector,
  expectNoConsoleErrors,
} from '../helpers/console';
import { waitForPropertyDetailReady } from '../integration/helpers';

const API_BASE_URL = getPlaywrightApiUrl();
const execFileAsync = promisify(execFile);

test.use({ trace: 'off' });

async function grantAdminAccess(userId: string) {
  await execFileAsync(
    'pnpm',
    [
      '--filter',
      '@huishype/api',
      'exec',
      'tsx',
      '-e',
      "import { db } from './src/db/index.ts'; import { users } from './src/db/schema.ts'; import { eq } from 'drizzle-orm'; (async () => { await db.update(users).set({ isAdmin: true }).where(eq(users.id, process.env.E2E_ADMIN_USER_ID!)); process.exit(0); })().catch((error) => { console.error(error); process.exit(1); });",
    ],
    {
      env: {
        ...process.env,
        E2E_ADMIN_USER_ID: userId,
      },
    },
  );
}

test.describe('Report and admin moderation', () => {
  test('reports a property from the detail Activity section without console errors', async ({
    page,
    request,
  }) => {
    const consoleErrors = attachConsoleErrorCollector(page, NETWORK_ALLOWED_CONSOLE_PATTERNS);
    const property = await getCanonicalTestPropertyRoute(request);

    await page.goto(property.route);
    await page.waitForLoadState('networkidle');
    if (property.address) {
      await waitForPropertyDetailReady(page, property.address, 30_000);
    }

    const reportButton = page.getByTestId('property-report-button');
    await reportButton.scrollIntoViewIfNeeded();
    await expect(reportButton).toBeVisible({ timeout: 15_000 });
    await reportButton.click();

    await expect(page.getByTestId('report-modal')).toBeVisible();
    await page
      .getByTestId('report-category-wrong_listing')
      .click();
    await page.getByTestId('report-details-input').fill('E2E report: listing looks stale.');
    await page.screenshot({
      path: 'test-results/report-admin/property-report-modal.png',
      fullPage: true,
    });
    await page.getByTestId('report-submit-button').click();
    await expect(page.getByTestId('report-success')).toBeVisible({ timeout: 10_000 });

    expectNoConsoleErrors(consoleErrors, 'property report console errors');
  });

  test('reports a comment only through the long-press action menu', async ({
    page,
    request,
  }) => {
    const consoleErrors = attachConsoleErrorCollector(page, NETWORK_ALLOWED_CONSOLE_PATTERNS);
    const property = await getCanonicalTestPropertyRoute(request);
    const commenter = await createTestUser(request, 'reportcomment');
    const commentContent = `E2E reportable comment ${Date.now()}`;

    const createCommentResponse = await request.post(
      `${API_BASE_URL}/properties/${property.id}/comments`,
      {
        headers: { authorization: `Bearer ${commenter.accessToken}` },
        data: { content: commentContent },
      },
    );
    expect(createCommentResponse.status()).toBe(201);

    const propertyResponse = await request.get(`${API_BASE_URL}/properties/${property.id}`);
    expect(propertyResponse.ok()).toBe(true);
    const propertyDetail = await propertyResponse.json();

    await page.goto(buildPropertyCommentsRoute(propertyDetail));
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(commentContent)).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId('comment-report-menu-item')).toHaveCount(0);
    const commentCell = page.getByTestId('comment-cell').filter({ hasText: commentContent }).first();
    await expect(commentCell).toBeVisible({ timeout: 10_000 });
    await commentCell.hover();
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();

    const reportMenuItem = page.getByTestId('comment-report-menu-item').first();
    await expect(reportMenuItem).toBeVisible({ timeout: 10_000 });
    await reportMenuItem.click();
    await page.getByTestId('report-category-spam').click();
    await page.getByTestId('report-details-input').fill('E2E comment spam report.');
    await page.screenshot({
      path: 'test-results/report-admin/comment-report-menu.png',
      fullPage: true,
    });
    await page.getByTestId('report-submit-button').click();
    await expect(page.getByTestId('report-success')).toBeVisible({ timeout: 10_000 });

    expectNoConsoleErrors(consoleErrors, 'comment report console errors');
  });

  test('admin can view and resolve flagged property reports through protected API', async ({
    request,
  }) => {
    const property = await getCanonicalTestPropertyRoute(request);
    const admin = await createTestUser(request, 'adminreport');
    await grantAdminAccess(admin.userId);

    const reportResponse = await request.post(`${API_BASE_URL}/properties/${property.id}/report`, {
      data: {
        reason: 'incorrect_property_data',
        reporterDeviceId: `e2e-admin-${Date.now()}`,
      },
    });
    expect(reportResponse.status()).toBe(201);
    const reportBody = await reportResponse.json();

    const deniedResponse = await request.get(`${API_BASE_URL}/admin/reports/properties`);
    expect(deniedResponse.status()).toBe(401);

    const queueResponse = await request.get(`${API_BASE_URL}/admin/reports/properties`, {
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(queueResponse.ok()).toBe(true);
    const queueBody = await queueResponse.json();
    expect(
      queueBody.data.some((report: { id: string }) => report.id === reportBody.report.id),
    ).toBe(true);

    const patchResponse = await request.patch(
      `${API_BASE_URL}/admin/reports/${reportBody.report.id}`,
      {
        headers: { authorization: `Bearer ${admin.accessToken}` },
        data: { action: 'mark_property_reviewed' },
      },
    );
    expect(patchResponse.ok()).toBe(true);
    const patchBody = await patchResponse.json();
    expect(patchBody.report.reviewAction).toBe('mark_property_reviewed');
  });
});
