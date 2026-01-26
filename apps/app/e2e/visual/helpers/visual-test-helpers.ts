import { Page, ConsoleMessage, Response } from '@playwright/test';
import * as path from 'path';

/**
 * Visual E2E Test Helpers for HuisHype
 *
 * These utilities help catch real issues by:
 * - Collecting ALL console logs, warnings, and errors
 * - Taking annotated screenshots at critical points
 * - Providing comprehensive error reporting
 * - Validating page state for common issues
 */

// Directory for visual test screenshots
export const VISUAL_SCREENSHOT_DIR = 'test-results/visual';

/**
 * Known acceptable errors that should not fail tests.
 * Add patterns here for errors that are expected or not our concern.
 */
export const KNOWN_ACCEPTABLE_ERRORS = [
  // ResizeObserver loop errors are benign
  'ResizeObserver loop',
  'ResizeObserver loop limit exceeded',
  // React dev mode warnings
  'Warning: ReactDOM.render is no longer supported',
  // React 19 compatibility warnings (library issues, not our code)
  'Accessing element.ref was removed in React 19',
  'ref is now a regular prop',
  // Favicon 404s are acceptable
  'favicon.ico - Failed to load resource',
  // Source map failures are acceptable
  'sourceMappingURL',
  'Failed to parse source map',
  // Service worker issues in dev
  'service-worker.js',
  // Hot module reload messages
  'Fast Refresh',
  '[HMR]',
  // WebSocket connection errors in dev
  'WebSocket connection',
  // Network errors during page unload
  'net::ERR_ABORTED',
  // Map tile font loading errors (external resource)
  'tiles.openfreemap.org/fonts',
  'Failed to load resource: the server responded with a status of 404',
  // Generic map tile errors
  '.pbf',
  'openfreemap',
];

/**
 * Console message entry with full context
 */
export interface ConsoleEntry {
  type: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace';
  text: string;
  location: string | null;
  timestamp: Date;
  args: string[];
}

/**
 * API call entry for tracking network requests
 */
export interface ApiCallEntry {
  url: string;
  method: string;
  status: number | null;
  responseTime: number;
  error: string | null;
  timestamp: Date;
}

/**
 * ConsoleCollector - Captures and categorizes all console output
 */
export class ConsoleCollector {
  private entries: ConsoleEntry[] = [];
  private page: Page | null = null;
  private listener: ((msg: ConsoleMessage) => void) | null = null;

  /**
   * Start collecting console messages from the page
   */
  attach(page: Page): void {
    this.page = page;
    this.entries = [];

    this.listener = (message: ConsoleMessage) => {
      const entry: ConsoleEntry = {
        type: message.type() as ConsoleEntry['type'],
        text: message.text(),
        location: message.location().url || null,
        timestamp: new Date(),
        args: [],
      };

      // Try to get argument values
      try {
        const args = message.args();
        if (args.length > 0) {
          entry.args = args.map(arg => String(arg));
        }
      } catch {
        // Ignore serialization errors
      }

      this.entries.push(entry);
    };

    page.on('console', this.listener);
  }

  /**
   * Stop collecting and detach from page
   */
  detach(): void {
    if (this.page && this.listener) {
      this.page.off('console', this.listener);
    }
    this.page = null;
    this.listener = null;
  }

  /**
   * Get all collected entries
   */
  getAll(): ConsoleEntry[] {
    return [...this.entries];
  }

  /**
   * Get only error entries
   */
  getErrors(): ConsoleEntry[] {
    return this.entries.filter(e => e.type === 'error');
  }

  /**
   * Get only warning entries
   */
  getWarnings(): ConsoleEntry[] {
    return this.entries.filter(e => e.type === 'warn');
  }

  /**
   * Get critical errors (errors that are NOT in the acceptable list)
   */
  getCriticalErrors(): ConsoleEntry[] {
    return this.getErrors().filter(entry => {
      const text = entry.text.toLowerCase();
      return !KNOWN_ACCEPTABLE_ERRORS.some(pattern =>
        text.includes(pattern.toLowerCase())
      );
    });
  }

