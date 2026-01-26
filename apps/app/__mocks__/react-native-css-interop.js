// Mock for react-native-css-interop (used by NativeWind)
const React = require('react');

// The createInteropElement is called by NativeWind-transformed components
// It must handle any arguments gracefully
const createInteropElement = function(type, props) {
  // Get remaining arguments as children
  const children = Array.prototype.slice.call(arguments, 2);

  // Extract className and convert to empty style (mocked)
  const safeProps = props || {};
  const { className, ...restProps } = safeProps;

  // Handle children - filter out undefined/null
  const validChildren = children.filter(
    function(child) { return child !== null && child !== undefined; }
  );

  // Create element based on number of valid children
  if (validChildren.length === 0) {
    return React.createElement(type, restProps);
  }

  if (validChildren.length === 1) {
    return React.createElement(type, restProps, validChildren[0]);
  }

  // Spread multiple children
  return React.createElement.apply(
    React,
    [type, restProps].concat(validChildren)
  );
};

module.exports = {
  __esModule: true,
  createInteropElement: createInteropElement,
  default: {
    createInteropElement: createInteropElement,
  },
  cssInterop: function(Component) { return Component; },
  remapProps: function(Component) { return Component; },
  useColorScheme: function() { return 'light'; },
  vars: {},
  StyleSheet: {
    create: function(styles) { return styles; },
    flatten: function(style) { return style; },
  },
};
