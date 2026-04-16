const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const config = getDefaultConfig(__dirname);
const monorepoRoot = path.resolve(__dirname, '../..');

config.watchFolders = [...new Set([...(config.watchFolders ?? []), monorepoRoot])];

// Redirect platform-incompatible packages to stubs.
// Expo Router's require.context evaluates ALL route files (index.tsx AND
// index.web.tsx) regardless of platform, so both the native-only
// @maplibre/maplibre-react-native and the web-only maplibre-gl get bundled
// on both platforms. Stub each one on the wrong platform.
const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Stub native map library on web
  if (
    platform === 'web' &&
    moduleName === '@maplibre/maplibre-react-native'
  ) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'src/stubs/maplibre-react-native.js'),
    };
  }

  // Stub web map library on native
  if (
    platform !== 'web' &&
    moduleName === 'maplibre-gl'
  ) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'src/stubs/maplibre-gl.js'),
    };
  }

  // React Native still exposes PushNotificationIOS from the core index, but on
  // Android bridgeless runtimes the module crashes during initialization if
  // anything touches that export. Route it to a native-safe stub instead.
  if (
    platform !== 'web' &&
    (moduleName === './Libraries/PushNotificationIOS/PushNotificationIOS' ||
      moduleName === './Libraries/PushNotificationIOS/NativePushNotificationManagerIOS')
  ) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'src/stubs/push-notification-ios.js'),
    };
  }

  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
