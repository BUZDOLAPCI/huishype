/**
 * Mock for react-native-safe-area-context.
 *
 * Provides zero insets and a pass-through SafeAreaProvider/SafeAreaView
 * so that components using useSafeAreaInsets() work in Jest tests.
 */
const React = require('react');

const useSafeAreaInsets = () => ({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

const useSafeAreaFrame = () => ({
  x: 0,
  y: 0,
  width: 375,
  height: 812,
});

const SafeAreaProvider = ({ children }) =>
  React.createElement(React.Fragment, null, children);

const SafeAreaView = ({ children, ...props }) =>
  React.createElement('View', props, children);

const SafeAreaInsetsContext = React.createContext({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

const SafeAreaFrameContext = React.createContext({
  x: 0,
  y: 0,
  width: 375,
  height: 812,
});

module.exports = {
  useSafeAreaInsets,
  useSafeAreaFrame,
  SafeAreaProvider,
  SafeAreaView,
  SafeAreaInsetsContext,
  SafeAreaFrameContext,
};
