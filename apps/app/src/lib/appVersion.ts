import Constants from 'expo-constants';

const RELEASE_VERSION = '1.0.0';
const FALLBACK_COMMIT_COUNT = '0';
const FALLBACK_COMMIT_SHA = 'unknown';

type ExpoExtra = {
  appVersionDisplay?: unknown;
  gitCommitCount?: unknown;
  gitCommitSha?: unknown;
};

function getExtra(): ExpoExtra {
  return (Constants.expoConfig?.extra ?? {}) as ExpoExtra;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function getAppVersionInfo(): {
  displayVersion: string;
  buildCommit: string;
  expandedDisplayVersion: string;
} {
  const extra = getExtra();
  const commitCount = nonEmptyString(extra.gitCommitCount) ?? FALLBACK_COMMIT_COUNT;
  const displayVersion =
    nonEmptyString(extra.appVersionDisplay) ?? `${RELEASE_VERSION}.${commitCount}`;
  const buildCommit = nonEmptyString(extra.gitCommitSha) ?? FALLBACK_COMMIT_SHA;

  return {
    displayVersion,
    buildCommit,
    expandedDisplayVersion: `${displayVersion} (build ${buildCommit})`,
  };
}
