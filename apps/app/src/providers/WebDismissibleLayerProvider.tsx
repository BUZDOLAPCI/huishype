import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type PropsWithChildren,
} from 'react';
import { Platform } from 'react-native';

import { registerWebMapCameraPopBlocker } from '@/src/lib/webMapCameraHistory';

type DismissibleLayerOptions = {
  id: string;
  active: boolean;
  onDismiss: () => void;
  priority?: number;
  stateKey?: string;
  enabled?: boolean;
};

type LayerRecord = {
  id: string;
  key: string;
  onDismiss: () => void;
  order: number;
  priority: number;
  stateKey?: string;
};

type LayerRegistration = Omit<LayerRecord, 'order'>;

type WebDismissibleLayerContextValue = {
  registerLayer: (layer: LayerRegistration) => () => void;
  updateLayer: (layer: LayerRegistration) => void;
};

const HUIS_HYPE_LAYER_STATE_KEY = '__huishypeDismissibleLayer';
const HUIS_HYPE_ORIGINAL_STATE_KEY = '__huishypeOriginalHistoryState';

const noop = () => {};

const WebDismissibleLayerContext = createContext<WebDismissibleLayerContextValue>({
  registerLayer: () => noop,
  updateLayer: noop,
});

function canUseWebHistory() {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    typeof window.history?.pushState === 'function' &&
    typeof window.history?.back === 'function'
  );
}

function getLayerKey(options: Pick<DismissibleLayerOptions, 'id' | 'stateKey'>) {
  return options.stateKey ?? options.id;
}

function createLayerHistoryState(currentState: unknown, layer: LayerRecord) {
  const marker = {
    id: layer.id,
    stateKey: layer.stateKey,
    key: layer.key,
  };

  if (currentState && typeof currentState === 'object' && !Array.isArray(currentState)) {
    return {
      ...currentState,
      [HUIS_HYPE_LAYER_STATE_KEY]: marker,
    };
  }

  return {
    [HUIS_HYPE_ORIGINAL_STATE_KEY]: currentState,
    [HUIS_HYPE_LAYER_STATE_KEY]: marker,
  };
}

function getCurrentSamePathUrl() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function WebDismissibleLayerProvider({ children }: PropsWithChildren) {
  const layersRef = useRef(new Map<string, LayerRecord>());
  const nextOrderRef = useRef(0);
  const ignorePopCountRef = useRef(0);
  const popDismissedKeysRef = useRef(new Set<string>());

  const getTopLayer = useCallback(() => {
    let topLayer: LayerRecord | null = null;

    for (const layer of layersRef.current.values()) {
      if (
        !topLayer ||
        layer.priority > topLayer.priority ||
        (layer.priority === topLayer.priority && layer.order > topLayer.order)
      ) {
        topLayer = layer;
      }
    }

    return topLayer;
  }, []);

  const updateLayer = useCallback((layer: LayerRegistration) => {
    const existingLayer = layersRef.current.get(layer.key);

    if (!existingLayer) {
      return;
    }

    layersRef.current.set(layer.key, {
      ...existingLayer,
      id: layer.id,
      onDismiss: layer.onDismiss,
      priority: layer.priority,
      stateKey: layer.stateKey,
    });
  }, []);

  const unregisterLayer = useCallback(
    (key: string) => {
      if (!canUseWebHistory()) {
        layersRef.current.delete(key);
        popDismissedKeysRef.current.delete(key);
        return;
      }

      const existingLayer = layersRef.current.get(key);

      if (!existingLayer) {
        popDismissedKeysRef.current.delete(key);
        return;
      }

      const topLayer = getTopLayer();
      const shouldConsumeHistory = topLayer?.key === key && !popDismissedKeysRef.current.has(key);

      layersRef.current.delete(key);

      if (popDismissedKeysRef.current.delete(key)) {
        return;
      }

      if (shouldConsumeHistory) {
        ignorePopCountRef.current += 1;
        window.history.back();
      }
    },
    [getTopLayer],
  );

  const registerLayer = useCallback(
    (layer: LayerRegistration) => {
      if (!canUseWebHistory()) {
        return noop;
      }

      const existingLayer = layersRef.current.get(layer.key);

      if (existingLayer) {
        layersRef.current.set(layer.key, {
          ...existingLayer,
          id: layer.id,
          onDismiss: layer.onDismiss,
          priority: layer.priority,
          stateKey: layer.stateKey,
        });
        return noop;
      }

      const record: LayerRecord = {
        ...layer,
        order: nextOrderRef.current,
      };
      nextOrderRef.current += 1;
      layersRef.current.set(layer.key, record);
      window.history.pushState(
        createLayerHistoryState(window.history.state, record),
        '',
        getCurrentSamePathUrl(),
      );

      return () => unregisterLayer(layer.key);
    },
    [unregisterLayer],
  );

  const contextValue = useMemo<WebDismissibleLayerContextValue>(
    () => ({
      registerLayer,
      updateLayer,
    }),
    [registerLayer, updateLayer],
  );

  React.useEffect(() => {
    if (!canUseWebHistory()) {
      return undefined;
    }

    return registerWebMapCameraPopBlocker(() => getTopLayer() !== null);
  }, [getTopLayer]);

  React.useEffect(() => {
    if (!canUseWebHistory()) {
      return undefined;
    }

    const handlePopState = (event: PopStateEvent) => {
      if (ignorePopCountRef.current > 0) {
        ignorePopCountRef.current -= 1;
        event.stopImmediatePropagation();
        return;
      }

      const topLayer = getTopLayer();

      if (!topLayer) {
        return;
      }

      popDismissedKeysRef.current.add(topLayer.key);
      topLayer.onDismiss();
      event.stopImmediatePropagation();
    };

    window.addEventListener('popstate', handlePopState, { capture: true });
    return () => window.removeEventListener('popstate', handlePopState, { capture: true });
  }, [getTopLayer]);

  return (
    <WebDismissibleLayerContext.Provider value={contextValue}>
      {children}
    </WebDismissibleLayerContext.Provider>
  );
}

export function useWebDismissibleLayer(options: DismissibleLayerOptions) {
  const { registerLayer, updateLayer } = useContext(WebDismissibleLayerContext);
  const { active, id, onDismiss, stateKey } = options;
  const onDismissRef = useRef(options.onDismiss);
  const priorityRef = useRef(options.priority ?? 0);
  const priority = options.priority ?? 0;
  const enabled = options.enabled ?? true;
  const key = getLayerKey(options);

  onDismissRef.current = onDismiss;
  priorityRef.current = priority;

  const dismissCurrent = useCallback(() => {
    onDismissRef.current();
  }, []);

  React.useEffect(() => {
    if (!active || !enabled) {
      return undefined;
    }

    return registerLayer({
      id,
      key,
      onDismiss: dismissCurrent,
      priority: priorityRef.current,
      stateKey,
    });
  }, [active, dismissCurrent, enabled, id, key, registerLayer, stateKey]);

  React.useEffect(() => {
    if (!active || !enabled) {
      return;
    }

    updateLayer({
      id,
      key,
      onDismiss: dismissCurrent,
      priority,
      stateKey,
    });
  }, [active, dismissCurrent, enabled, id, key, priority, stateKey, updateLayer]);
}
