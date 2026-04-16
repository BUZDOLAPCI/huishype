import path from 'node:path';

// The root Playwright wrapper populates these env vars. The hard-coded values
// are fallback defaults for direct local invocations and compatibility paths.
const DEFAULT_API_ORIGIN = 'http://127.0.0.1:3101';
const DEFAULT_WEB_ORIGIN = 'http://127.0.0.1:8082';

function normalizeOrigin(value: string, fallback: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return fallback;
  }
}

export function getPlaywrightApiUrl(): string {
  return process.env.API_URL || process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_ORIGIN;
}

export function getPlaywrightWebUrl(): string {
  return process.env.PLAYWRIGHT_WEB_URL || DEFAULT_WEB_ORIGIN;
}

export function getPlaywrightWebOrigin(): string {
  return normalizeOrigin(getPlaywrightWebUrl(), DEFAULT_WEB_ORIGIN);
}

export function getPlaywrightArtifactRoot(): string {
  return process.env.PLAYWRIGHT_ARTIFACT_ROOT || path.join('test-results', 'playwright');
}

export function getPlaywrightArtifactPath(...segments: string[]): string {
  return path.join(getPlaywrightArtifactRoot(), ...segments);
}