  /**
   * Check if there are any critical errors
   */
  hasCriticalErrors(): boolean {
    return this.getCriticalErrors().length > 0;
  }

  /**
   * Clear all collected entries
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Format all entries as a readable report
   */
  formatReport(): string {
    if (this.entries.length === 0) {
      return 'No console messages captured.';
    }

    const lines: string[] = ['=== Console Output Report ===\n'];

    const groupedByType = new Map<string, ConsoleEntry[]>();
    for (const entry of this.entries) {
      if (!groupedByType.has(entry.type)) {
        groupedByType.set(entry.type, []);
      }
      groupedByType.get(entry.type)!.push(entry);
    }

    // Report errors first
    if (groupedByType.has('error')) {
      lines.push(`\n--- ERRORS (${groupedByType.get('error')!.length}) ---`);
      for (const entry of groupedByType.get('error')!) {
        const isCritical = !KNOWN_ACCEPTABLE_ERRORS.some(p =>
          entry.text.toLowerCase().includes(p.toLowerCase())
        );
        lines.push(`[${isCritical ? 'CRITICAL' : 'acceptable'}] ${entry.text}`);
        if (entry.location) {
          lines.push(`  at: ${entry.location}`);
        }
      }
    }

    // Then warnings
    if (groupedByType.has('warn')) {
      lines.push(`\n--- WARNINGS (${groupedByType.get('warn')!.length}) ---`);
      for (const entry of groupedByType.get('warn')!) {
        lines.push(`[warn] ${entry.text}`);
      }
    }

    // Summary
    lines.push('\n--- Summary ---');
    lines.push(`Total messages: ${this.entries.length}`);
    lines.push(`Errors: ${this.getErrors().length} (${this.getCriticalErrors().length} critical)`);
    lines.push(`Warnings: ${this.getWarnings().length}`);

    return lines.join('\n');
  }
}

/**
 * ApiTracker - Tracks API calls and their outcomes
 */
export class ApiTracker {
  private calls: ApiCallEntry[] = [];
  private page: Page | null = null;
  private requestListener: ((request: any) => void) | null = null;
  private responseListener: ((response: Response) => void) | null = null;
  private failedListener: ((request: any) => void) | null = null;
  private pendingRequests: Map<string, { startTime: number; method: string; url: string }> = new Map();

  /**
   * Start tracking API calls
   * @param page Playwright page
   * @param urlPattern Optional pattern to filter URLs (default: /api|properties|health/)
   */
  attach(page: Page, urlPattern: RegExp = /api|properties|health|comments|guesses/i): void {
    this.page = page;
    this.calls = [];
    this.pendingRequests = new Map();

    this.requestListener = (request: any) => {
      const url = request.url();
      if (urlPattern.test(url)) {
        this.pendingRequests.set(request.url() + request.method(), {
          startTime: Date.now(),
          method: request.method(),
          url: request.url(),
        });
      }
    };

    this.responseListener = (response: Response) => {
      const url = response.url();
      const key = url + response.request().method();
      const pending = this.pendingRequests.get(key);

      if (pending) {
        this.calls.push({
          url: pending.url,
          method: pending.method,
          status: response.status(),
          responseTime: Date.now() - pending.startTime,
          error: response.status() >= 400 ? `HTTP ${response.status()}` : null,
          timestamp: new Date(),
        });
        this.pendingRequests.delete(key);
      }
    };

    this.failedListener = (request: any) => {
      const url = request.url();
      const key = url + request.method();
      const pending = this.pendingRequests.get(key);

      if (pending) {
        this.calls.push({
          url: pending.url,
          method: pending.method,
          status: null,
          responseTime: Date.now() - pending.startTime,
          error: request.failure()?.errorText || 'Request failed',
          timestamp: new Date(),
        });
        this.pendingRequests.delete(key);
      }
    };

    page.on('request', this.requestListener);
    page.on('response', this.responseListener);
    page.on('requestfailed', this.failedListener);
  }

