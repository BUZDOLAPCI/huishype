// Mock for react-native-svg
const React = require('react');

const createSvgComponent = (name) => {
  const Component = React.forwardRef((props, ref) => {
    const { children, ...rest } = props || {};
    return React.createElement(name, { ...rest, ref }, children);
  });
  Component.displayName = name;
  return Component;
};

module.exports = {
  __esModule: true,
  default: createSvgComponent('Svg'),
  Svg: createSvgComponent('Svg'),
  Circle: createSvgComponent('Circle'),
  Rect: createSvgComponent('Rect'),
  Path: createSvgComponent('Path'),
  G: createSvgComponent('G'),
  Line: createSvgComponent('Line'),
  Polygon: createSvgComponent('Polygon'),
  Polyline: createSvgComponent('Polyline'),
  Text: createSvgComponent('SvgText'),
  TSpan: createSvgComponent('TSpan'),
  Defs: createSvgComponent('Defs'),
  Use: createSvgComponent('Use'),
  Symbol: createSvgComponent('SvgSymbol'),
  ClipPath: createSvgComponent('ClipPath'),
  LinearGradient: createSvgComponent('LinearGradient'),
  RadialGradient: createSvgComponent('RadialGradient'),
  Stop: createSvgComponent('Stop'),
  Mask: createSvgComponent('Mask'),
};
