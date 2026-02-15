// Stub module for @maplibre/maplibre-react-native on web.
// The native map library is not compatible with web builds because it uses
// codegenNativeComponent which does not exist in react-native-web.
// The web app uses maplibre-gl (via index.web.tsx) instead.
//
// This stub is loaded by metro.config.js resolveRequest when platform === 'web'.

const EmptyComponent = () => null;

module.exports = {
  Map: EmptyComponent,
  Camera: EmptyComponent,
  Marker: EmptyComponent,
  VectorSource: EmptyComponent,
  GeoJSONSource: EmptyComponent,
  Layer: EmptyComponent,
  Images: EmptyComponent,
  UserLocation: EmptyComponent,
  RasterSource: EmptyComponent,
  LogManager: { setLogLevel: () => {} },
};
