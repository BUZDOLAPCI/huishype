/**
 * Price Guess Flow E2E Tests
 *
 * Tests the price guess feature end-to-end:
 * - Navigate to property detail page
 * - Verify price guess section renders
 * - Check slider UI elements
 * - Test quick adjustment buttons
 * - Verify unauthenticated submission shows login prompt
 * - Test authenticated guess submission via API
 */

import { test, expect, type Page } from '@playwright/test';
import { createTestUser } from './helpers/test-user';
import { getCanonicalTestPropertyRoute } from './helpers/test-property-route';
import { getPlaywrightApiUrl } from '../helpers/runtime';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

const API_BASE_URL = getPlaywrightApiUrl();

// Known acceptable console errors
const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

// Disable tracing to avoid artifact issues
test.use({ trace: 'off' });

async function waitForPriceGuessUi(page: Page) {
  const section = page.locator('[data-testid="price-guess-section"]');
  const slider = page.locator('[data-testid="price-guess-slider"]');

  await expect(section).toHaveCount(1, { timeout: 30000 });
  await section.scrollIntoViewIfNeeded().catch(() => {});
  await expect(slider).toHaveCount(1, { timeout: 30000 });
  await slider.scrollIntoViewIfNeeded();

  return { section, slider };
}

function normalizePriceText(text: string): string {
  return text
    .replace(/[\s\u00A0\u202F.]/g, '')
    .toLowerCase();
}

async function readNormalizedText(locator: ReturnType<Page['locator']>) {
  const text = await locator.textContent();
  expect(text).not.toBeNull();
  return normalizePriceText(text ?? '');
}

async function dragSliderThumb(page: Page, deltaX: number) {
  const thumb = page.locator('[data-testid="slider-thumb"]').first();
  const thumbBox = await thumb.boundingBox();

  expect(thumbBox).not.toBeNull();

  const startX = thumbBox!.x + thumbBox!.width / 2;
  const startY = thumbBox!.y + thumbBox!.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 12 });
  await page.mouse.up();
}

