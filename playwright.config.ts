import { defineConfig } from '@playwright/test';
import { createPlaywrightConfig } from './scripts/playwright/config.mjs';

export default defineConfig(createPlaywrightConfig());
