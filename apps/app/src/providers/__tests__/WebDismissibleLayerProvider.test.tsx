import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';
import type { PropsWithChildren } from 'react';

import {
  WebDismissibleLayerProvider,
  useWebDismissibleLayer,
} from '../WebDismissibleLayerProvider';

const originalPlatform = Platform.OS;

function wrapper({ children }: PropsWithChildren) {
  return <WebDismissibleLayerProvider>{children}</WebDismissibleLayerProvider>;
}

function setPlatform(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: os,
  });
}

function resetHistory(path = '/map?city=eindhoven#property') {
  window.history.replaceState({ expo: 'router-state', keep: true }, '', path);
}

async function flushDeferredHistoryCleanup() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('WebDismissibleLayerProvider', () => {
  beforeEach(() => {
    setPlatform('web');
    resetHistory();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setPlatform(originalPlatform);
    resetHistory();
  });

  it('pushes a same-path history entry while preserving existing state keys', () => {
    const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {});

    renderHook(
      () =>
        useWebDismissibleLayer({
          id: 'sheet',
          active: true,
          onDismiss: jest.fn(),
        }),
      { wrapper },
    );

    expect(window.location.pathname).toBe('/map');
    expect(window.location.search).toBe('?city=eindhoven');
    expect(window.location.hash).toBe('#property');
    expect(window.history.state).toMatchObject({
      expo: 'router-state',
      keep: true,
      __huishypeDismissibleLayer: {
        id: 'sheet',
        key: 'sheet',
      },
    });
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('dismisses only the top active layer on popstate by priority', () => {
    const lowDismiss = jest.fn();
    const highDismiss = jest.fn();
    const stopImmediatePropagation = jest.fn();

    renderHook(
      () => {
        useWebDismissibleLayer({
          id: 'low',
          active: true,
          priority: 0,
          onDismiss: lowDismiss,
        });
        useWebDismissibleLayer({
          id: 'high',
          active: true,
          priority: 10,
          onDismiss: highDismiss,
        });
      },
      { wrapper },
    );

    act(() => {
      const event = new PopStateEvent('popstate');
      Object.defineProperty(event, 'stopImmediatePropagation', {
        configurable: true,
        value: stopImmediatePropagation,
      });
      window.dispatchEvent(event);
    });

    expect(highDismiss).toHaveBeenCalledTimes(1);
    expect(lowDismiss).not.toHaveBeenCalled();
    expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  it('consumes the stale history entry when the top layer is closed in app', async () => {
    const onDismiss = jest.fn();
    const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {});
    const stopImmediatePropagation = jest.fn();

    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useWebDismissibleLayer({
          id: 'sheet',
          active,
          onDismiss,
        }),
      {
        wrapper,
        initialProps: { active: true },
      },
    );

    rerender({ active: false });

    expect(backSpy).not.toHaveBeenCalled();

    await flushDeferredHistoryCleanup();

    expect(backSpy).toHaveBeenCalledTimes(1);

    act(() => {
      const event = new PopStateEvent('popstate');
      Object.defineProperty(event, 'stopImmediatePropagation', {
        configurable: true,
        value: stopImmediatePropagation,
      });
      window.dispatchEvent(event);
    });

    expect(onDismiss).not.toHaveBeenCalled();
    expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  it('does not consume history when route navigation changes location before cleanup runs', async () => {
    const onDismiss = jest.fn();
    const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {});

    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useWebDismissibleLayer({
          id: 'sheet',
          active,
          onDismiss,
        }),
      {
        wrapper,
        initialProps: { active: true },
      },
    );

    rerender({ active: false });

    act(() => {
      window.history.pushState({ expo: 'next-route' }, '', '/settings');
    });

    await flushDeferredHistoryCleanup();

    expect(backSpy).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('clears a stale layer marker when the current entry URL was passively rewritten', async () => {
    resetHistory('/');
    const onDismiss = jest.fn();
    const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {});

    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useWebDismissibleLayer({
          id: 'welcome-modal',
          active,
          onDismiss,
        }),
      {
        wrapper,
        initialProps: { active: true },
      },
    );

    act(() => {
      window.history.replaceState(
        window.history.state,
        '',
        '/@52.3626765,5.3574841,6.29z',
      );
    });

    rerender({ active: false });

    await flushDeferredHistoryCleanup();

    expect(backSpy).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/@52.3626765,5.3574841,6.29z');
    expect(window.history.state).toMatchObject({
      expo: 'router-state',
      keep: true,
    });
    expect(window.history.state).not.toHaveProperty('__huishypeDismissibleLayer');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('cancels pending history cleanup when the same layer is re-registered', async () => {
    const onDismiss = jest.fn();
    const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {});

    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useWebDismissibleLayer({
          id: 'sheet',
          active,
          onDismiss,
        }),
      {
        wrapper,
        initialProps: { active: true },
      },
    );

    rerender({ active: false });
    rerender({ active: true });

    await flushDeferredHistoryCleanup();

    expect(backSpy).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does not call history.back again when a popstate dismissal deactivates the layer', () => {
    const onDismiss = jest.fn();
    const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {});

    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useWebDismissibleLayer({
          id: 'sheet',
          active,
          onDismiss,
        }),
      {
        wrapper,
        initialProps: { active: true },
      },
    );

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);

    rerender({ active: false });

    expect(backSpy).not.toHaveBeenCalled();
  });

  it('ignores duplicate active registrations for the same state key', () => {
    const pushSpy = jest.spyOn(window.history, 'pushState');
    const firstDismiss = jest.fn();
    const secondDismiss = jest.fn();

    renderHook(
      () => {
        useWebDismissibleLayer({
          id: 'first-sheet',
          stateKey: 'shared-layer',
          active: true,
          onDismiss: firstDismiss,
        });
        useWebDismissibleLayer({
          id: 'second-sheet',
          stateKey: 'shared-layer',
          active: true,
          onDismiss: secondDismiss,
        });
      },
      { wrapper },
    );

    expect(pushSpy).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(secondDismiss).toHaveBeenCalledTimes(1);
    expect(firstDismiss).not.toHaveBeenCalled();
  });

  it('is a no-op outside web', () => {
    setPlatform('ios');
    const pushSpy = jest.spyOn(window.history, 'pushState');
    const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {});
    const onDismiss = jest.fn();

    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useWebDismissibleLayer({
          id: 'native-sheet',
          active,
          onDismiss,
        }),
      {
        wrapper,
        initialProps: { active: true },
      },
    );

    rerender({ active: false });

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(pushSpy).not.toHaveBeenCalled();
    expect(backSpy).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
