#!/usr/bin/env node
/**
 * Automates screenshots of each shader commit in the maplibre-gl-js fork.
 * For each commit (oldest→newest):
 *   1. git checkout the commit in the fork
 *   2. Copy dist/ into the pnpm store so Metro picks it up
 *   3. Hard-refresh the browser page
 *   4. Wait for the 3D map to fully render
 *   5. Save a screenshot
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/caslan/dev/git_repos/hh/huishype/node_modules/.pnpm/playwright@1.58.0/node_modules/playwright');
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const FORK_DIR = '/home/caslan/dev/git_repos/hh/maplibre-gl-js';
const PNPM_DIST = '/home/caslan/dev/git_repos/hh/huishype/node_modules/.pnpm/maplibre-gl@file+..+maplibre-gl-js/node_modules/maplibre-gl/dist';
const OUTPUT_DIR = '/home/caslan/dev/git_repos/hh/huishype/shader-progress-screenshots';
const APP_URL = 'http://localhost:8081';
const ORIGINAL_BRANCH = 'huishype';

// Commits oldest→newest (from git log --reverse --since=2026-03-04)
const COMMITS = execSync(
  `git -C "${FORK_DIR}" log --reverse --format="%h %s" --since="2026-03-04" --until="2026-03-12"`
).toString().trim().split('\n').map(line => {
  const [hash, ...msgParts] = line.split(' ');
  return { hash, msg: msgParts.join(' ') };
});

console.log(`Found ${COMMITS.length} commits to screenshot.\n`);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

/** Copy dist/ from fork into pnpm store so Metro serves the new code.
 *  pnpm copies (not links) dist/ files, so we must overwrite them. */
function syncForkToPnpm() {
  // Remove old dist files first, then copy fresh ones (avoids "same file" errors from hardlinks)
  execSync(`rm -f "${PNPM_DIST}"/maplibre-gl*.js "${PNPM_DIST}"/maplibre-gl*.js.map 2>/dev/null || true`, { stdio: 'pipe' });
  execSync(`cp "${FORK_DIR}"/dist/maplibre-gl*.js "${PNPM_DIST}/"`, { stdio: 'pipe' });
  execSync(`cp "${FORK_DIR}"/dist/maplibre-gl*.js.map "${PNPM_DIST}/" 2>/dev/null || true`, { stdio: 'pipe' });
}

async function waitForMapRender(page, timeoutMs = 45000) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.maplibregl-canvas');
    if (!canvas) return false;
    const map = window.__mapRef?.current?.getMap?.() || window._mapInstance;
    if (map && map.isStyleLoaded && map.isStyleLoaded()) return true;
    return canvas.width > 0 && canvas.height > 0;
  }, { timeout: timeoutMs }).catch(() => {
    console.log('    (map load check timed out, taking screenshot anyway)');
  });
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 960 },
  });
  const page = await context.newPage();

  // First load — let Metro compile the initial bundle
  console.log('Initial page load...');
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  for (let i = 0; i < COMMITS.length; i++) {
    const { hash, msg } = COMMITS[i];
    const num = String(i + 1).padStart(2, '0');
    const filename = `${num}-${hash}.png`;
    console.log(`\n[${num}/${COMMITS.length}] ${hash} — ${msg}`);

    // 1. Checkout commit in the fork
    execSync(`git -C "${FORK_DIR}" checkout ${hash} --quiet 2>&1`);
    console.log('    Checked out');

    // 2. Copy fork dist/ into pnpm store
    syncForkToPnpm();
    console.log('    Synced dist to pnpm store');

    // 3. Clear Metro's transform cache so it re-reads the new dist files.
    // Metro caches transformed modules in /tmp/metro-cache — removing
    // the maplibre-gl entries forces a re-transform on next request.
    execSync(`find /tmp/metro-cache -name "*.js" -newer /tmp/.shader-screenshot-marker -delete 2>/dev/null; touch /tmp/.shader-screenshot-marker`, { stdio: 'pipe' });
    // Also nuke the entire metro cache to be safe — it rebuilds fast
    execSync(`rm -rf /tmp/metro-cache/*`, { stdio: 'pipe' });
    await page.waitForTimeout(2000);

    // 4. Hard refresh (bypass cache)
    await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
    console.log('    Page reloaded');

    // 5. Wait for map to render
    await page.waitForTimeout(8000);
    await waitForMapRender(page);
    await page.waitForTimeout(2000);
    console.log('    Map rendered');

    // 6. Screenshot
    const filepath = path.join(OUTPUT_DIR, filename);
    await page.screenshot({ path: filepath, type: 'png' });
    console.log(`    Saved: ${filename}`);
  }

  // Restore the fork to the original branch and sync
  console.log('\nRestoring fork to huishype branch...');
  execSync(`git -C "${FORK_DIR}" checkout ${ORIGINAL_BRANCH} --quiet 2>&1`);
  syncForkToPnpm();
  console.log('Done! Restored fork to huishype branch.');

  await browser.close();
  process.exit(0);
})();
