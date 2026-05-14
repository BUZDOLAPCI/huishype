type WebMapCameraPopHandler = (event: PopStateEvent) => boolean;

type WebMapCameraHistoryBridge = {
  handler: WebMapCameraPopHandler | null;
  shouldDeferToDismissibleLayer: (() => boolean) | null;
  listener: (event: PopStateEvent) => void;
};

declare global {
  interface Window {
    __huishypeWebMapCameraHistoryBridge?: WebMapCameraHistoryBridge;
  }
}

function getBridge(): WebMapCameraHistoryBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const existingBridge = window.__huishypeWebMapCameraHistoryBridge;
  if (existingBridge) {
    return existingBridge;
  }

  const bridge: WebMapCameraHistoryBridge = {
    handler: null,
    shouldDeferToDismissibleLayer: null,
    listener: (event) => {
      if (bridge.shouldDeferToDismissibleLayer?.()) {
        return;
      }

      if (!bridge.handler?.(event)) {
        return;
      }

      event.stopImmediatePropagation();
    },
  };

  window.__huishypeWebMapCameraHistoryBridge = bridge;
  window.addEventListener('popstate', bridge.listener, { capture: true });
  return bridge;
}

export function installWebMapCameraHistoryBridge() {
  getBridge();
}

export function registerWebMapCameraPopHandler(handler: WebMapCameraPopHandler) {
  const bridge = getBridge();
  if (!bridge) {
    return () => {};
  }

  bridge.handler = handler;

  return () => {
    if (bridge.handler === handler) {
      bridge.handler = null;
    }
  };
}

export function registerWebMapCameraPopBlocker(shouldDefer: () => boolean) {
  const bridge = getBridge();
  if (!bridge) {
    return () => {};
  }

  bridge.shouldDeferToDismissibleLayer = shouldDefer;

  return () => {
    if (bridge.shouldDeferToDismissibleLayer === shouldDefer) {
      bridge.shouldDeferToDismissibleLayer = null;
    }
  };
}

installWebMapCameraHistoryBridge();
