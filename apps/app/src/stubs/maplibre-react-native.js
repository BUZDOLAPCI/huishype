// Stub module for @maplibre/maplibre-react-native on web.
// The native map library is not compatible with web builds because it uses
// codegenNativeComponent which does not exist in react-native-web.
// The web app uses maplibre-gl (via index.web.tsx) instead.
//
// This stub is loaded by metro.config.js resolveRequest when platform === 'web'.

const EmptyComponent = () => null;

module.exports = {
  // alpha.44+ renamed MapView to Map
  Map: EmptyComponent,
  MapView: EmptyComponent, // legacy alias for compatibility
  Camera: EmptyComponent,
  VectorSource: EmptyComponent,
  CircleLayer: EmptyComponent,
  SymbolLayer: EmptyComponent,
  FillLayer: EmptyComponent,
  LineLayer: EmptyComponent,
  RasterSource: EmptyComponent,
  RasterLayer: EmptyComponent,
  GeoJSONSource: EmptyComponent,
  ShapeSource: EmptyComponent, // legacy alias for compatibility
  Images: EmptyComponent,
  UserLocation: EmptyComponent,
  LogManager: { setLogLevel: () => {} },
  default: EmptyComponent,
};
