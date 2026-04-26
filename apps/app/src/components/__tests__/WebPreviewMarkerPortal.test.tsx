import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { PreviewGroup } from '@/src/hooks/useMapInteraction';

type MockPreviewCardProps = {
  properties: Array<{
    address: string;
    thumbnailUrl?: string | null;
  }>;
  currentIndex: number;
  arrowDirection: string;
};

const mockGroupPreviewCard = jest.fn((props: MockPreviewCardProps) => (
  <div data-testid="mock-group-preview-card">
    <span data-testid="mock-address">{props.properties[props.currentIndex].address}</span>
    <span data-testid="mock-thumbnail">
      {props.properties[props.currentIndex].thumbnailUrl ?? 'no-thumbnail'}
    </span>
    <span data-testid="mock-arrow">{props.arrowDirection}</span>
  </div>
));

var mockMarkerInstances: Array<{
  addTo: jest.Mock;
  element: HTMLDivElement;
  options: {
    anchor?: string;
    element: HTMLDivElement;
    offset?: [number, number];
  };
  remove: jest.Mock;
  setLngLat: jest.Mock;
}> = [];

jest.mock('../GroupPreviewCard', () => ({
  GroupPreviewCard: (props: MockPreviewCardProps) => mockGroupPreviewCard(props),
}));

