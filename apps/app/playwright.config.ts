import { defineConfig } from '@playwright/test';
import { createPlaywrightConfig } from '../../scripts/playwright/config.mjs';

// Compatibility entrypoint for local invocations. The supported web harness is
// the same shared static-export runtime used by the root Playwright config.
export default defineConfig(createPlaywrightConfig());
