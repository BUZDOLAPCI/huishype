// Mock for @maplibre/maplibre-react-native
const React = require('react');

// Mock Map component
const Map = React.forwardRef(({ children, ...props }, ref) => {
  return React.createElement('Map', { ...props, ref }, children);
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

// Mock Layer component
const Layer = (props) => {
  return React.createElement('Layer', props);
};

// Mock Marker component
const Marker = React.forwardRef(({ children, ...props }, ref) => {
  return React.createElement('Marker', { ...props, ref }, children);
});

// Mock ViewAnnotation component
const ViewAnnotation = React.forwardRef(({ children, ...props }, ref) => {
  return React.createElement('ViewAnnotation', { ...props, ref }, children);
});

// Mock LayerAnnotation component
const LayerAnnotation = ({ children, ...props }) => {
  return React.createElement('LayerAnnotation', props, children);
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
  GeoJSONSource,
  Layer,
};

// Named exports only
module.exports = {
  __esModule: true,

  // Components
  Map,
  Camera,
  VectorSource,
  GeoJSONSource,
  Layer,
  Marker,
  ViewAnnotation,
  LayerAnnotation,
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
