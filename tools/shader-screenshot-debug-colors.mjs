#!/usr/bin/env node
/**
 * Screenshots each shader commit from today (2026-03-12) with DEBUG_BUILDING_COLORS
 * forcibly enabled, so we can compare hash distribution across commits.
 *
 * For each commit (oldest→newest) + uncommitted working tree:
 *   1. git checkout the commit (or stash-pop for working tree)
 *   2. Inject/enable #define DEBUG_BUILDING_COLORS in fragment shader
 *   3. npm run generate-shaders && npm run build-dist
 *   4. Copy dist/ into pnpm store, clear Metro cache
 *   5. Hard-refresh browser, wait for map render
 *   6. Save screenshot
 *   7. Restore fragment shader (git checkout -- fragment shader)
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
const FRAG_SHADER = path.join(FORK_DIR, 'src/shaders/fill_extrusion.fragment.glsl');

// Today's commits oldest→newest
const COMMITS = execSync(
  `git -C "${FORK_DIR}" log --reverse --format="%h %s" --since="2026-03-12T00:00:00" ${ORIGINAL_BRANCH}`
).toString().trim().split('\n').filter(Boolean).map(line => {
  const [hash, ...msgParts] = line.split(' ');
  return { hash, msg: msgParts.join(' ') };
});

console.log(`Found ${COMMITS.length} commits from today to screenshot.`);
console.log('Plus 1 for uncommitted working tree state.\n');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function syncForkToPnpm() {
  execSync(`rm -f "${PNPM_DIST}"/maplibre-gl*.js "${PNPM_DIST}"/maplibre-gl*.js.map 2>/dev/null || true`, { stdio: 'pipe' });
  execSync(`cp "${FORK_DIR}"/dist/maplibre-gl*.js "${PNPM_DIST}/"`, { stdio: 'pipe' });
  execSync(`cp "${FORK_DIR}"/dist/maplibre-gl*.js.map "${PNPM_DIST}/" 2>/dev/null || true`, { stdio: 'pipe' });
}

function clearMetroCache() {
  execSync(`rm -rf /tmp/metro-cache/* /tmp/metro-* /tmp/haste-map-* 2>/dev/null || true`, { stdio: 'pipe' });
}

/** Ensure DEBUG_BUILDING_COLORS is active in the fragment shader. */
function enableDebugColors() {
  let src = fs.readFileSync(FRAG_SHADER, 'utf8');

  if (src.includes('#define DEBUG_BUILDING_COLORS')) {
    // Already enabled
    return;
  }

  if (src.includes('#ifdef DEBUG_BUILDING_COLORS')) {
    // Has the ifdef block but no #define — inject it right before the #ifdef
    src = src.replace(
      '#ifdef DEBUG_BUILDING_COLORS',
      '#define DEBUG_BUILDING_COLORS\n#ifdef DEBUG_BUILDING_COLORS'
    );
    fs.writeFileSync(FRAG_SHADER, src);
    return;
  }

  // Earliest commits have inline debug colors (directly set debug_color) — already visible
  if (src.includes('debug_color') || src.includes('DEBUG')) {
    return;
  }

  // No debug code at all — inject after "float body_hash = v_body_hash;"
  // This shouldn't happen for today's commits, but just in case
  console.log('    WARNING: No debug color code found, injecting...');
  src = src.replace(
    'float body_hash = v_body_hash;',
    `float body_hash = v_body_hash;
    float h2 = fract(body_hash * 7.31);
    float h3 = fract(body_hash * 13.17);
    vec3 body_color = vec3(0.65 + 0.35 * body_hash, 0.65 + 0.35 * h2, 0.65 + 0.35 * h3);
    fragColor.rgb = body_color;
    fragColor.a = v_color.a;`
  );
  fs.writeFileSync(FRAG_SHADER, src);
}

