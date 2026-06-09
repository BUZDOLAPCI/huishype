/**
 * Tests for ResponsivePanel.web
 *
 * This component renders raw HTML elements (div, button) for the panel chrome.
 * Since @testing-library/react-native's render() uses a virtual React tree that
 * doesn't bridge data-testid on DOM elements, we use ReactDOM createRoot to
 * render into jsdom directly and query the DOM.
 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

import { ResponsivePanel } from '../ResponsivePanel.web';

// expo-router is already mocked by __mocks__/expo-router.js (moduleNameMapper)
const { router } = require('expo-router');

// Mock Icon component
jest.mock('../Icon', () => ({
  Icon: () => null,
}));

let container: HTMLDivElement;
let root: Root;
let animationFrameCallbacks: FrameRequestCallback[];
let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;

function setWindowSize(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: height,
  });
  window.dispatchEvent(new Event('resize'));
}

function queryDom(testId: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${testId}"]`);
}

function renderToDOM(element: React.ReactElement) {
  act(() => {
    root.render(element);
  });
}

function flushAnimationFrame() {
  const callbacks = animationFrameCallbacks;
  animationFrameCallbacks = [];

  act(() => {
    callbacks.forEach((callback) => callback(performance.now()));
  });
}

function dispatchPointerEvent(target: HTMLElement, type: string, clientY: number) {
  const event = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperty(event, 'clientY', { value: clientY });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}

describe('ResponsivePanel.web', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    animationFrameCallbacks = [];
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: jest.fn((callback: FrameRequestCallback) => {
        animationFrameCallbacks.push(callback);
        return animationFrameCallbacks.length;
      }),
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      writable: true,
      value: jest.fn((handle: number) => {
        animationFrameCallbacks[handle - 1] = () => {};
      }),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    jest.useRealTimers();
    act(() => {
      root.unmount();
    });
    container.remove();
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: originalRequestAnimationFrame,
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      writable: true,
      value: originalCancelAnimationFrame,
    });
  });

  it('renders children as full-screen passthrough in portrait mode', () => {
    setWindowSize(390, 844); // portrait

    renderToDOM(
      <ResponsivePanel title="Test Panel">
        <span>Child content</span>
      </ResponsivePanel>
    );

    // Children should be rendered
    expect(container.textContent).toContain('Child content');

    // No panel backdrop or panel container in portrait
    expect(queryDom('responsive-panel-backdrop')).toBeNull();
    expect(queryDom('responsive-panel')).toBeNull();
  });

  it('renders side panel with backdrop in landscape mode', () => {
    setWindowSize(1280, 720); // landscape

    renderToDOM(
      <ResponsivePanel title="Comments">
        <span>Panel content</span>
      </ResponsivePanel>
    );

    // Panel elements should be present
    expect(queryDom('responsive-panel-backdrop')).not.toBeNull();
    expect(queryDom('responsive-panel')).not.toBeNull();
    expect(queryDom('responsive-panel-close')).not.toBeNull();

    // Title and children should be rendered
    expect(container.textContent).toContain('Comments');
    expect(container.textContent).toContain('Panel content');
  });

  it('calls router.back() when close button is clicked in landscape', () => {
    setWindowSize(1280, 720);

    renderToDOM(
      <ResponsivePanel title="Test">
        <span>Content</span>
      </ResponsivePanel>
    );

    const closeBtn = queryDom('responsive-panel-close');
    expect(closeBtn).not.toBeNull();
    act(() => {
      closeBtn!.click();
    });

    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('calls custom onClose when provided', () => {
    setWindowSize(1280, 720);

    const onClose = jest.fn();
    renderToDOM(
      <ResponsivePanel title="Test" onClose={onClose}>
        <span>Content</span>
      </ResponsivePanel>
    );

    const closeBtn = queryDom('responsive-panel-close');
    expect(closeBtn).not.toBeNull();
    act(() => {
      closeBtn!.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(router.back).not.toHaveBeenCalled();
  });

  it('calls router.back() when backdrop is clicked in landscape', () => {
    setWindowSize(1280, 720);

    renderToDOM(
      <ResponsivePanel title="Test">
        <span>Content</span>
      </ResponsivePanel>
    );

    const backdrop = queryDom('responsive-panel-backdrop');
    expect(backdrop).not.toBeNull();
    act(() => {
      backdrop!.click();
    });

    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('renders empty title when none provided', () => {
    setWindowSize(1280, 720);

    renderToDOM(
      <ResponsivePanel>
        <span>Content</span>
      </ResponsivePanel>
    );

    expect(queryDom('responsive-panel')).not.toBeNull();
  });

  it('renders map-sheet presentation as a portrait bottom sheet that mounts closed before opening full-height', () => {
    setWindowSize(390, 844);
    const onOpenChange = jest.fn();

    renderToDOM(
      <ResponsivePanel title="Comments" presentation="map-sheet" onOpenChange={onOpenChange}>
        <span>Map sheet content</span>
      </ResponsivePanel>
    );

    const panel = queryDom('web-property-panel');
    const backdrop = queryDom('web-panel-backdrop');

    expect(panel).not.toBeNull();
    expect(panel?.className).toContain('web-property-panel--portrait');
    expect(panel?.className).not.toContain('partial');
    expect(panel?.className).not.toContain('full');
    expect(queryDom('web-panel-handle')).not.toBeNull();
    expect(backdrop).not.toBeNull();
    expect(backdrop?.className).not.toContain('open');
    expect(container.textContent).toContain('Map sheet content');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    flushAnimationFrame();

    expect(panel?.className).toContain('full');
    expect(backdrop?.className).toContain('open');
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it('opens an already mounted closed map-sheet in the same render', () => {
    setWindowSize(390, 844);
    const onOpenChange = jest.fn();

    renderToDOM(
      <ResponsivePanel
        title="Comments"
        presentation="map-sheet"
        open={false}
        onOpenChange={onOpenChange}
      >
        <span>Preloaded map sheet content</span>
      </ResponsivePanel>
    );

    const panel = queryDom('web-property-panel');
    const backdrop = queryDom('web-panel-backdrop');
    expect(panel).not.toBeNull();
    expect(container.textContent).toContain('Preloaded map sheet content');
    expect(panel?.className).not.toContain('partial');
    expect(panel?.className).not.toContain('full');
    expect(backdrop?.className).not.toContain('open');

    flushAnimationFrame();

    expect(panel?.className).not.toContain('partial');
    expect(panel?.className).not.toContain('full');
    expect(backdrop?.className).not.toContain('open');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    renderToDOM(
      <ResponsivePanel
        title="Comments"
        presentation="map-sheet"
        open
        onOpenChange={onOpenChange}
      >
        <span>Preloaded map sheet content</span>
      </ResponsivePanel>
    );

    expect(panel?.className).toContain('full');
    expect(backdrop?.className).toContain('open');
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it('animates map-sheet presentation closed before calling close handlers', () => {
    jest.useFakeTimers();
    setWindowSize(390, 844);
    const onClose = jest.fn();

    const renderMapSheet = () => {
      renderToDOM(
        <ResponsivePanel title="Comments" presentation="map-sheet" onClose={onClose}>
          <span>Map sheet content</span>
        </ResponsivePanel>
      );
      flushAnimationFrame();
    };

    const remountMapSheet = () => {
      act(() => {
        root.unmount();
      });
      root = createRoot(container);
      renderMapSheet();
    };

    renderMapSheet();

    act(() => {
      queryDom('web-panel-close')?.click();
    });
    expect(queryDom('web-property-panel')?.className).not.toContain('partial');
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    remountMapSheet();

    act(() => {
      queryDom('web-panel-backdrop')?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onClose).toHaveBeenCalledTimes(2);

    expect(router.back).not.toHaveBeenCalled();
  });

  it('toggles map-sheet portrait partial and full states from the drag handle tap', () => {
    setWindowSize(390, 844);

    renderToDOM(
      <ResponsivePanel title="Comments" presentation="map-sheet">
        <span>Map sheet content</span>
      </ResponsivePanel>
    );
    flushAnimationFrame();

    const panel = queryDom('web-property-panel');
    const handle = queryDom('web-panel-handle');
    expect(panel?.className).toContain('full');
    expect(handle).not.toBeNull();

    act(() => {
      dispatchPointerEvent(handle!, 'pointerdown', 700);
      dispatchPointerEvent(handle!, 'pointerup', 700);
    });

    expect(panel?.className).toContain('partial');

    act(() => {
      dispatchPointerEvent(handle!, 'pointerdown', 700);
      dispatchPointerEvent(handle!, 'pointerup', 700);
    });

    expect(panel?.className).toContain('full');
  });

  it('renders map-sheet presentation as a landscape side panel with backdrop close', () => {
    setWindowSize(1280, 720);
    const onClose = jest.fn();
    const onOpenChange = jest.fn();

    renderToDOM(
      <ResponsivePanel
        title="Guesses"
        presentation="map-sheet"
        landscapeRightOffset={420}
        onClose={onClose}
        onOpenChange={onOpenChange}
      >
        <span>Landscape map sheet content</span>
      </ResponsivePanel>
    );

    const panel = queryDom('web-property-panel');
    const chromeCss = document.getElementById('web-panel-chrome-css')?.textContent;
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain('web-property-panel--landscape');
    expect(panel?.style.getPropertyValue('--web-panel-landscape-right-offset')).toBe('420px');
    expect(chromeCss).toContain('right 0.3s cubic-bezier(0.4, 0, 0.2, 1)');
    expect(chromeCss).toContain('transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)');
    expect(panel?.className).not.toContain('open');
    expect(queryDom('web-panel-handle')).toBeNull();
    expect(queryDom('web-panel-backdrop')?.className).not.toContain('open');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    flushAnimationFrame();

    expect(panel?.className).toContain('open');
    expect(queryDom('web-panel-backdrop')?.className).toContain('open');
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    jest.useFakeTimers();

    act(() => {
      queryDom('web-panel-backdrop')?.click();
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
