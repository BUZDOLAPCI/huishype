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
import { Text } from 'react-native';

import { ResponsivePanel } from '../ResponsivePanel.web';

// expo-router is already mocked by __mocks__/expo-router.js (moduleNameMapper)
const { router } = require('expo-router');

// Mock Icon component
jest.mock('../Icon', () => ({
  Icon: () => null,
}));

let container: HTMLDivElement;
let root: Root;

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

describe('ResponsivePanel.web', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders children as full-screen passthrough in portrait mode', () => {
    setWindowSize(390, 844); // portrait

    renderToDOM(
      <ResponsivePanel title="Test Panel">
        <Text>Child content</Text>
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
        <Text>Panel content</Text>
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
        <Text>Content</Text>
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
        <Text>Content</Text>
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
        <Text>Content</Text>
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
        <Text>Content</Text>
      </ResponsivePanel>
    );

    expect(queryDom('responsive-panel')).not.toBeNull();
  });
});
