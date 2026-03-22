// Mock for expo-blur
const React = require('react');

const BlurView = React.forwardRef((props, ref) => {
  const { children, intensity, tint, style, testID, ...rest } = props || {};
  return React.createElement(
    'View',
    { ...rest, style, testID, 'data-testid': testID, ref },
    children
  );
});
BlurView.displayName = 'BlurView';

module.exports = {
  __esModule: true,
  BlurView,
};
