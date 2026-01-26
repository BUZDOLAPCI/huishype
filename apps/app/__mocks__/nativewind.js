// Mock for nativewind
// NativeWind adds className prop support to React Native components

module.exports = {
  styled: (Component) => Component,
  useColorScheme: () => 'light',
  vars: {},
  cssInterop: (Component) => Component,
  remapProps: (Component) => Component,
};
