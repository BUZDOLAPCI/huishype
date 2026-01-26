// Mock for react-native-gesture-handler
const React = require('react');

const View = ({ children, ...props }) =>
  React.createElement('View', props, children);

// Create a chainable gesture mock
const createChainableGesture = () => {
  const gesture = {
    onStart: function() { return this; },
    onBegin: function() { return this; },
    onUpdate: function() { return this; },
    onEnd: function() { return this; },
    onFinalize: function() { return this; },
    enabled: function() { return this; },
    minDistance: function() { return this; },
    numberOfTaps: function() { return this; },
    maxDuration: function() { return this; },
    minPointers: function() { return this; },
    maxPointers: function() { return this; },
    shouldCancelWhenOutside: function() { return this; },
    simultaneousWithExternalGesture: function() { return this; },
    requireExternalGestureToFail: function() { return this; },
    blocksExternalGesture: function() { return this; },
    withTestId: function() { return this; },
    hitSlop: function() { return this; },
    activateAfterLongPress: function() { return this; },
    minVelocity: function() { return this; },
    minVelocityX: function() { return this; },
    minVelocityY: function() { return this; },
    activeOffsetX: function() { return this; },
    activeOffsetY: function() { return this; },
    failOffsetX: function() { return this; },
    failOffsetY: function() { return this; },
  };
  return gesture;
};

module.exports = {
  GestureHandlerRootView: View,
  GestureDetector: View,
  Gesture: {
    Pan: () => createChainableGesture(),
    Tap: () => createChainableGesture(),
    Pinch: () => createChainableGesture(),
    Rotation: () => createChainableGesture(),
    Fling: () => createChainableGesture(),
    LongPress: () => createChainableGesture(),
    ForceTouch: () => createChainableGesture(),
    Native: () => createChainableGesture(),
    Manual: () => createChainableGesture(),
    Hover: () => createChainableGesture(),
    Simultaneous: (...gestures) => createChainableGesture(),
    Exclusive: (...gestures) => createChainableGesture(),
    Race: (...gestures) => createChainableGesture(),
  },
  State: {
    UNDETERMINED: 0,
    FAILED: 1,
    BEGAN: 2,
    CANCELLED: 3,
    ACTIVE: 4,
    END: 5,
  },
  PanGestureHandler: View,
  TapGestureHandler: View,
  ScrollView: View,
  FlatList: View,
};
