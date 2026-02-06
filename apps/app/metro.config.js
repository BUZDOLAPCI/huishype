const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Redirect native-only packages to empty stubs when bundling for web.
// @maplibre/maplibre-react-native uses codegenNativeComponent at the top level,
// which does not exist in react-native-web. Even though index.web.tsx exists,
// Metro's require.context (used by expo-router) still includes index.tsx in the
// context map, causing the native module to be evaluated during web builds.
const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform === 'web' &&
    moduleName === '@maplibre/maplibre-react-native'
  ) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'src/stubs/maplibre-react-native.js'),
    };
  }

  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
