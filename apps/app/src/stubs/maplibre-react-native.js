// Stub module for @maplibre/maplibre-react-native on web.
// The native map library is not compatible with web builds because it uses
// codegenNativeComponent which does not exist in react-native-web.
// The web app uses maplibre-gl (via index.web.tsx) instead.
//
// This stub is loaded by metro.config.js resolveRequest when platform === 'web'.

const EmptyComponent = () => null;

module.exports = {
  MapView: EmptyComponent,
  Camera: EmptyComponent,
  VectorSource: EmptyComponent,
  CircleLayer: EmptyComponent,
  SymbolLayer: EmptyComponent,
  FillLayer: EmptyComponent,
  LineLayer: EmptyComponent,
  RasterSource: EmptyComponent,
  RasterLayer: EmptyComponent,
  ShapeSource: EmptyComponent,
  Images: EmptyComponent,
  UserLocation: EmptyComponent,
  LogManager: { setLogLevel: () => {} },
  default: EmptyComponent,
};
