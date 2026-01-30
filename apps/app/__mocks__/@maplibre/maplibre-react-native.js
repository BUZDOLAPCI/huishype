// Mock for @maplibre/maplibre-react-native
const React = require('react');

// Mock MapView component
const MapView = React.forwardRef(({ children, ...props }, ref) => {
  return React.createElement('MapView', { ...props, ref }, children);
});

// Mock Camera component
const Camera = React.forwardRef(({ children, ...props }, ref) => {
  React.useImperativeHandle(ref, () => ({
    setCamera: jest.fn(),
    flyTo: jest.fn(),
    moveTo: jest.fn(),
    zoomTo: jest.fn(),
    fitBounds: jest.fn(),
  }));
  return React.createElement('Camera', { ...props, ref }, children);
});

// Mock VectorSource component
const VectorSource = ({ children, ...props }) => {
  return React.createElement('VectorSource', props, children);
};

// Mock GeoJSONSource component
const GeoJSONSource = ({ children, ...props }) => {
  return React.createElement('GeoJSONSource', props, children);
};

// Mock CircleLayer component
const CircleLayer = (props) => {
  return React.createElement('CircleLayer', props);
};

// Mock SymbolLayer component
const SymbolLayer = (props) => {
  return React.createElement('SymbolLayer', props);
};

// Mock LineLayer component
const LineLayer = (props) => {
  return React.createElement('LineLayer', props);
};

// Mock FillLayer component
const FillLayer = (props) => {
  return React.createElement('FillLayer', props);
};

// Mock RasterLayer component
const RasterLayer = (props) => {
  return React.createElement('RasterLayer', props);
};

// Mock BackgroundLayer component
const BackgroundLayer = (props) => {
  return React.createElement('BackgroundLayer', props);
};

// Mock HeatmapLayer component
const HeatmapLayer = (props) => {
  return React.createElement('HeatmapLayer', props);
};

// Mock FillExtrusionLayer component
const FillExtrusionLayer = (props) => {
  return React.createElement('FillExtrusionLayer', props);
};

// Mock MarkerView component
const MarkerView = ({ children, ...props }) => {
  return React.createElement('MarkerView', props, children);
};

// Mock PointAnnotation component
const PointAnnotation = React.forwardRef(({ children, ...props }, ref) => {
  return React.createElement('PointAnnotation', { ...props, ref }, children);
});

// Mock Annotation component
const Annotation = ({ children, ...props }) => {
  return React.createElement('Annotation', props, children);
};

// Mock Callout component
const Callout = ({ children, ...props }) => {
  return React.createElement('Callout', props, children);
};

// Mock UserLocation component
const UserLocation = (props) => {
  return React.createElement('UserLocation', props);
};

// Mock NativeUserLocation component
const NativeUserLocation = (props) => {
  return React.createElement('NativeUserLocation', props);
};

// Mock Images component
const Images = (props) => {
  return React.createElement('Images', props);
};

// Mock ImageSource component
const ImageSource = ({ children, ...props }) => {
  return React.createElement('ImageSource', props, children);
};

// Mock RasterSource component
const RasterSource = ({ children, ...props }) => {
  return React.createElement('RasterSource', props, children);
};

// Mock LocationManager
const LocationManager = {
  start: jest.fn(),
  stop: jest.fn(),
  getLastKnownLocation: jest.fn(() => Promise.resolve(null)),
  setMinDisplacement: jest.fn(),
};

// Mock LogManager
const LogManager = {
  setLogLevel: jest.fn(),
};

// Mock NetworkManager
const NetworkManager = {
  setConnected: jest.fn(),
};

// Mock OfflineManager
const OfflineManager = {
  createPack: jest.fn(),
  deletePack: jest.fn(),
  getPacks: jest.fn(() => Promise.resolve([])),
  resetDatabase: jest.fn(),
};

// Mock OfflinePack
const OfflinePack = {};

// Mock StaticMapImageManager
const StaticMapImageManager = {
  takeSnap: jest.fn(() => Promise.resolve(null)),
};

// Mock useCurrentPosition hook
const useCurrentPosition = () => ({
  position: null,
  error: null,
  loading: false,
});

// Mock Animated
const Animated = {
  ShapeSource: GeoJSONSource,
  CircleLayer,
  SymbolLayer,
  LineLayer,
  FillLayer,
  FillExtrusionLayer,
  RasterLayer,
  HeatmapLayer,
  BackgroundLayer,
  extractAnimationCoordinates: jest.fn(),
};

// Named exports (matching the actual package API)
module.exports = {
  __esModule: true,
  // Components
  MapView,
  Camera,
  VectorSource,
  GeoJSONSource,
  CircleLayer,
  SymbolLayer,
  LineLayer,
  FillLayer,
  RasterLayer,
  BackgroundLayer,
  HeatmapLayer,
  FillExtrusionLayer,
  MarkerView,
  PointAnnotation,
  Annotation,
  Callout,
  UserLocation,
  NativeUserLocation,
  Images,
  ImageSource,
  RasterSource,
  // Modules
  LocationManager,
  LogManager,
  NetworkManager,
  OfflineManager,
  OfflinePack,
  StaticMapImageManager,
  // Hooks
  useCurrentPosition,
  // Utils
  Animated,
};
