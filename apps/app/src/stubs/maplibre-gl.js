// Stub module for maplibre-gl on native (Android/iOS).
// The web map library is not compatible with native builds because it uses
// WebGL/Canvas APIs that do not exist in React Native.
// Expo Router's require.context evaluates index.web.tsx even on native,
// which imports maplibre-gl and causes a crash.
//
// This stub is loaded by metro.config.js resolveRequest when platform !== 'web'.

class StubMap {
  constructor() {}
  remove() {}
}

class StubMarker {
  constructor() {}
  setLngLat() { return this; }
  setDOMContent() { return this; }
  addTo() { return this; }
  remove() {}
  getElement() { return null; }
}

module.exports = {
  Map: StubMap,
  Marker: StubMarker,
  default: { Map: StubMap, Marker: StubMarker },
};
