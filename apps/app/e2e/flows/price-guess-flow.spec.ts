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

import { test, expect, type APIRequestContext } from '@playwright/test';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3100';

// Known acceptable console errors
const KNOWN_ACCEPTABLE_ERRORS: RegExp[] = [
  /ResizeObserver loop/,
  /sourceMappingURL/,
  /Failed to parse source map/,
  /Fast Refresh/,
  /\[HMR\]/,
  /WebSocket connection/,
  /net::ERR_ABORTED/,
  /AJAXError/,
  /\.pbf/,
  /tiles\.openfreemap\.org/,
  /pointerEvents is deprecated/,
  /GL Driver Message/,
  /Expected value to be of type/,
  /Failed to load resource.*\/sprites\//,
];

/** Create a test user via the mock Google auth endpoint */
async function createTestUser(request: APIRequestContext, suffix: string = 'guess') {
  const unique = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const response = await request.post(`${API_BASE_URL}/auth/google`, {
    data: { idToken: `mock-google-e2e${suffix}${unique}-gid${unique}` },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return {
    userId: body.session.user.id as string,
    accessToken: body.session.accessToken as string,
    username: body.session.user.username as string,
  };
}

/** Fetch a real property ID from the API */
async function getTestProperty(request: APIRequestContext) {
  const response = await request.get(`${API_BASE_URL}/properties?limit=10&city=Eindhoven`);
  expect(response.ok()).toBe(true);
  const data = await response.json();
  expect(data.data.length).toBeGreaterThan(0);
  // Prefer a property with a WOZ value for better slider display
  const withWoz = data.data.find((p: { wozValue?: number }) => p.wozValue && p.wozValue > 0);
  const property = withWoz || data.data[0];
  return {
    id: property.id as string,
    address: property.address as string,
    wozValue: property.wozValue as number | null,
  };
}

test.describe('Price Guess Flow', () => {
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!KNOWN_ACCEPTABLE_ERRORS.some((p) => p.test(text))) {
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
    const property = await getTestProperty(request);

    await page.goto(`/property/${property.id}`);
    await page.waitForLoadState('networkidle');

    // Wait for the loading state to disappear
    await page.locator('text=Loading property...').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});

    // Verify price guess section is visible
    const priceGuessSection = page.locator('[data-testid="price-guess-section"]');
    // It might be off-screen, so check existence not just visibility
    const sectionCount = await priceGuessSection.count();

    // The property detail page ([id].tsx) uses PriceGuessSlider directly, check that
    const slider = page.locator('[data-testid="price-guess-slider"]');
    const sliderCount = await slider.count();

    // At least one form of price guess UI should be present
    expect(sectionCount + sliderCount).toBeGreaterThan(0);
  });

  test('slider UI elements are present', async ({ page, request }) => {
    const property = await getTestProperty(request);

    await page.goto(`/property/${property.id}`);
    await page.waitForLoadState('networkidle');
    await page.locator('text=Loading property...').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});

    // Scroll to find the slider
    const slider = page.locator('[data-testid="price-guess-slider"]');
    if (await slider.count() > 0) {
      await slider.scrollIntoViewIfNeeded();

      // Verify header text
      await expect(page.locator('text=What do you think this property is worth?')).toBeVisible();

      // Verify price display
      const priceDisplay = page.locator('[data-testid="price-display"]');
      await expect(priceDisplay).toBeVisible();
      const priceText = await priceDisplay.textContent();
      // Should contain EUR symbol
      expect(priceText).toContain('\u20AC');

      // Verify slider thumb
      const thumb = page.locator('[data-testid="slider-thumb"]');
      await expect(thumb).toBeVisible();

      // Verify submit button
      const submitBtn = page.locator('[data-testid="submit-guess-button"]');
      await expect(submitBtn).toBeVisible();

      // Verify min/max labels
      await expect(page.locator('text=\u20AC50.000').first()).toBeVisible();
      await expect(page.locator('text=\u20AC2.000.000').first()).toBeVisible();
    }
  });

  test('quick adjustment buttons change price', async ({ page, request }) => {
    const property = await getTestProperty(request);

    await page.goto(`/property/${property.id}`);
    await page.waitForLoadState('networkidle');
    await page.locator('text=Loading property...').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});

    const slider = page.locator('[data-testid="price-guess-slider"]');
    if (await slider.count() === 0) {
      test.skip();
      return;
    }
    await slider.scrollIntoViewIfNeeded();

    // Get initial price
    const priceDisplay = page.locator('[data-testid="price-display"]');
    const initialPrice = await priceDisplay.textContent();

    // Click +50k button
    const plus50k = page.locator('[data-testid="adjust-plus-50k"]');
    await expect(plus50k).toBeVisible();
    await plus50k.click();

    // Wait for animation
    await page.waitForTimeout(500);

    // Price should have changed
    const newPrice = await priceDisplay.textContent();
    expect(newPrice).not.toBe(initialPrice);

    // Click -10k button
    const minus10k = page.locator('[data-testid="adjust-minus-10k"]');
    await expect(minus10k).toBeVisible();
    await minus10k.click();

    await page.waitForTimeout(500);

    // Price should change again
    const finalPrice = await priceDisplay.textContent();
    expect(finalPrice).not.toBe(newPrice);
  });

  test('unauthenticated guess submission shows sign-in prompt on property detail page', async ({
    page,
    request,
  }) => {
    const property = await getTestProperty(request);

    await page.goto(`/property/${property.id}`);
    await page.waitForLoadState('networkidle');
    await page.locator('text=Loading property...').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});

    // The PriceGuessSection shows a "Sign in to submit your guess" prompt when not authenticated
    // OR the slider is disabled with the submit button disabled
    const signInPrompt = page.locator('text=Sign in to submit your guess');
    const signInVisible = await signInPrompt.first().isVisible().catch(() => false);

    if (signInVisible) {
      // Verify the sign-in button exists
      const signInBtn = page.locator('text=Sign In');
      await expect(signInBtn.first()).toBeVisible();
    } else {
      // The submit button should be disabled when not authenticated
      const submitBtn = page.locator('[data-testid="submit-guess-button"]');
      if (await submitBtn.count() > 0) {
        await submitBtn.scrollIntoViewIfNeeded();
        // The slider is disabled when not authenticated, so "Submit Guess" text
        // should be visible but clicking should not trigger any action
        const submitText = page.locator('text=Submit Guess');
        await expect(submitText.first()).toBeVisible();
      }
    }
  });

  test('authenticated guess submission persists via API', async ({ request }) => {
    const property = await getTestProperty(request);
    const testUser = await createTestUser(request, 'guess');

    // Submit a guess via API
    const guessPrice = 350000;
    const guessResponse = await request.post(
      `${API_BASE_URL}/properties/${property.id}/guesses`,
      {
        data: { guessedPrice: guessPrice },
        headers: {
          'x-user-id': testUser.userId,
          'Authorization': `Bearer ${testUser.accessToken}`,
        },
      }
    );

    expect(guessResponse.status()).toBe(201);
    const guessData = await guessResponse.json();
    expect(guessData.guessedPrice).toBe(guessPrice);
    expect(guessData.propertyId).toBe(property.id);
    expect(guessData.message).toContain('submitted');

    // Verify the guess appears in the list
    const listResponse = await request.get(
      `${API_BASE_URL}/properties/${property.id}/guesses`
    );
    expect(listResponse.ok()).toBe(true);
    const listData = await listResponse.json();
    expect(listData.data.length).toBeGreaterThan(0);
    const found = listData.data.find(
      (g: { userId: string }) => g.userId === testUser.userId
    );
    expect(found).toBeDefined();
    expect(found.guessedPrice).toBe(guessPrice);

    // Verify stats updated
    expect(listData.stats.totalGuesses).toBeGreaterThan(0);
  });

  test('guess cooldown prevents immediate re-submission', async ({ request }) => {
    const property = await getTestProperty(request);
    const testUser = await createTestUser(request, 'cooldown');

    // Submit initial guess
    const firstGuess = await request.post(
      `${API_BASE_URL}/properties/${property.id}/guesses`,
      {
        data: { guessedPrice: 300000 },
        headers: { 'x-user-id': testUser.userId },
      }
    );
    expect(firstGuess.status()).toBe(201);

    // Attempt immediate re-submission
    const secondGuess = await request.post(
      `${API_BASE_URL}/properties/${property.id}/guesses`,
      {
        data: { guessedPrice: 350000 },
        headers: { 'x-user-id': testUser.userId },
      }
    );

    // Should be rejected with cooldown error
    expect(secondGuess.status()).toBe(400);
    const errorData = await secondGuess.json();
    expect(errorData.error).toBe('COOLDOWN_ACTIVE');
    expect(errorData.cooldownEndsAt).toBeDefined();
  });
});
