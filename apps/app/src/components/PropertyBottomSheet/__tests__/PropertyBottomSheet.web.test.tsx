import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

import {
  PropertyBottomSheet,
  getDirectionalSnapState,
  getNearestSnapState,
} from '../PropertyBottomSheet.web';
import type { PropertyDetails } from '../../../hooks/useProperties';

const mockPropertyContent = jest.fn<void, [any]>();

jest.mock('../PropertyContent', () => ({
  PropertyContent: (props: any) => {
    mockPropertyContent(props);
    return null;
  },
}));

const property: PropertyDetails = {
  id: 'web-property-1',
  nationalId: 'BAG-1',
  countryCode: 'NL',
  address: 'Webstraat 1',
  city: 'Eindhoven',
  postalCode: '5600 AA',
  geometry: {
    type: 'Point',
    coordinates: [5.4697, 51.4416],
  },
  yearBuilt: 1985,
  floorAreaM2: 120,
  status: 'active',
  officialValuation: 350000,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  activityLevel: 'cold',
  commentCount: 0,
  guessCount: 0,
  viewCount: 0,
  uniqueViewers: 0,
};

const setWindowSize = (width: number, height: number) => {
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
};

describe('PropertyBottomSheet.web', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forwards isLoading and closed visibility state to PropertyContent in portrait', () => {
    setWindowSize(390, 844);

    render(
      <PropertyBottomSheet
        property={property}
        isLoading
      />
    );

    const lastProps =
      mockPropertyContent.mock.calls[mockPropertyContent.mock.calls.length - 1]?.[0];

    expect(lastProps).toEqual(expect.objectContaining({
      property,
      isLoading: true,
      isVisible: false,
    }));
  });

  it('enters peek state in portrait when preview becomes visible', async () => {
    setWindowSize(390, 844);
    const ref = React.createRef<any>();

    render(
      <PropertyBottomSheet
        ref={ref}
        property={property}
        isPreviewCardVisible
      />
    );

    await waitFor(() => {
      const lastProps =
        mockPropertyContent.mock.calls[mockPropertyContent.mock.calls.length - 1]?.[0];
      expect(lastProps).toEqual(expect.objectContaining({
        property,
        isLoading: false,
        isVisible: true,
      }));
    });

    expect(ref.current?.getCurrentIndex()).toBe(0);
  });

  it('keeps landscape preview cards closed without rendering PropertyContent', async () => {
    setWindowSize(1280, 720);
    const ref = React.createRef<any>();

    render(
      <PropertyBottomSheet
        ref={ref}
        property={property}
        isPreviewCardVisible
      />
    );

    expect(mockPropertyContent).not.toHaveBeenCalled();

    expect(ref.current?.getCurrentIndex()).toBe(-1);
  });

  it('passes section scroll callbacks into PropertyContent', () => {
    setWindowSize(390, 844);

    render(
      <PropertyBottomSheet
        property={property}
      />
    );

    const lastProps =
      mockPropertyContent.mock.calls[mockPropertyContent.mock.calls.length - 1]?.[0];

    expect(lastProps).toEqual(expect.objectContaining({
      onScrollToComments: expect.any(Function),
      onScrollToGuess: expect.any(Function),
    }));
  });

  it('exposes the preview-open imperative handle and opens details on demand', async () => {
    setWindowSize(390, 844);
    const ref = React.createRef<any>();

    render(
      <PropertyBottomSheet
        ref={ref}
        property={property}
        isPreviewCardVisible
      />
    );

    expect(ref.current?.openFromPreview).toEqual(expect.any(Function));

    act(() => {
      ref.current?.openFromPreview();
    });

    await waitFor(() => {
      expect(ref.current?.getCurrentIndex()).toBe(1);
      const lastProps =
        mockPropertyContent.mock.calls[mockPropertyContent.mock.calls.length - 1]?.[0];
      expect(lastProps).toEqual(expect.objectContaining({
        property,
        isVisible: true,
      }));
    });
  });
});

describe('getNearestSnapState', () => {
  it('allows skipping from peek straight to full when released near full', () => {
    expect(getNearestSnapState(12, 'peek')).toBe('full');
  });

  it('allows skipping from full straight back to peek when released near peek', () => {
    expect(getNearestSnapState(90, 'peek')).toBe('peek');
  });

  it('snaps to the closest allowed state', () => {
    expect(getNearestSnapState(60, 'peek')).toBe('partial');
    expect(getNearestSnapState(80, 'closed')).toBe('closed');
  });
});

describe('getDirectionalSnapState', () => {
  it('does not revert an upward drag once movement passes the threshold', () => {
    expect(getDirectionalSnapState('peek', 86, 'peek')).toBe('partial');
  });

  it('does not revert a downward drag once movement passes the threshold', () => {
    expect(getDirectionalSnapState('full', 12, 'peek')).toBe('partial');
  });

  it('still allows skipping states when the release point is near a farther snap', () => {
    expect(getDirectionalSnapState('peek', 8, 'peek')).toBe('full');
    expect(getDirectionalSnapState('full', 94, 'peek')).toBe('peek');
  });

  it('uses nearest snap behavior for very small movements', () => {
    expect(getDirectionalSnapState('partial', 56, 'peek')).toBe('partial');
  });
});
