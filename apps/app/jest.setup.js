// Jest setup file for HuisHype app
const { act } = require('@testing-library/react-native');
const { notifyManager } = require('@tanstack/react-query');

// Mock console.warn to suppress React Native warnings in tests
const originalWarn = console.warn;
const originalError = console.error;

console.warn = (...args) => {
  // Filter out known noisy warnings
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('Animated:') ||
      args[0].includes('useNativeDriver') ||
      args[0].includes('componentWillReceiveProps') ||
      args[0].includes('componentWillMount') ||
      args[0].includes('react-test-renderer is deprecated'))
  ) {
    return;
  }
  originalWarn.apply(console, args);
};

console.error = (...args) => {
  // Filter out deprecation warnings
  if (
    typeof args[0] === 'string' &&
    args[0].includes('react-test-renderer is deprecated')
  ) {
    return;
  }
  originalError.apply(console, args);
};

// Global test utilities
global.IS_REACT_ACT_ENVIRONMENT = true;

// Make TanStack Query flush async observer notifications inside React act().
notifyManager.setNotifyFunction((callback) => {
  act(() => {
    callback();
  });
});
