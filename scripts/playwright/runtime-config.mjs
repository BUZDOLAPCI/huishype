import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLAYWRIGHT_PROPERTY_TILE_PYRAMID_COVERAGE_ID,
  PLAYWRIGHT_PROPERTY_TILE_PYRAMID_FIXTURE_ALLOW_ENV,
} from './property-tile-fixture.mjs';

export {
  PLAYWRIGHT_PROPERTY_TILE_PYRAMID_COVERAGE_ID,
  PLAYWRIGHT_PROPERTY_TILE_PYRAMID_FIXTURE_ALLOW_ENV,
} from './property-tile-fixture.mjs';

export const DEFAULT_PLAYWRIGHT_API_PORT = 3101;
export const DEFAULT_PLAYWRIGHT_WEB_PORT = 8082;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PLAYWRIGHT_REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
export const PLAYWRIGHT_APP_ROOT = path.join(PLAYWRIGHT_REPO_ROOT, 'apps', 'app');
export const PLAYWRIGHT_OUTPUT_ROOT = path.join(PLAYWRIGHT_REPO_ROOT, 'test-results', 'playwright');
export const PLAYWRIGHT_ARTIFACT_ROOT = path.join(PLAYWRIGHT_OUTPUT_ROOT, 'artifacts');
export const PLAYWRIGHT_HTML_REPORT_DIR = path.join(PLAYWRIGHT_OUTPUT_ROOT, 'report');

export const PLAYWRIGHT_TEST_DIR = path.join(PLAYWRIGHT_APP_ROOT, 'e2e');
export const PLAYWRIGHT_FLOW_TEST_DIR = path.join(PLAYWRIGHT_TEST_DIR, 'flows');
export const PLAYWRIGHT_INTEGRATION_TEST_DIR = path.join(PLAYWRIGHT_TEST_DIR, 'integration');
export const PLAYWRIGHT_VISUAL_TEST_DIR = path.join(PLAYWRIGHT_TEST_DIR, 'visual');
export const DEFAULT_LOCAL_DATABASE_URL =
  'postgresql://huishype:huishype_dev@localhost:5440/huishype';

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const PRODUCTION_DATABASE_NAME_PATTERN = /\b(prod|production|coolify)\b/i;

export function getPlaywrightWebDistCandidates(repoRoot = PLAYWRIGHT_REPO_ROOT) {
  return [path.join(repoRoot, 'apps', 'app', 'dist')];
}

function readExportCandidate(candidateDir) {
  const entrypointPath = path.join(candidateDir, 'index.html');

  if (!fs.existsSync(entrypointPath) || !fs.statSync(entrypointPath).isFile()) {
    return null;
  }

  const entrypointStat = fs.statSync(entrypointPath);
  const dirStat = fs.statSync(candidateDir);

  return {
    dir: candidateDir,
    entrypointPath,
    modifiedAtMs: Math.max(entrypointStat.mtimeMs, dirStat.mtimeMs),
  };
}

export function resolveLatestWebDistDir({
  startedAtMs = 0,
  candidates = getPlaywrightWebDistCandidates(),
} = {}) {
  const availableCandidates = candidates
    .map((candidateDir) => readExportCandidate(candidateDir))
    .filter(Boolean);

  if (availableCandidates.length === 0) {
    throw new Error(`Unable to find an exported web bundle. Checked: ${candidates.join(', ')}`);
  }

  const freshCandidates = availableCandidates.filter(
    (candidate) => candidate.modifiedAtMs >= startedAtMs - 1000
  );
  const rankedCandidates = (
    freshCandidates.length > 0 ? freshCandidates : availableCandidates
  ).sort((left, right) => {
    if (left.modifiedAtMs !== right.modifiedAtMs) {
      return right.modifiedAtMs - left.modifiedAtMs;
    }

    return left.dir.localeCompare(right.dir);
  });

  return rankedCandidates[0].dir;
}

function parsePort(rawValue, fallback) {
  const value = Number.parseInt(rawValue ?? String(fallback), 10);
  return Number.isInteger(value) ? value : fallback;
}

function toLocalhostUrl(port) {
  return `http://127.0.0.1:${port}`;
}

