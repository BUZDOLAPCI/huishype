const { execFileSync } = require('child_process');

const RELEASE_VERSION = '1.0.0';

function readGitValue(args, fallback) {
  try {
    return execFileSync('git', args, {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return fallback;
  }
}

const gitCommitCount = readGitValue(['rev-list', '--count', 'HEAD'], '0');
const gitCommitSha = readGitValue(['rev-parse', '--short=12', 'HEAD'], 'unknown');
const appVersionDisplay = `${RELEASE_VERSION}.${gitCommitCount}`;

module.exports = {
  expo: {
    name: 'HuisHype',
    slug: 'huishype',
    version: RELEASE_VERSION,
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'huishype',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    splash: {
      image: './assets/images/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'nl.huishype.app',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSLocationWhenInUseUsageDescription:
          'HuisHype uses your location to center the map around you.',
        NSPhotoLibraryUsageDescription:
          'HuisHype uses your photo library when you choose a profile picture.',
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/images/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
      package: 'nl.huishype.app',
    },
    web: {
      bundler: 'metro',
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        'expo-build-properties',
        {
          android: {
            newArchEnabled: true,
          },
          ios: {
            newArchEnabled: true,
          },
        },
      ],
      [
        '@maplibre/maplibre-react-native',
        {
          ios: {
            useFrameworks: 'static',
          },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      router: {},
      appVersionDisplay,
      gitCommitCount,
      gitCommitSha,
      eas: {
        projectId: '80861095-9b1d-4ef8-ac3e-416ed6ee9391',
      },
    },
    owner: 'caslan',
  },
};
