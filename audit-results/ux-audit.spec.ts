/**
 * UX Interaction Audit - Playwright Test Suite
 */
import { test, Page, ConsoleMessage } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:8081';
const SS_DIR = '/home/caslan/dev/git_repos/hh/huishype/audit-results/screenshots';
const REPORT = '/home/caslan/dev/git_repos/hh/huishype/audit-results/ux-interaction-audit.md';

interface Issue { flow: string; severity: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'; desc: string; expected: string; actual: string; }
interface FlowResult { name: string; status: 'PASS'|'FAIL'|'PARTIAL'; issues: Issue[]; notes: string[]; screenshots: string[]; }

const KNOWN = [/Failed to load resource.*openfree/i, /Failed to load resource.*fonts/, /maplibre|mapbox/i, /pointerEvents is deprecated/, /Download the React DevTools/, /Bridgeless/, /findDOMNode/, /React does not recognize/, /Each child in a list/, /Warning:/, /DevTools/];
function isKnown(m: string) { return KNOWN.some(p => p.test(m)); }

const results: FlowResult[] = [];
const allErrors: string[] = [];

async function snap(page: Page, name: string) {
  const f = path.join(SS_DIR, `${name}.png`);
  await page.screenshot({ path: f });
  return f;
}

async function waitMap(page: Page) {
  try {
    await page.waitForFunction(() => document.querySelectorAll('.maplibregl-canvas').length > 0, { timeout: 60000 });
    return true;
  } catch { return false; }
}

test.describe.serial('UX Audit', () => {
  test.beforeAll(() => { fs.mkdirSync(SS_DIR, { recursive: true }); });

  function setupConsole(page: Page, errors: string[]) {
    page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error') { errors.push(m.text()); allErrors.push(m.text()); } });
    page.on('pageerror', (e: Error) => { errors.push(`PAGE: ${e.message}`); allErrors.push(`PAGE: ${e.message}`); });
  }

  test('1. Map Load', async ({ page }) => {
    const r: FlowResult = { name: '1. Map Load & Initial State', status: 'PASS', issues: [], notes: [], screenshots: [] };
    const errs: string[] = [];
    setupConsole(page, errs);

    const t0 = Date.now();
    await page.goto(BASE_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });

    const loading = await page.evaluate(() => {
      const h = document.body?.innerHTML?.toLowerCase() || '';
      return h.includes('loading') || !!document.querySelector('[role="progressbar"],.loading,.spinner');
    });
    r.notes.push(`Loading indicator: ${loading}`);

    const ok = await waitMap(page);
    r.notes.push(`Map loaded: ${ok} (${Date.now() - t0}ms)`);
    if (!ok) {
      r.status = 'FAIL';
      r.issues.push({ flow: r.name, severity: 'CRITICAL', desc: 'Map failed to load', expected: 'Map within 60s', actual: 'Timeout' });
    }

    if (ok) await page.waitForTimeout(3000);
    r.screenshots.push(await snap(page, '01-initial'));

    const state = await page.evaluate(() => {
      const m = (window as any).__mapInstance;
      if (!m) return null;
      const c = m.getCenter();
      return { lat: c.lat, lng: c.lng, zoom: m.getZoom() };
    });
    if (state) {
      r.notes.push(`Center: ${state.lat.toFixed(4)}, ${state.lng.toFixed(4)}, Zoom: ${state.zoom.toFixed(2)}`);
      if (state.lat < 50.5 || state.lat > 53.7 || state.lng < 3.3 || state.lng > 7.3) {
        r.issues.push({ flow: r.name, severity: 'MEDIUM', desc: 'Not centered on NL', expected: 'NL bounds', actual: `${state.lat.toFixed(2)},${state.lng.toFixed(2)}` });
      }
    } else {
      r.notes.push('No __mapInstance exposed');
    }

    const zoom = await page.evaluate(() => !!document.querySelector('.maplibregl-ctrl-zoom-in'));
    r.notes.push(`Zoom controls: ${zoom}`);
    if (!zoom) r.issues.push({ flow: r.name, severity: 'LOW', desc: 'No zoom controls', expected: 'Zoom buttons', actual: 'Not found' });

    const zoomText = await page.evaluate(() => { const m = document.body.innerText.match(/[Zz]oom[\s:]*(\d+\.?\d*)/); return m?.[0] ?? null; });
    r.notes.push(`Zoom indicator text: ${zoomText || 'none'}`);

    const real = errs.filter(e => !isKnown(e));
    r.notes.push(`Console errors: ${real.length} non-known`);
    if (real.length) r.issues.push({ flow: r.name, severity: 'MEDIUM', desc: `${real.length} console errors`, expected: 'None', actual: real.slice(0, 3).join(' | ').substring(0, 300) });

    if (r.issues.some(i => i.severity === 'CRITICAL')) r.status = 'FAIL';
    else if (r.issues.length) r.status = 'PARTIAL';
    results.push(r);
  });

  test('2. Pan & Zoom', async ({ page }) => {
    const r: FlowResult = { name: '2. Map Interaction (Pan & Zoom)', status: 'PASS', issues: [], notes: [], screenshots: [] };
    const errs: string[] = [];
    setupConsole(page, errs);

    await page.goto(BASE_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await waitMap(page);
    await page.waitForTimeout(2000);

    const box = await (await page.$('.maplibregl-map'))?.boundingBox();
    if (!box) { r.status = 'FAIL'; r.issues.push({ flow: r.name, severity: 'CRITICAL', desc: 'No map element', expected: 'Map', actual: 'None' }); results.push(r); return; }

    // Zoom via scroll
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const z0 = await page.evaluate(() => (window as any).__mapInstance?.getZoom());
    for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(300); }
    await page.waitForTimeout(1500);
    const z1 = await page.evaluate(() => (window as any).__mapInstance?.getZoom());
    r.notes.push(`Zoom: ${z0?.toFixed?.(2) ?? 'N/A'} -> ${z1?.toFixed?.(2) ?? 'N/A'}`);
    if (z0 !== undefined && z1 !== undefined && z1 <= z0) {
      r.issues.push({ flow: r.name, severity: 'HIGH', desc: 'Scroll zoom did not work', expected: 'Zoom increased', actual: `${z0} -> ${z1}` });
    }
    r.screenshots.push(await snap(page, '02a-zoomed'));

    // Pan
    const c0 = await page.evaluate(() => { const m = (window as any).__mapInstance; if (!m) return null; const c = m.getCenter(); return { lat: c.lat, lng: c.lng }; });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1000);
    const c1 = await page.evaluate(() => { const m = (window as any).__mapInstance; if (!m) return null; const c = m.getCenter(); return { lat: c.lat, lng: c.lng }; });
    if (c0 && c1) {
      const moved = Math.abs(c0.lat - c1.lat) > 0.0001 || Math.abs(c0.lng - c1.lng) > 0.0001;
      r.notes.push(`Pan: ${moved ? 'worked' : 'FAILED'}`);
      if (!moved) r.issues.push({ flow: r.name, severity: 'HIGH', desc: 'Pan did not work', expected: 'Map moved', actual: 'Same center' });
    }
    r.screenshots.push(await snap(page, '02b-panned'));

    // Rendered features
    const fi = await page.evaluate(() => {
      const m = (window as any).__mapInstance;
      if (!m) return { count: 0, sources: [] };
      const f = m.queryRenderedFeatures();
      return { count: f.length, sources: [...new Set(f.map((x: any) => x.source).filter(Boolean))] };
    });
    r.notes.push(`Features: ${fi.count}, Sources: ${JSON.stringify(fi.sources)}`);

    if (r.issues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH')) r.status = 'FAIL';
    else if (r.issues.length) r.status = 'PARTIAL';
    results.push(r);
  });

  test('3. Property Click', async ({ page }) => {
    const r: FlowResult = { name: '3. Property Click -> Preview', status: 'PASS', issues: [], notes: [], screenshots: [] };
    const errs: string[] = [];
    setupConsole(page, errs);

    await page.goto(BASE_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await waitMap(page);
    await page.waitForTimeout(2000);

    // Fly to Eindhoven z16
    await page.evaluate(() => { const m = (window as any).__mapInstance; if (m) m.flyTo({ center: [5.4697, 51.4416], zoom: 16, duration: 0 }); });
    await page.waitForTimeout(5000);
    r.screenshots.push(await snap(page, '03a-eindhoven'));

    const info = await page.evaluate(() => {
      const m = (window as any).__mapInstance;
      if (!m) return { found: false, count: 0, layers: [], sources: [] };
      const all = m.queryRenderedFeatures();
      const pts = all.filter((f: any) => f.geometry?.type === 'Point');
      return {
        found: pts.length > 0,
        count: pts.length,
        total: all.length,
        layers: [...new Set(all.map((f: any) => f.layer?.id).filter(Boolean))].slice(0, 20),
        sources: [...new Set(all.map((f: any) => f.source).filter(Boolean))],
        sampleKeys: pts[0] ? Object.keys(pts[0].properties || {}) : []
      };
    });
    r.notes.push(`Features total: ${info.total}, Points: ${info.count}`);
    r.notes.push(`Layers: ${JSON.stringify(info.layers)}`);
    r.notes.push(`Sources: ${JSON.stringify(info.sources)}`);
    if (info.sampleKeys.length) r.notes.push(`Sample props: ${JSON.stringify(info.sampleKeys)}`);

    if (info.found) {
      const target = await page.evaluate(() => {
        const m = (window as any).__mapInstance;
        if (!m) return null;
        const pts = m.queryRenderedFeatures().filter((f: any) => f.geometry?.type === 'Point');
        if (!pts.length) return null;
        const p = m.project(pts[0].geometry.coordinates);
        return { x: p.x, y: p.y, props: pts[0].properties };
      });

      if (target) {
        const mb = await (await page.$('.maplibregl-map'))?.boundingBox();
        if (mb) {
          r.notes.push(`Clicking at (${target.x.toFixed(0)}, ${target.y.toFixed(0)})`);
          if (target.props) r.notes.push(`Feature props: ${JSON.stringify(target.props).substring(0, 300)}`);

          await page.mouse.click(mb.x + target.x, mb.y + target.y);
          await page.waitForTimeout(3000);
          r.screenshots.push(await snap(page, '03b-clicked'));

          const after = await page.evaluate(() => {
            return {
              popups: document.querySelectorAll('.maplibregl-popup').length,
              dialogs: document.querySelectorAll('[role="dialog"]').length,
              sheets: document.querySelectorAll('[class*="sheet" i]').length,
              hasAddr: /\w+straat|\w+weg|\w+laan|\w+ring|\w+plein|\w+singel/i.test(document.body.innerText),
              hasPrice: /€\s*\d/.test(document.body.innerText),
              text: document.body.innerText.substring(0, 500)
            };
          });
          r.notes.push(`After click: popups=${after.popups} dialogs=${after.dialogs} sheets=${after.sheets}`);
          r.notes.push(`Address: ${after.hasAddr}, Price: ${after.hasPrice}`);
          if (!after.popups && !after.dialogs && !after.sheets) {
            r.notes.push(`Page text: ${after.text}`);
          }
        }
      }
    } else {
      r.issues.push({ flow: r.name, severity: 'HIGH', desc: 'No point features at z16', expected: 'Property markers', actual: `${info.count} points of ${info.total} total` });
    }

    if (r.issues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH')) r.status = 'FAIL';
    else if (r.issues.length) r.status = 'PARTIAL';
    results.push(r);
  });

  test('5. Search', async ({ page }) => {
    const r: FlowResult = { name: '5. Search Flow', status: 'PASS', issues: [], notes: [], screenshots: [] };
    const errs: string[] = [];
    setupConsole(page, errs);

    await page.goto(BASE_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await waitMap(page);
    await page.waitForTimeout(2000);

    // Find search input
    const sels = ['input[placeholder*="search" i]', 'input[placeholder*="address" i]', 'input[placeholder*="zoek" i]', 'input[type="search"]', 'input[type="text"]'];
    let si = null;
    for (const s of sels) { const el = await page.$(s); if (el && await el.isVisible()) { si = el; r.notes.push(`Search found: ${s}`); break; } }

    if (!si) {
      // List all inputs for debugging
      const inputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('input')).map(el => {
          const rect = el.getBoundingClientRect();
          return { type: el.type, placeholder: el.placeholder, w: rect.width, h: rect.height, class: el.className.substring(0, 80) };
        }).filter(i => i.w > 0);
      });
      r.notes.push(`Visible inputs: ${JSON.stringify(inputs)}`);
      r.issues.push({ flow: r.name, severity: 'HIGH', desc: 'No search bar found', expected: 'Visible search', actual: `${inputs.length} inputs` });
      r.status = 'FAIL';
      r.screenshots.push(await snap(page, '05-no-search'));
      results.push(r);
      return;
    }

    r.screenshots.push(await snap(page, '05a-search'));
    await si.click();
    await si.fill('');
    await page.keyboard.type('Beeldbuisring 41', { delay: 80 });
    await page.waitForTimeout(3000);
    r.screenshots.push(await snap(page, '05b-typing'));

    const ac = await page.evaluate(() => {
      const items = document.querySelectorAll('[role="option"], [role="listbox"] > *, li');
      const text = document.body.innerText;
      const txts: string[] = [];
      items.forEach(i => { const t = i.textContent?.trim(); if (t && t.length < 200) txts.push(t); });
      return { items: items.length, match: /Beeldbuisring|Eindhoven/i.test(text), samples: txts.slice(0, 5) };
    });
    r.notes.push(`Autocomplete: ${ac.items} items, match=${ac.match}`);
    if (ac.samples.length) r.notes.push(`Results: ${ac.samples.join(' | ')}`);

    if (!ac.match && ac.items === 0) {
      r.issues.push({ flow: r.name, severity: 'HIGH', desc: 'No autocomplete results', expected: 'PDOK suggestions', actual: 'Nothing' });
    }

    // Click result
    const re = await page.$('text=Beeldbuisring');
    if (re) {
      await re.click();
      await page.waitForTimeout(4000);
      r.screenshots.push(await snap(page, '05c-navigated'));
      const center = await page.evaluate(() => { const m = (window as any).__mapInstance; if (!m) return null; const c = m.getCenter(); return { lat: c.lat, lng: c.lng, zoom: m.getZoom() }; });
      if (center) {
        r.notes.push(`After nav: ${center.lat.toFixed(4)},${center.lng.toFixed(4)} z${center.zoom.toFixed(2)}`);
        const near = center.lat > 51.3 && center.lat < 51.6 && center.lng > 5.3 && center.lng < 5.6;
        if (!near) r.issues.push({ flow: r.name, severity: 'MEDIUM', desc: 'Map not near Eindhoven', expected: 'Near ~51.4,5.5', actual: `${center.lat.toFixed(4)},${center.lng.toFixed(4)}` });
      }
    }

    if (r.issues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH')) r.status = 'FAIL';
    else if (r.issues.length) r.status = 'PARTIAL';
    results.push(r);
  });

  test('6-8. Property Detail + Social', async ({ page }) => {
    const r: FlowResult = { name: '6-8. Property Detail, Comments, Price Guess, Like/Save', status: 'PASS', issues: [], notes: [], screenshots: [] };
    const errs: string[] = [];
    setupConsole(page, errs);

    await page.goto(BASE_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await waitMap(page);
    await page.waitForTimeout(2000);

    // Search for Beeldbuisring 41
    const si = await page.$('input[placeholder*="search" i], input[placeholder*="address" i], input[placeholder*="zoek" i], input[type="search"], input[type="text"]');
    if (si && await si.isVisible()) {
      await si.click();
      await si.fill('');
      await page.keyboard.type('Beeldbuisring 41', { delay: 80 });
      await page.waitForTimeout(3000);
      const re = await page.$('text=Beeldbuisring');
      if (re) { await re.click(); await page.waitForTimeout(4000); }
    }
    r.screenshots.push(await snap(page, '06a-searched'));

    // Analyze full page state
    const d = await page.evaluate(() => {
      const t = document.body.innerText;
      const btns = document.querySelectorAll('button, [role="button"]');
      const actionInfo: string[] = [];
      btns.forEach(b => {
        const h = b.innerHTML?.toLowerCase() || '';
        const l = b.getAttribute('aria-label') || '';
        if (h.includes('heart') || l.toLowerCase().includes('like')) actionInfo.push('like-btn');
        if (h.includes('bookmark') || l.toLowerCase().includes('save')) actionInfo.push('save-btn');
      });
      return {
        addr: /Beeldbuisring/i.test(t),
        price: /€\s*\d/.test(t),
        woz: /WOZ/i.test(t),
        comments: /comment/i.test(t),
        guess: /guess|schat|estimate|fair market/i.test(t),
        links: /funda|pararius/i.test(t),
        slider: !!document.querySelector('input[type="range"], [role="slider"]'),
        commentInput: !!document.querySelector('textarea[placeholder*="comment" i], input[placeholder*="comment" i]'),
        actions: [...new Set(actionInfo)],
        dialogs: document.querySelectorAll('[role="dialog"]').length,
        body: t.substring(0, 2500)
      };
    });

    r.notes.push(`Address: ${d.addr}, Price: ${d.price}, WOZ: ${d.woz}`);
    r.notes.push(`Comments: ${d.comments}, PriceGuess: ${d.guess}, Links: ${d.links}`);
    r.notes.push(`Slider: ${d.slider}, CommentInput: ${d.commentInput}`);
    r.notes.push(`Actions: ${JSON.stringify(d.actions)}, Dialogs: ${d.dialogs}`);

    if (!d.comments) r.issues.push({ flow: r.name, severity: 'MEDIUM', desc: 'No comments section', expected: 'Comments visible', actual: 'Not found' });
    if (!d.guess && !d.slider) r.issues.push({ flow: r.name, severity: 'MEDIUM', desc: 'No price guess section', expected: 'Price guess/slider', actual: 'Not found' });

    r.notes.push(`\n--- Page text ---\n${d.body}\n--- End ---`);
    r.screenshots.push(await snap(page, '06b-detail'));

    if (r.issues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH')) r.status = 'FAIL';
    else if (r.issues.length) r.status = 'PARTIAL';
    results.push(r);
  });

  test('9. Feed Tab', async ({ page }) => {
    const r: FlowResult = { name: '9. Feed Tab', status: 'PASS', issues: [], notes: [], screenshots: [] };
    const errs: string[] = [];
    setupConsole(page, errs);

    await page.goto(BASE_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Find nav
    const nav = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a')).filter(l => l.getBoundingClientRect().width > 0 && (l.textContent?.trim()?.length ?? 0) < 50).map(l => ({ text: l.textContent?.trim(), href: l.getAttribute('href') }));
    });
    r.notes.push(`Nav links: ${JSON.stringify(nav)}`);

    const feed = await page.$('a[href*="feed"], a:has-text("Feed")');
    if (feed) await feed.click();
    else await page.goto(`${BASE_URL}/feed`, { timeout: 30000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    r.screenshots.push(await snap(page, '09a-feed'));

    const fs2 = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        cards: document.querySelectorAll('[class*="card" i], [class*="Card"]').length,
        imgs: document.querySelectorAll('img').length,
        prop: /€|bedroom|m²|woning/i.test(t),
        filter: document.querySelectorAll('[class*="filter" i], [class*="chip" i]').length > 0,
        empty: /no.*propert|no.*result|empty|geen/i.test(t),
        loading: document.querySelectorAll('[class*="skeleton" i], [class*="loading" i]').length > 0,
        text: t.substring(0, 1500)
      };
    });
    r.notes.push(`Cards: ${fs2.cards}, Images: ${fs2.imgs}, Property: ${fs2.prop}, Filter: ${fs2.filter}`);
    r.notes.push(`Empty: ${fs2.empty}, Loading: ${fs2.loading}`);
    r.notes.push(`Feed text: ${fs2.text}`);

    if (fs2.cards > 0) {
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(1000);
      r.screenshots.push(await snap(page, '09b-scrolled'));
    }

    if (r.issues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH')) r.status = 'FAIL';
    else if (r.issues.length) r.status = 'PARTIAL';
    results.push(r);
  });

  test('10. Auth', async ({ page }) => {
    const r: FlowResult = { name: '10. Auth Flow', status: 'PASS', issues: [], notes: [], screenshots: [] };
    const errs: string[] = [];
    setupConsole(page, errs);

    await page.goto(BASE_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const ae = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, [role="button"], a'));
      const auth = btns.filter(b => /login|sign|auth|profile|account|inlog/i.test(`${b.getAttribute('aria-label') || ''} ${b.textContent?.trim() || ''}`)).map(b => b.textContent?.trim()?.substring(0, 40));
      return { auth, loginText: /log\s*in|sign\s*in|inloggen/i.test(document.body.innerText) };
    });
    r.notes.push(`Auth buttons: ${JSON.stringify(ae.auth)}, Login text: ${ae.loginText}`);
    r.screenshots.push(await snap(page, '10-auth'));

    if (!ae.auth.length && !ae.loginText) r.issues.push({ flow: r.name, severity: 'LOW', desc: 'No proactive login button', expected: 'Login in nav', actual: 'Auth only via gates' });

    if (r.issues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH')) r.status = 'FAIL';
    else if (r.issues.length) r.status = 'PARTIAL';
    results.push(r);
  });

  test('11. Responsiveness', async ({ page }) => {
    const r: FlowResult = { name: '11. Responsiveness', status: 'PASS', issues: [], notes: [], screenshots: [] };

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await waitMap(page);
    await page.waitForTimeout(3000);
    r.screenshots.push(await snap(page, '11a-desktop'));

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(2000);
    r.screenshots.push(await snap(page, '11b-tablet'));

    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(2000);
    r.screenshots.push(await snap(page, '11c-mobile'));

    const ms = await page.evaluate(() => {
      const map = document.querySelector('.maplibregl-map');
      const mr = map?.getBoundingClientRect();
      return { body: document.body.clientWidth, mw: mr?.width, mh: mr?.height };
    });
    r.notes.push(`Mobile: body=${ms.body}, map=${ms.mw?.toFixed(0)}x${ms.mh?.toFixed(0)}`);
    r.screenshots.push(await snap(page, '11d-mobile-detail'));

    await page.setViewportSize({ width: 1440, height: 900 });
    results.push(r);
  });

  test('12. Console Health', async ({ page }) => {
    const r: FlowResult = { name: '12. Console Health & Edge Cases', status: 'PASS', issues: [], notes: [], screenshots: [] };
    const errs: string[] = [];
    setupConsole(page, errs);

    await page.goto(BASE_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await waitMap(page);
    await page.waitForTimeout(3000);

    // Navigate around to trigger errors
    await page.evaluate(() => { const m = (window as any).__mapInstance; if (m) m.flyTo({ center: [5.4697, 51.4416], zoom: 18, duration: 0 }); });
    await page.waitForTimeout(3000);
    await page.evaluate(() => { const m = (window as any).__mapInstance; if (m) m.flyTo({ center: [4.8952, 52.3702], zoom: 10, duration: 0 }); });
    await page.waitForTimeout(3000);

    const h = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      let broken = 0;
      imgs.forEach(i => { if (i.naturalWidth === 0 && i.complete) broken++; });
      return { errors: document.querySelectorAll('[class*="error" i]').length, broken, total: imgs.length };
    });
    r.notes.push(`Error elements: ${h.errors}, Broken images: ${h.broken}/${h.total}`);
    if (h.broken) r.issues.push({ flow: r.name, severity: 'MEDIUM', desc: `${h.broken} broken images`, expected: 'All load', actual: `${h.broken}/${h.total}` });

    const real = allErrors.filter(e => !isKnown(e));
    r.notes.push(`\nTotal errors: ${allErrors.length}, Non-known: ${real.length}`);
    if (real.length) {
      const unique = [...new Set(real)];
      unique.slice(0, 15).forEach((e, i) => r.notes.push(`  ${i + 1}. ${e.substring(0, 300)}`));
    }

    r.screenshots.push(await snap(page, '12-health'));
    if (r.issues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH')) r.status = 'FAIL';
    else if (r.issues.length) r.status = 'PARTIAL';
    results.push(r);
  });

  test.afterAll(async () => {
    // Build report
    const all = results.flatMap(r => r.issues);
    const bySev = (s: string) => all.filter(i => i.severity === s);

    let rpt = `# UX Interaction Audit Report\n\n`;
    rpt += `**Date**: ${new Date().toISOString().split('T')[0]}\n`;
    rpt += `**Viewports**: Desktop (1440x900), Tablet (768x1024), Mobile (375x812)\n`;
    rpt += `**URL**: ${BASE_URL}\n\n`;
    rpt += `## Summary\n\n| Metric | Count |\n|--------|-------|\n`;
    rpt += `| Flows Tested | ${results.length} |\n`;
    rpt += `| PASS | ${results.filter(r => r.status === 'PASS').length} |\n`;
    rpt += `| PARTIAL | ${results.filter(r => r.status === 'PARTIAL').length} |\n`;
    rpt += `| FAIL | ${results.filter(r => r.status === 'FAIL').length} |\n`;
    rpt += `| CRITICAL | ${bySev('CRITICAL').length} |\n`;
    rpt += `| HIGH | ${bySev('HIGH').length} |\n`;
    rpt += `| MEDIUM | ${bySev('MEDIUM').length} |\n`;
    rpt += `| LOW | ${bySev('LOW').length} |\n`;
    rpt += `| Console Errors | ${allErrors.length} (${allErrors.filter(e => !isKnown(e)).length} non-known) |\n\n`;

    rpt += `---\n\n## Issues\n\n`;
    if (!all.length) rpt += '*No issues*\n\n';
    else {
      for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
        const items = bySev(sev);
        if (!items.length) continue;
        rpt += `### ${sev} (${items.length})\n\n`;
        items.forEach(i => { rpt += `**${i.desc}**\n- Flow: ${i.flow}\n- Expected: ${i.expected}\n- Actual: ${i.actual}\n\n`; });
      }
    }

    rpt += `---\n\n## Flow Details\n\n`;
    results.forEach(f => {
      rpt += `### ${f.name} [${f.status}]\n\n`;
      if (f.notes.length) { rpt += `**Notes:**\n`; f.notes.forEach(n => rpt += `- ${n}\n`); rpt += '\n'; }
      if (f.issues.length) { rpt += `**Issues:**\n`; f.issues.forEach(i => rpt += `- [${i.severity}] ${i.desc}\n`); rpt += '\n'; }
      if (f.screenshots.length) { rpt += `**Screenshots:** `; f.screenshots.forEach(s => rpt += `\`${path.basename(s)}\` `); rpt += '\n\n'; }
      rpt += '---\n\n';
    });

    rpt += `## Console Errors\n\n`;
    const real = allErrors.filter(e => !isKnown(e));
    if (real.length) {
      rpt += `### Non-Known (${real.length})\n\n`;
      [...new Set(real)].slice(0, 25).forEach(e => rpt += `- \`${e.substring(0, 250)}\`\n`);
    } else rpt += '*No non-known console errors*\n';
    rpt += `\n### Known/Acceptable (${allErrors.filter(e => isKnown(e)).length})\nMapLibre fonts, deprecated APIs, etc.\n\n`;

    rpt += `---\n\n## Funda/Pararius Comparison\n\n`;
    rpt += `| Aspect | HuisHype | Funda | Pararius |\n|--------|----------|-------|----------|\n`;
    rpt += `| Map | Custom MapLibre vector tiles | Google Maps | Leaflet |\n`;
    rpt += `| Search | PDOK autocomplete | Custom+Google | Custom |\n`;
    rpt += `| Detail | Bottom sheet / card | Full page | Full page |\n`;
    rpt += `| Social | Like, Save, Comment, Price Guess | None | None |\n`;
    rpt += `| Mobile | Expo native | Responsive web | Responsive web |\n\n`;

    rpt += `## Recommendations\n\n`;
    rpt += `1. Ensure property click produces visible preview card UI feedback\n`;
    rpt += `2. Add visible loading indicator during initial map tile load\n`;
    rpt += `3. Verify search autocomplete reliability and clickability\n`;
    rpt += `4. Add proactive login option in the navigation\n`;
    rpt += `5. Verify feed content, empty states, and error handling\n`;
    rpt += `6. Test auth gating on all social features\n`;

    fs.writeFileSync(REPORT, rpt);
    console.log(`\nReport: ${REPORT}`);
  });
});
