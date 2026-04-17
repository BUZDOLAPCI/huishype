import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  AMBIENT_COMMENT_BUBBLE_ARROW_TIP_CENTER_X,
  AMBIENT_COMMENT_BUBBLE_MARKER_OFFSET_PX,
  AMBIENT_COMMENT_BUBBLE_WIDTH,
} from '../AmbientCommentBubble';
import { WebAmbientCommentBubblesPortal } from '../WebAmbientCommentBubblesPortal';
import type { AmbientCommentBubble } from '@/src/hooks/useAmbientCommentBubbles';

const mockAmbientCommentBubble = jest.fn((_props: unknown) => (
  <div data-testid="mock-ambient-comment-bubble" />
));

var mockMarkerInstances: Array<{
  addTo: jest.Mock;
  element: HTMLDivElement;
  remove: jest.Mock;
  setLngLat: jest.Mock;
}> = [];

jest.mock('../AmbientCommentBubble', () => {
  const actual = jest.requireActual('../AmbientCommentBubble');

  return {
    ...actual,
    AmbientCommentBubble: (props: unknown) => mockAmbientCommentBubble(props),
  };
});

jest.mock('maplibre-gl', () => {
  const Marker = jest.fn().mockImplementation((options: { element: HTMLDivElement }) => {
    let instance: {
      addTo: jest.Mock;
      element: HTMLDivElement;
      remove: jest.Mock;
      setLngLat: jest.Mock;
    };

    instance = {
      element: options.element,
      setLngLat: jest.fn().mockImplementation(() => instance),
      addTo: jest.fn().mockImplementation(() => {
        globalThis.document.body.appendChild(options.element);
        return instance;
      }),
      remove: jest.fn().mockImplementation(() => {
        options.element.remove();
      }),
    };

    mockMarkerInstances.push(instance);
    return instance;
  });

  return { Marker };
});

const { Marker: mockMarkerConstructor } = jest.requireMock('maplibre-gl') as {
  Marker: jest.Mock;
};

type PortalMap = React.ComponentProps<typeof WebAmbientCommentBubblesPortal>['map'];

let container: HTMLDivElement;
let root: Root;

function renderToDOM(element: React.ReactElement) {
  act(() => {
    root.render(element);
  });
}

function buildBubble(overrides?: Partial<AmbientCommentBubble>): AmbientCommentBubble {
  return {
    nodeKey: 'node-1',
    property: {
      id: 'property-1',
      address: 'Damrak 1',
      city: 'Amsterdam',
    },
    coordinate: [4.9, 52.37],
    screenPoint: [120, 180],
    preview: {
      text: 'nice neighbourhood!',
      likeCount: 0,
      authorName: 'M',
      authorPhotoUrl: null,
    },
    ...overrides,
  };
}

describe('WebAmbientCommentBubblesPortal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMarkerInstances.length = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
  });

  it('anchors the marker to the arrow tip instead of the bubble center', () => {
    const map = {
      getContainer: jest.fn().mockReturnValue({ clientWidth: 400 }),
      project: jest.fn().mockReturnValue({ x: 120, y: 320 }),
    } as unknown as PortalMap;

    renderToDOM(
      <WebAmbientCommentBubblesPortal
        map={map}
        bubbles={[buildBubble()]}
        onBubblePress={jest.fn()}
      />,
    );

    expect(mockMarkerConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        anchor: 'bottom',
        offset: [
          (AMBIENT_COMMENT_BUBBLE_WIDTH / 2) - AMBIENT_COMMENT_BUBBLE_ARROW_TIP_CENTER_X,
          -AMBIENT_COMMENT_BUBBLE_MARKER_OFFSET_PX,
        ],
      }),
    );
    expect(mockMarkerInstances).toHaveLength(1);
    expect(mockAmbientCommentBubble.mock.calls.at(-1)?.[0]).toMatchObject({
      arrowHorizontalAlign: 'left',
    });
  });

  it('moves the bubble to extend leftward when the anchor is on the right half of the viewport', () => {
    const map = {
      getContainer: jest.fn().mockReturnValue({ clientWidth: 400 }),
      project: jest.fn().mockReturnValue({ x: 280, y: 320 }),
    } as unknown as PortalMap;

    renderToDOM(
      <WebAmbientCommentBubblesPortal
        map={map}
        bubbles={[buildBubble()]}
        onBubblePress={jest.fn()}
      />,
    );

    expect(mockMarkerConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        anchor: 'bottom',
        offset: [
          -((AMBIENT_COMMENT_BUBBLE_WIDTH / 2) - AMBIENT_COMMENT_BUBBLE_ARROW_TIP_CENTER_X),
          -AMBIENT_COMMENT_BUBBLE_MARKER_OFFSET_PX,
        ],
      }),
    );
    expect(mockAmbientCommentBubble.mock.calls.at(-1)?.[0]).toMatchObject({
      arrowHorizontalAlign: 'right',
    });
  });
});
