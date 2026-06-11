import Constants from 'expo-constants';

import { getAppVersionInfo } from '../appVersion';

const expoConfig = Constants.expoConfig as {
  extra?: {
    appVersionDisplay?: unknown;
    gitCommitCount?: unknown;
    gitCommitSha?: unknown;
  };
};

describe('getAppVersionInfo', () => {
  const originalExtra = { ...(expoConfig.extra ?? {}) };

  afterEach(() => {
    expoConfig.extra = { ...originalExtra };
  });

  it('uses Expo config build metadata when present', () => {
    expoConfig.extra = {
      appVersionDisplay: '1.0.0.123',
      gitCommitCount: '123',
      gitCommitSha: 'd5c8089aa964',
    };

    expect(getAppVersionInfo()).toEqual({
      displayVersion: '1.0.0.123',
      buildCommit: 'd5c8089aa964',
      expandedDisplayVersion: '1.0.0.123 (build d5c8089aa964)',
    });
  });

  it('falls back when Expo config build metadata is missing', () => {
    expoConfig.extra = {};

    expect(getAppVersionInfo()).toEqual({
      displayVersion: '1.0.0.0',
      buildCommit: 'unknown',
      expandedDisplayVersion: '1.0.0.0 (build unknown)',
    });
  });
});