  /**
   * Stop tracking and detach from page
   */
  detach(): void {
    if (this.page) {
      if (this.requestListener) this.page.off('request', this.requestListener);
      if (this.responseListener) this.page.off('response', this.responseListener);
      if (this.failedListener) this.page.off('requestfailed', this.failedListener);
    }
    this.page = null;
    this.requestListener = null;
    this.responseListener = null;
    this.failedListener = null;
  }

  /**
   * Get all tracked API calls
   */
  getAll(): ApiCallEntry[] {
    return [...this.calls];
  }

  /**
   * Get only failed API calls
   */
  getFailed(): ApiCallEntry[] {
    return this.calls.filter(c => c.error !== null || (c.status && c.status >= 400));
  }

  /**
   * Get calls to a specific endpoint pattern
   */
  getByPattern(pattern: RegExp): ApiCallEntry[] {
    return this.calls.filter(c => pattern.test(c.url));
  }

  /**
   * Check if any API calls failed
   */
  hasFailures(): boolean {
    return this.getFailed().length > 0;
  }

  /**
   * Format a report of all API calls
   */
  formatReport(): string {
    if (this.calls.length === 0) {
      return 'No API calls tracked.';
    }

    const lines: string[] = ['=== API Calls Report ===\n'];

    for (const call of this.calls) {
      const status = call.status ? `${call.status}` : 'FAILED';
      const icon = call.error ? '[X]' : '[OK]';
      lines.push(`${icon} ${call.method} ${call.url}`);
      lines.push(`    Status: ${status}, Time: ${call.responseTime}ms`);
      if (call.error) {
        lines.push(`    Error: ${call.error}`);
      }
    }

    lines.push('\n--- Summary ---');
    lines.push(`Total calls: ${this.calls.length}`);
    lines.push(`Successful: ${this.calls.length - this.getFailed().length}`);
    lines.push(`Failed: ${this.getFailed().length}`);

    return lines.join('\n');
  }
}

/**
 * Screenshot helper with annotation and organization
 */
export class ScreenshotHelper {
  private page: Page;
  private testName: string;
  private screenshotCount: number = 0;
  private screenshotPaths: string[] = [];

  constructor(page: Page, testName: string) {
    this.page = page;
    this.testName = this.sanitizeFilename(testName);
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  }

  /**
   * Take a screenshot with a descriptive name
   */
  async capture(name: string, options?: { fullPage?: boolean }): Promise<string> {
    this.screenshotCount++;
    const filename = `${String(this.screenshotCount).padStart(2, '0')}-${this.sanitizeFilename(name)}.png`;
    const filepath = path.join(VISUAL_SCREENSHOT_DIR, this.testName, filename);

    await this.page.screenshot({
      path: filepath,
      fullPage: options?.fullPage ?? true,
    });

    this.screenshotPaths.push(filepath);
    return filepath;
  }

  /**
   * Get all screenshot paths taken in this test
   */
  getScreenshotPaths(): string[] {
    return [...this.screenshotPaths];
  }

  /**
   * Get the directory for this test's screenshots
   */
  getScreenshotDir(): string {
    return path.join(VISUAL_SCREENSHOT_DIR, this.testName);
  }
}

/**
 * Page state validators
 */
export class PageValidator {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Check if the page shows any visible error messages
   */
  async hasVisibleErrors(): Promise<{ hasError: boolean; errorText: string | null }> {
    const errorPatterns = [
      'Something went wrong',
      'Failed to load',
      'Error',
      'Oops',
      'Unable to',
      'Cannot load',
      'Network error',
      'Server error',
      'Application error',
      'Unexpected error',
    ];

    for (const pattern of errorPatterns) {
      const locator = this.page.locator(`text=${pattern}`).first();
      try {
        const isVisible = await locator.isVisible({ timeout: 1000 });
        if (isVisible) {
          const text = await locator.textContent();
          return { hasError: true, errorText: text };
        }
      } catch {
        // Element not found or not visible, continue
      }
    }

    return { hasError: false, errorText: null };
  }

