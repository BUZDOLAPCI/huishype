// Mock for react-native-reanimated
const React = require('react');

const View = ({ children, style, ...props }) =>
  React.createElement('Animated.View', { ...props, style }, children);

const Text = ({ children, style, ...props }) =>
  React.createElement('Animated.Text', { ...props, style }, children);

const Image = ({ style, ...props }) =>
  React.createElement('Animated.Image', { ...props, style });

const ScrollView = ({ children, ...props }) =>
  React.createElement('Animated.ScrollView', props, children);

const useSharedValue = (initialValue) => ({
  value: initialValue,
});

const useAnimatedStyle = (styleFactory) => styleFactory();

const useAnimatedGestureHandler = (handlers) => handlers;

const useDerivedValue = (callback) => ({
  value: callback(),
});

const useAnimatedScrollHandler = (handlers) => handlers;

const withTiming = (toValue, config, callback) => {
  callback && callback(true);
  return toValue;
};

const withSpring = (toValue, config, callback) => {
  callback && callback(true);
  return toValue;
};

const withDelay = (delay, animation) => animation;

const withSequence = (...animations) => animations[animations.length - 1];

const withRepeat = (animation, count, reverse, callback) => {
  callback && callback(true);
  return animation;
};

const runOnJS = (fn) => fn;

const runOnUI = (fn) => fn;

const interpolate = (value, inputRange, outputRange) => {
  return outputRange[0];
};

const Extrapolate = {
  EXTEND: 'extend',
  CLAMP: 'clamp',
  IDENTITY: 'identity',
};

const Easing = {
  linear: (t) => t,
  ease: (t) => t,
  bezier: () => (t) => t,
  in: (easing) => easing,
  out: (easing) => easing,
  inOut: (easing) => easing,
};

module.exports = {
  __esModule: true,
  default: {
    View,
    Text,
    Image,
    ScrollView,
    createAnimatedComponent: (Component) => Component,
  },
  View,
  Text,
  Image,
  ScrollView,
  createAnimatedComponent: (Component) => Component,
  useSharedValue,
  useAnimatedStyle,
  useAnimatedGestureHandler,
  useDerivedValue,
  useAnimatedScrollHandler,
  withTiming,
  withSpring,
  withDelay,
  withSequence,
  withRepeat,
  runOnJS,
  runOnUI,
  interpolate,
  Extrapolate,
  Easing,
  useAnimatedProps: (props) => props,
  cancelAnimation: jest.fn(),
  makeMutable: (initialValue) => ({ value: initialValue }),
  useFrameCallback: jest.fn(),
  useAnimatedReaction: jest.fn(),
  Layout: {},
  FadeIn: {
    duration: () => FadeIn,
  },
  FadeOut: {
    duration: () => FadeOut,
  },
  SlideInRight: {},
  SlideOutLeft: {},
  Extrapolation: {
    EXTEND: 'extend',
    CLAMP: 'clamp',
    IDENTITY: 'identity',
  },
};

// Export named properties for FadeIn/FadeOut
const FadeIn = module.exports.FadeIn;
const FadeOut = module.exports.FadeOut;