export function createPlaywrightRuntimeSettings(env = process.env) {
  const apiPort = parsePort(env.PLAYWRIGHT_API_PORT, DEFAULT_PLAYWRIGHT_API_PORT);
  const webPort = parsePort(env.PLAYWRIGHT_WEB_PORT, DEFAULT_PLAYWRIGHT_WEB_PORT);
  const apiUrl = toLocalhostUrl(apiPort);
  const webUrl = toLocalhostUrl(webPort);

  return {
    repoRoot: PLAYWRIGHT_REPO_ROOT,
    apiPort,
    webPort,
    apiUrl,
    webUrl,
    webOrigin: new URL(webUrl).origin,
    artifactRoot: env.PLAYWRIGHT_ARTIFACT_ROOT || PLAYWRIGHT_ARTIFACT_ROOT,
    htmlReportDir: env.PLAYWRIGHT_HTML_REPORT_DIR || PLAYWRIGHT_HTML_REPORT_DIR,
  };
}

export function applyPlaywrightRuntimeEnvironment(env = process.env) {
  const settings = createPlaywrightRuntimeSettings(env);

  env.API_URL = settings.apiUrl;
  env.EXPO_PUBLIC_API_URL = settings.apiUrl;
  env.PLAYWRIGHT_API_PORT = String(settings.apiPort);
  env.PLAYWRIGHT_WEB_PORT = String(settings.webPort);
  env.PLAYWRIGHT_WEB_URL = settings.webUrl;
  env.PLAYWRIGHT_ARTIFACT_ROOT = settings.artifactRoot;
  env.PLAYWRIGHT_HTML_REPORT_DIR = settings.htmlReportDir;
  env.PLAYWRIGHT_REPO_ROOT = settings.repoRoot;

  return settings;
}

export function applyPlaywrightPropertyTilePyramidFixtureEnvironment(env = process.env) {
  env.PROPERTY_TILE_PYRAMID_COVERAGE_ID = PLAYWRIGHT_PROPERTY_TILE_PYRAMID_COVERAGE_ID;
  env.PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM = '10';
  env[PLAYWRIGHT_PROPERTY_TILE_PYRAMID_FIXTURE_ALLOW_ENV] = '1';

  return {
    coverageId: env.PROPERTY_TILE_PYRAMID_COVERAGE_ID,
    maxZoom: env.PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM,
    allowEnv: PLAYWRIGHT_PROPERTY_TILE_PYRAMID_FIXTURE_ALLOW_ENV,
  };
}

function resolveDatabaseUrl(env = process.env) {
  return env.DATABASE_URL || DEFAULT_LOCAL_DATABASE_URL;
}

function parseDatabaseUrl(databaseUrl) {
  let parsed;

  try {
    parsed = new URL(databaseUrl);
  } catch (error) {
    throw new Error(
      `Refusing to prepare Playwright pyramid fixture: DATABASE_URL is not a valid URL (${error.message})`
    );
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(
      `Refusing to prepare Playwright pyramid fixture: DATABASE_URL must use postgres/postgresql, received ${parsed.protocol}`
    );
  }

  return parsed;
}

export function describeDatabaseTarget(databaseUrl = DEFAULT_LOCAL_DATABASE_URL) {
  const parsed = parseDatabaseUrl(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));

  return {
    databaseUrl,
    host: parsed.hostname,
    port: parsed.port || '5432',
    databaseName,
    user: decodeURIComponent(parsed.username),
  };
}

export function assertPlaywrightPropertyTilePyramidFixtureTargetIsSafe(
  env = process.env,
  { requireExplicitAllow = true } = {}
) {
  if (requireExplicitAllow && env[PLAYWRIGHT_PROPERTY_TILE_PYRAMID_FIXTURE_ALLOW_ENV] !== '1') {
    throw new Error(
      `Refusing to prepare Playwright pyramid fixture: set ${PLAYWRIGHT_PROPERTY_TILE_PYRAMID_FIXTURE_ALLOW_ENV}=1 only from a verified local Playwright wrapper.`
    );
  }

  const runtimeEnv = env.NODE_ENV?.trim() || 'development';
  if (runtimeEnv !== 'development' && runtimeEnv !== 'test') {
    throw new Error(
      `Refusing to prepare Playwright pyramid fixture: NODE_ENV=${runtimeEnv} is not allowed.`
    );
  }

  const target = describeDatabaseTarget(resolveDatabaseUrl(env));
  const normalizedHost = target.host.toLowerCase();

  if (!LOCAL_DATABASE_HOSTS.has(normalizedHost)) {
    throw new Error(
      `Refusing to prepare Playwright pyramid fixture: database host "${target.host}" is not local.`
    );
  }

  if (!target.databaseName) {
    throw new Error(
      'Refusing to prepare Playwright pyramid fixture: DATABASE_URL does not name a database.'
    );
  }

  if (PRODUCTION_DATABASE_NAME_PATTERN.test(target.databaseName)) {
    throw new Error(
      `Refusing to prepare Playwright pyramid fixture: database name "${target.databaseName}" looks production-like.`
    );
  }

  return target;
}