jest.mock('maplibre-gl', () => {
  const Marker = jest.fn().mockImplementation((options: {
    anchor?: string;
    element: HTMLDivElement;
    offset?: [number, number];
  }) => {
    let instance: {
      addTo: jest.Mock;
      element: HTMLDivElement;
      options: typeof options;
      remove: jest.Mock;
      setLngLat: jest.Mock;
    };

    instance = {
      element: options.element,
      options,
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

import { WebPreviewMarkerPortal } from '../WebPreviewMarkerPortal';

const { Marker: mockMarkerConstructor } = jest.requireMock('maplibre-gl') as {
  Marker: jest.Mock;
};

type PortalMap = React.ComponentProps<typeof WebPreviewMarkerPortal>['map'];

let container: HTMLDivElement;
let root: Root;

function renderToDOM(element: React.ReactElement) {
  act(() => {
    root.render(element);
  });
}

function buildPreviewGroup(overrides?: Partial<PreviewGroup>): PreviewGroup {
  return {
    coordinate: [4.9, 52.37],
    properties: [
      {
        id: 'property-1',
        address: 'Damrak 1',
        city: 'Amsterdam',
        thumbnailUrl: null,
      },
    ],
    ...overrides,
  };
}

describe('WebPreviewMarkerPortal', () => {
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

  it('updates preview content without recreating the marker when hydration fills fields', () => {
    const map = {
      project: jest.fn().mockReturnValue({ y: 320 }),
    } as unknown as PortalMap;

    const initialPreview = buildPreviewGroup();
    renderToDOM(
      <WebPreviewMarkerPortal
        map={map}
        previewGroup={initialPreview}
        currentIndex={0}
        markerOffsetPx={40}
        onIndexChange={jest.fn()}
        onClose={jest.fn()}
        onPropertyTap={jest.fn()}
        onLike={jest.fn()}
        onComment={jest.fn()}
        onGuess={jest.fn()}
        isLiked={false}
      />
    );

    expect(mockMarkerConstructor).toHaveBeenCalledTimes(1);
    expect(mockMarkerInstances[0]?.element.style.position).toBe('absolute');
    expect(document.querySelector('[data-testid="mock-address"]')?.textContent).toBe('Damrak 1');
    expect(document.querySelector('[data-testid="mock-thumbnail"]')?.textContent).toBe('no-thumbnail');

    const hydratedPreview = buildPreviewGroup({
      properties: [
        {
          id: 'property-1',
          address: 'Damrak 1',
          city: 'Amsterdam',
          thumbnailUrl: 'https://example.com/thumb.jpg',
          yearBuilt: 1905,
          floorAreaM2: 86,
        },
      ],
    });

    renderToDOM(
      <WebPreviewMarkerPortal
        map={map}
        previewGroup={hydratedPreview}
        currentIndex={0}
        markerOffsetPx={40}
        onIndexChange={jest.fn()}
        onClose={jest.fn()}
        onPropertyTap={jest.fn()}
        onLike={jest.fn()}
        onComment={jest.fn()}
        onGuess={jest.fn()}
        isLiked={false}
      />
    );

    expect(mockMarkerConstructor).toHaveBeenCalledTimes(1);
    expect(mockMarkerInstances[0]?.remove).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="mock-thumbnail"]')?.textContent).toBe(
      'https://example.com/thumb.jpg'
    );
  });

  it('recreates the marker when the preview coordinate changes', () => {
    const map = {
      project: jest.fn().mockReturnValue({ y: 120 }),
    } as unknown as PortalMap;

    renderToDOM(
      <WebPreviewMarkerPortal
        map={map}
        previewGroup={buildPreviewGroup()}
        currentIndex={0}
        markerOffsetPx={40}
        onIndexChange={jest.fn()}
        onClose={jest.fn()}
        onPropertyTap={jest.fn()}
        onLike={jest.fn()}
        onComment={jest.fn()}
        onGuess={jest.fn()}
        isLiked={false}
      />
    );

    renderToDOM(
      <WebPreviewMarkerPortal
        map={map}
        previewGroup={buildPreviewGroup({ coordinate: [4.91, 52.371] })}
        currentIndex={0}
        markerOffsetPx={40}
        onIndexChange={jest.fn()}
        onClose={jest.fn()}
        onPropertyTap={jest.fn()}
        onLike={jest.fn()}
        onComment={jest.fn()}
        onGuess={jest.fn()}
        isLiked={false}
      />
    );

    expect(mockMarkerConstructor).toHaveBeenCalledTimes(2);
    expect(mockMarkerInstances[0]?.remove).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="mock-arrow"]')?.textContent).toBe('up');
  });

  it('anchors the card to the selected marker coordinate when provided', () => {
    const previewCoordinate: [number, number] = [4.9, 52.37];
    const selectedMarkerCoordinate: [number, number] = [4.92, 52.38];
    const map = {
      getContainer: jest.fn(() => ({ clientHeight: 800 })),
    } as unknown as NonNullable<PortalMap>;

    renderToDOM(
      <WebPreviewMarkerPortal
        map={map}
        previewGroup={buildPreviewGroup({ coordinate: previewCoordinate })}
        anchorCoordinate={selectedMarkerCoordinate}
        currentIndex={0}
        markerOffsetPx={18}
        onIndexChange={jest.fn()}
        onClose={jest.fn()}
        onPropertyTap={jest.fn()}
        onLike={jest.fn()}
        onComment={jest.fn()}
        onGuess={jest.fn()}
        isLiked={false}
      />
    );

    expect(mockMarkerInstances[0]?.setLngLat).toHaveBeenCalledWith(selectedMarkerCoordinate);
    expect(mockMarkerInstances[0]?.options.anchor).toBe('top');
    expect(mockMarkerInstances[0]?.options.offset).toEqual([0, 18]);
    expect(document.querySelector('[data-testid="mock-arrow"]')?.textContent).toBe('up');
  });

  it('uses the same visual offset magnitude when the card is placed below the marker', () => {
    const map = {
      project: jest.fn().mockReturnValue({ y: 120 }),
    } as unknown as PortalMap;

    renderToDOM(
      <WebPreviewMarkerPortal
        map={map}
        previewGroup={buildPreviewGroup()}
        currentIndex={0}
        markerOffsetPx={18}
        onIndexChange={jest.fn()}
        onClose={jest.fn()}
        onPropertyTap={jest.fn()}
        onLike={jest.fn()}
        onComment={jest.fn()}
        onGuess={jest.fn()}
        isLiked={false}
      />
    );

    expect(mockMarkerInstances[0]?.options.anchor).toBe('top');
    expect(mockMarkerInstances[0]?.options.offset).toEqual([0, 18]);
    expect(document.querySelector('[data-testid="mock-arrow"]')?.textContent).toBe('up');
  });

  it('keeps the card below the marker even when there is not enough room below', () => {
    const map = {
      getContainer: jest.fn(() => ({ clientHeight: 800 })),
      project: jest.fn().mockReturnValue({ y: 740 }),
    } as unknown as PortalMap;

    renderToDOM(
      <WebPreviewMarkerPortal
        map={map}
        previewGroup={buildPreviewGroup()}
        currentIndex={0}
        markerOffsetPx={18}
        onIndexChange={jest.fn()}
        onClose={jest.fn()}
        onPropertyTap={jest.fn()}
        onLike={jest.fn()}
        onComment={jest.fn()}
        onGuess={jest.fn()}
        isLiked={false}
      />
    );

    expect(mockMarkerInstances[0]?.options.anchor).toBe('top');
    expect(mockMarkerInstances[0]?.options.offset).toEqual([0, 18]);
    expect(document.querySelector('[data-testid="mock-arrow"]')?.textContent).toBe('up');
  });
});
