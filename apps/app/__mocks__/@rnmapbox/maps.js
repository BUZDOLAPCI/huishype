// Mock for @rnmapbox/maps
const React = require('react');

const MapView = ({ children, ...props }) =>
  React.createElement('MapView', props, children);

const Camera = (props) => React.createElement('Camera', props);

const MarkerView = ({ children, coordinate, ...props }) =>
  React.createElement('MarkerView', { ...props, coordinate }, children);

const PointAnnotation = ({ children, coordinate, ...props }) =>
  React.createElement('PointAnnotation', { ...props, coordinate }, children);

const ShapeSource = ({ children, ...props }) =>
  React.createElement('ShapeSource', props, children);

const CircleLayer = (props) => React.createElement('CircleLayer', props);

const SymbolLayer = (props) => React.createElement('SymbolLayer', props);

const LineLayer = (props) => React.createElement('LineLayer', props);

const FillLayer = (props) => React.createElement('FillLayer', props);

const setAccessToken = jest.fn();

module.exports = {
  MapView,
  Camera,
  MarkerView,
  PointAnnotation,
  ShapeSource,
  CircleLayer,
  SymbolLayer,
  LineLayer,
  FillLayer,
  setAccessToken,
  default: {
    setAccessToken,
  },
};