function buildShaders() {
  execSync('npm run generate-shaders', { cwd: FORK_DIR, stdio: 'pipe' });
  execSync('npm run build-dist', { cwd: FORK_DIR, stdio: 'pipe', timeout: 300000 });
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
  // Stash uncommitted changes so we can checkout commits cleanly
  console.log('Stashing uncommitted changes...');
  const hasChanges = execSync(`git -C "${FORK_DIR}" status --porcelain`).toString().trim().length > 0;
  if (hasChanges) {
    execSync(`git -C "${FORK_DIR}" stash push -m "shader-screenshot-debug-colors" --include-untracked`, { stdio: 'pipe' });
    console.log('Stashed.\n');
  } else {
    console.log('No changes to stash.\n');
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 960 },
  });
  const page = await context.newPage();

  console.log('Initial page load...');
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  const totalSteps = COMMITS.length + (hasChanges ? 1 : 0);

  for (let i = 0; i < COMMITS.length; i++) {
    const { hash, msg } = COMMITS[i];
    const num = String(i + 1).padStart(2, '0');
    const filename = `${num}-${hash}-debug.png`;
    console.log(`\n[${num}/${totalSteps}] ${hash} — ${msg}`);

    // 1. Clean build artifacts (dist/ is gitignored but blocks checkout) + generated files
    execSync(`git -C "${FORK_DIR}" checkout -- src/shaders/ 2>/dev/null || true`, { stdio: 'pipe' });
    execSync(`rm -f "${FORK_DIR}"/dist/maplibre-gl*.js "${FORK_DIR}"/dist/maplibre-gl*.js.map 2>/dev/null || true`, { stdio: 'pipe' });

    // Checkout
    execSync(`git -C "${FORK_DIR}" checkout ${hash} --quiet 2>&1`);
    console.log('    Checked out');

    // 2. Enable debug colors
    enableDebugColors();
    console.log('    Debug colors enabled');

    // 3. Build
    console.log('    Building shaders + dist...');
    buildShaders();
    console.log('    Built');

    // 4. Sync + clear cache
    syncForkToPnpm();
    clearMetroCache();
    console.log('    Synced to pnpm, cache cleared');

    // 5. Reload
    await page.waitForTimeout(2000);
    await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
    console.log('    Page reloaded');

    // 6. Wait for render
    await page.waitForTimeout(8000);
    await waitForMapRender(page);
    await page.waitForTimeout(2000);
    console.log('    Map rendered');

    // 7. Screenshot
    const filepath = path.join(OUTPUT_DIR, filename);
    await page.screenshot({ path: filepath, type: 'png' });
    console.log(`    Saved: ${filename}`);

    // 8. Restore fragment shader for clean checkout of next commit
    execSync(`git -C "${FORK_DIR}" checkout -- "${FRAG_SHADER}"`, { stdio: 'pipe' });
  }

  // Final: screenshot the uncommitted working tree state
  if (hasChanges) {
    const num = String(COMMITS.length + 1).padStart(2, '0');
    const filename = `${num}-working-tree-debug.png`;
    console.log(`\n[${num}/${totalSteps}] Working tree (uncommitted changes)`);

    // Clean dist/ artifacts, restore branch, then pop stash
    execSync(`git -C "${FORK_DIR}" checkout -- src/shaders/ 2>/dev/null || true`, { stdio: 'pipe' });
    execSync(`rm -rf "${FORK_DIR}/dist" 2>/dev/null || true`, { stdio: 'pipe' });
    execSync(`git -C "${FORK_DIR}" checkout ${ORIGINAL_BRANCH} --quiet 2>&1`);
    execSync(`git -C "${FORK_DIR}" stash pop --quiet`, { stdio: 'pipe' });
    console.log('    Restored working tree');

    // Enable debug colors (should already be enabled in current state)
    enableDebugColors();
    console.log('    Debug colors enabled');

    // Build
    console.log('    Building shaders + dist...');
    buildShaders();
    console.log('    Built');

    // Sync + clear cache
    syncForkToPnpm();
    clearMetroCache();
    console.log('    Synced to pnpm, cache cleared');

    // Reload
    await page.waitForTimeout(2000);
    await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
    console.log('    Page reloaded');

    // Wait for render
    await page.waitForTimeout(8000);
    await waitForMapRender(page);
    await page.waitForTimeout(2000);
    console.log('    Map rendered');

    // Screenshot
    const filepath = path.join(OUTPUT_DIR, filename);
    await page.screenshot({ path: filepath, type: 'png' });
    console.log(`    Saved: ${filename}`);
  } else {
    // No uncommitted changes — just restore branch
    console.log('\nRestoring fork to huishype branch...');
    execSync(`git -C "${FORK_DIR}" checkout ${ORIGINAL_BRANCH} --quiet 2>&1`);
  }

  // Final sync so the working state matches what's deployed
  syncForkToPnpm();
  clearMetroCache();
  console.log('\nDone! Fork is back on huishype branch with working tree intact.');

  await browser.close();
  process.exit(0);
})();
