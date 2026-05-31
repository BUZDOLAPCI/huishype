import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { buildPropertyCommentsRoute } from '@/src/utils/property-route';
import { getCanonicalTestPropertyRoute } from '../flows/helpers/test-property-route';
import { createTestUser } from '../flows/helpers/test-user';
import { getPlaywrightApiUrl } from '../helpers/runtime';
import {
  NETWORK_ALLOWED_CONSOLE_PATTERNS,
  attachConsoleErrorCollector,
  expectNoConsoleErrors,
} from '../helpers/console';

const API_BASE_URL = getPlaywrightApiUrl();
const SCREENSHOT_DIR = 'test-results/reference-expectations/comment-action-menu';
const VIEWPORTS = [
  { name: 'mobile-web', width: 390, height: 844 },
  { name: 'desktop-web', width: 1440, height: 900 },
] as const;

test.use({ trace: 'off', video: 'off' });

test.beforeAll(async () => {
  const fullPath = path.resolve(process.cwd(), SCREENSHOT_DIR);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

async function createReportableComment(request: APIRequestContext): Promise<{
  route: string;
  content: string;
}> {
  const property = await getCanonicalTestPropertyRoute(request);
  const commenter = await createTestUser(request, 'commentactionmenu');
  const content = `E2E action menu comment ${Date.now()}`;

  const createCommentResponse = await request.post(
    `${API_BASE_URL}/properties/${property.id}/comments`,
    {
      headers: { authorization: `Bearer ${commenter.accessToken}` },
      data: { content },
    },
  );
  expect(createCommentResponse.status()).toBe(201);

  const propertyResponse = await request.get(`${API_BASE_URL}/properties/${property.id}`);
  expect(propertyResponse.ok()).toBe(true);
  const propertyDetail = await propertyResponse.json();

  return {
    route: buildPropertyCommentsRoute(propertyDetail),
    content,
  };
}

async function openCommentActionMenu(page: Page, content: string) {
  await expect(page.getByText(content)).toBeVisible({ timeout: 30_000 });

  await expect(page.getByTestId('comment-action-menu')).toHaveCount(0);
  const commentCell = page.getByTestId('comment-cell').filter({ hasText: content }).first();
  await expect(commentCell).toBeVisible({ timeout: 10_000 });

  await commentCell.hover();
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();

  await expect(page.getByTestId('comment-action-menu')).toBeVisible({ timeout: 10_000 });
}

test.describe('Comment action menu visual', () => {
  for (const viewport of VIEWPORTS) {
    test(`opens Report and Copy modal on ${viewport.name}`, async ({ page, request }) => {
      const consoleErrors = attachConsoleErrorCollector(page, NETWORK_ALLOWED_CONSOLE_PATTERNS);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const fixture = await createReportableComment(request);

      await page.goto(fixture.route);
      await page.waitForLoadState('networkidle');

      await openCommentActionMenu(page, fixture.content);

      const menu = page.getByTestId('comment-action-menu');
      const reportItem = menu.getByTestId('comment-report-menu-item');
      const copyItem = menu.getByTestId('comment-copy-menu-item');
      await expect(reportItem).toBeVisible();
      await expect(copyItem).toBeVisible();
      await expect(reportItem.getByText('Report')).toBeVisible();
      await expect(copyItem.getByText('Copy')).toBeVisible();
      await expect(menu.getByText('Translate')).toHaveCount(0);

      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${viewport.name}-current.png`,
        fullPage: false,
      });

      expectNoConsoleErrors(consoleErrors, `${viewport.name} comment action menu console errors`);
    });
  }
});