  /**
   * Check if the page is blank (no meaningful content)
   */
  async isPageBlank(): Promise<boolean> {
    // Check if body has any text content
    const body = this.page.locator('body');
    const text = await body.textContent();

    if (!text || text.trim().length < 10) {
      return true;
    }

    // Check if there are any visible elements besides basic structure
    const visibleElements = await this.page.locator('body *:visible').count();
    return visibleElements < 5;
  }

  /**
   * Wait for the page to be fully loaded and interactive
   */
  async waitForReady(timeout: number = 30000): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded', { timeout });
    await this.page.waitForLoadState('networkidle', { timeout }).catch(() => {
      // Network might not go idle if there are websockets, that's ok
    });

    // Additional wait for React/RN to hydrate
    await this.page.waitForTimeout(1000);
  }

  /**
   * Check if the map canvas is visible and rendered
   */
  async isMapVisible(): Promise<boolean> {
    const mapSelectors = [
      'canvas',
      '[data-testid="map-view"]',
      '.maplibregl-map',
      '.mapboxgl-map',
    ];

    for (const selector of mapSelectors) {
      try {
        const element = this.page.locator(selector).first();
        const isVisible = await element.isVisible({ timeout: 5000 });
        if (isVisible) {
          return true;
        }
      } catch {
        // Continue to next selector
      }
    }

    return false;
  }
}

/**
 * Combined test context for visual E2E tests
 */
export class VisualTestContext {
  public console: ConsoleCollector;
  public api: ApiTracker;
  public screenshots: ScreenshotHelper;
  public validator: PageValidator;
  private page: Page;
  private testName: string;

  constructor(page: Page, testName: string) {
    this.page = page;
    this.testName = testName;
    this.console = new ConsoleCollector();
    this.api = new ApiTracker();
    this.screenshots = new ScreenshotHelper(page, testName);
    this.validator = new PageValidator(page);
  }

  /**
   * Start all tracking
   */
  start(): void {
    this.console.attach(this.page);
    this.api.attach(this.page);
  }

  /**
   * Stop all tracking
   */
  stop(): void {
    this.console.detach();
    this.api.detach();
  }

  /**
   * Generate a full test report
   */
  generateReport(): string {
    const lines: string[] = [
      `\n${'='.repeat(60)}`,
      `VISUAL TEST REPORT: ${this.testName}`,
      `${'='.repeat(60)}\n`,
    ];

    // Console report
    lines.push(this.console.formatReport());
    lines.push('\n');

    // API report
    lines.push(this.api.formatReport());
    lines.push('\n');

    // Screenshots
    const screenshots = this.screenshots.getScreenshotPaths();
    lines.push('=== Screenshots ===\n');
    if (screenshots.length > 0) {
      for (const path of screenshots) {
        lines.push(`  - ${path}`);
      }
    } else {
      lines.push('  No screenshots taken.');
    }

    lines.push(`\n${'='.repeat(60)}\n`);

    return lines.join('\n');
  }

  /**
   * Assert no critical errors occurred
   */
  assertNoCriticalErrors(): void {
    const criticalErrors = this.console.getCriticalErrors();
    if (criticalErrors.length > 0) {
      const errorMessages = criticalErrors.map(e => e.text).join('\n  - ');
      throw new Error(`Critical console errors found:\n  - ${errorMessages}`);
    }
  }

  /**
   * Assert no API failures occurred
   */
  assertNoApiFailures(): void {
    const failures = this.api.getFailed();
    if (failures.length > 0) {
      const failureMessages = failures.map(f => `${f.method} ${f.url}: ${f.error}`).join('\n  - ');
      throw new Error(`API failures found:\n  - ${failureMessages}`);
    }
  }
}

/**
 * Create a visual test context for a test
 */
export function createVisualTestContext(page: Page, testName: string): VisualTestContext {
  return new VisualTestContext(page, testName);
}