test.describe('Price Guess Flow', () => {
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS)) {
          consoleErrors.push(text);
        }
      }
    });
    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    if (consoleErrors.length > 0) {
      console.error(`Console errors (${consoleErrors.length}):`, consoleErrors);
    }
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('price guess section renders on property detail page', async ({ page, request }) => {
    const property = await getCanonicalTestPropertyRoute(request);

    await page.goto(property.route, { waitUntil: 'domcontentloaded' });

    // Wait for the loading state to disappear
    await page.locator('text=Loading property...').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});

    // Wait a bit for price guess data to load
    await page.waitForTimeout(3000);

    // PriceGuessSection is below the fold, need to scroll to find it
    const priceGuessSection = page.locator('[data-testid="price-guess-section"]');
    const slider = page.locator('[data-testid="price-guess-slider"]');

    // Try scrolling to find the section
    await priceGuessSection.scrollIntoViewIfNeeded().catch(() => {});
    await slider.scrollIntoViewIfNeeded().catch(() => {});

    const sectionCount = await priceGuessSection.count();
    const sliderCount = await slider.count();

    // At least one form of price guess UI should be present
    expect(sectionCount + sliderCount).toBeGreaterThan(0);
  });

  test('slider UI elements are present', async ({ page, request }) => {
    const property = await getCanonicalTestPropertyRoute(request);

    await page.goto(property.route, { waitUntil: 'domcontentloaded' });
    await page.locator('text=Loading property...').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});

    await waitForPriceGuessUi(page);

    await expect(page.locator('text=Guess the Price').first()).toBeVisible();
    await expect(page.locator('text=What do you think this property is worth?').first()).toBeVisible();

    // Verify price display
    const priceDisplay = page.locator('[data-testid="price-display"]');
    await expect(priceDisplay).toBeVisible();
    const priceText = await priceDisplay.textContent();
    expect(priceText).toContain('\u20AC');

    // Verify slider thumb
    const thumb = page.locator('[data-testid="slider-thumb"]');
    await expect(thumb).toBeVisible();

    // Verify submit button
    const submitBtn = page.locator('[data-testid="submit-guess-button"]');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn.locator('text=Submit Guess')).toBeVisible();
    const submitBackground = await submitBtn.evaluate((element) =>
      window.getComputedStyle(element).backgroundColor
    );
    expect(submitBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(submitBackground).not.toBe('transparent');

    const minLabel = page.locator('[data-testid="price-range-min"]').first();
    const maxLabel = page.locator('[data-testid="price-range-max"]').first();
    await expect(minLabel).toBeVisible();
    await expect(maxLabel).toBeVisible();

    const normalizedMin = await readNormalizedText(minLabel);
    const normalizedMax = await readNormalizedText(maxLabel);
    expect(normalizedMin).toBe('€50k');
    expect(normalizedMax).toMatch(/^€2(m|mln)$/);
  });

  test('dragging the slider thumb changes the displayed price', async ({ page, request }) => {
    const property = await getCanonicalTestPropertyRoute(request);

    await page.goto(property.route, { waitUntil: 'domcontentloaded' });
    await page.locator('text=Loading property...').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});

    await waitForPriceGuessUi(page);

    const priceDisplay = page.locator('[data-testid="price-display"]');
    await expect(priceDisplay).toBeVisible();

    const initialPrice = await readNormalizedText(priceDisplay);
    expect(initialPrice).toContain('€');

    await dragSliderThumb(page, 120);

    await expect
      .poll(async () => readNormalizedText(priceDisplay), {
        timeout: 5000,
        message: 'Expected slider drag to update the displayed guess price',
      })
      .not.toBe(initialPrice);
  });

  test('unauthenticated guess submission opens auth modal on submit with guess-specific copy', async ({
    page,
    request,
  }) => {
    const property = await getCanonicalTestPropertyRoute(request);

    await page.goto(property.route, { waitUntil: 'domcontentloaded' });
    await page.locator('text=Loading property...').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
    await waitForPriceGuessUi(page);

    await expect(page.locator('text=Sign in to submit your guess')).toHaveCount(0);

    const submitBtn = page.locator('[data-testid="submit-guess-button"]');
    await submitBtn.scrollIntoViewIfNeeded();
    await expect(submitBtn).toBeVisible();

    await submitBtn.click();

    await expect(page.locator('[data-testid="auth-modal-overlay"]')).toBeVisible();
    await expect(page.locator('text=Welcome to HuisHype').first()).toBeVisible();
    await expect(page.locator('text=Sign in to submit your guess').first()).toBeVisible();
    await expect(
      page.locator('text=Your guess will be saved and you can track your prediction accuracy.')
    ).toHaveCount(0);
    await expect(page.locator('text=Continue with Google')).toBeVisible();
  });

  test('authenticated guess submission persists via API', async ({ request }) => {
    const property = await getCanonicalTestPropertyRoute(request);
    const testUser = await createTestUser(request, 'guess');

    // Submit a guess via API
    const guessPrice = 350000;
    const guessResponse = await request.post(
      `${API_BASE_URL}/properties/${property.id}/guesses`,
      {
        data: { guessedPrice: guessPrice },
        headers: {
          authorization: `Bearer ${testUser.accessToken}`,
        },
      }
    );

    expect(guessResponse.status()).toBe(201);
    const guessData = await guessResponse.json();
    expect(guessData.guessedPrice).toBe(guessPrice);
    expect(guessData.propertyId).toBe(property.id);
    expect(guessData.message).toContain('submitted');

    // Verify the guess appears in the list. The endpoint returns newest first,
    // so our just-submitted guess should be on page 1.
    const listResponse = await request.get(
      `${API_BASE_URL}/properties/${property.id}/guesses?limit=100`
    );
    expect(listResponse.ok()).toBe(true);
    const listData = await listResponse.json();
    expect(listData.data.length).toBeGreaterThan(0);
    const found = listData.data.find(
      (g: { id: string }) => g.id === guessData.id
    );
    expect(found).toBeDefined();
    expect(found.guessedPrice).toBe(guessPrice);

    // Verify FMV data updated
    expect(listData.fmv.guessCount).toBeGreaterThan(0);
  });

  test('guess can be updated immediately after the first submission', async ({ request }) => {
    const property = await getCanonicalTestPropertyRoute(request);
    const testUser = await createTestUser(request, 'cooldown');

    // Submit initial guess
    const firstGuess = await request.post(
      `${API_BASE_URL}/properties/${property.id}/guesses`,
      {
        data: { guessedPrice: 300000 },
        headers: { authorization: `Bearer ${testUser.accessToken}` },
      }
    );
    expect(firstGuess.status()).toBe(201);

    // Attempt immediate re-submission
    const secondGuess = await request.post(
      `${API_BASE_URL}/properties/${property.id}/guesses`,
      {
        data: { guessedPrice: 350000 },
        headers: { authorization: `Bearer ${testUser.accessToken}` },
      }
    );

    expect(secondGuess.status()).toBe(200);
    const updatedGuess = await secondGuess.json();
    expect(updatedGuess.guessedPrice).toBe(350000);
    expect(updatedGuess.message).toContain('updated');
  });
});
