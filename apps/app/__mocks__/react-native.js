// Mock for React Native
const React = require('react');

// Simple component factory that returns plain elements
const createMockComponent = (name) => {
  const Component = React.forwardRef((props, ref) => {
    const { children, className, style, testID, ...rest } = props || {};
    return React.createElement(
      name,
      { ...rest, style, testID, 'data-testid': testID, ref },
      children
    );
  });
  Component.displayName = name;
  return Component;
};

const View = createMockComponent('View');
const Text = createMockComponent('Text');
const Image = createMockComponent('Image');
const TouchableOpacity = createMockComponent('TouchableOpacity');
const Pressable = createMockComponent('Pressable');
const ScrollView = createMockComponent('ScrollView');
const ActivityIndicator = createMockComponent('ActivityIndicator');
const StatusBar = createMockComponent('StatusBar');
const SafeAreaView = createMockComponent('SafeAreaView');
const KeyboardAvoidingView = createMockComponent('KeyboardAvoidingView');
const TextInput = createMockComponent('TextInput');
const Modal = createMockComponent('Modal');

// FlatList needs special handling for renderItem
const FlatList = React.forwardRef((props, ref) => {
  const {
    data = [],
    renderItem,
    keyExtractor,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
    refreshControl,
    className,
    testID,
    ...rest
  } = props || {};

  let content;
  if (!data || data.length === 0) {
    content = ListEmptyComponent
      ? React.createElement(ListEmptyComponent, {})
      : null;
  } else {
    content = data.map((item, index) => {
      const rendered = renderItem({ item, index });
      const key = keyExtractor ? keyExtractor(item, index) : String(index);
      return React.cloneElement(rendered, { key });
    });
  }

  return React.createElement(
    'FlatList',
    { ...rest, 'data-testid': testID, ref },
    content
  );
});
FlatList.displayName = 'FlatList';

// RefreshControl
const RefreshControl = React.forwardRef((props, ref) => {
  const { refreshing, onRefresh, className, ...rest } = props || {};
  return React.createElement('RefreshControl', {
    ...rest,
    refreshing,
    onRefresh,
    ref,
  });
});
RefreshControl.displayName = 'RefreshControl';

const StyleSheet = {
  create: (styles) => styles,
  flatten: (style) => style,
};

const Platform = {
  OS: 'ios',
  select: (obj) => obj.ios || obj.default,
};

const Dimensions = {
  get: () => ({ width: 375, height: 812 }),
};

const Animated = {
  View,
  Text,
  Image,
  createAnimatedComponent: (Component) => Component,
  Value: class Value {
    constructor(value) {
      this._value = value;
    }
    setValue(value) {
      this._value = value;
    }
  },
  timing: () => ({ start: (cb) => cb && cb({ finished: true }) }),
  spring: () => ({ start: (cb) => cb && cb({ finished: true }) }),
  parallel: () => ({ start: (cb) => cb && cb({ finished: true }) }),
  sequence: () => ({ start: (cb) => cb && cb({ finished: true }) }),
};

module.exports = {
  View,
  Text,
  Image,
  TouchableOpacity,
  Pressable,
  ScrollView,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Dimensions,
  Animated,
  StatusBar,
  SafeAreaView,
  KeyboardAvoidingView,
  TextInput,
  Modal,
};
