import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

import { PropertyBottomSheet } from '../PropertyBottomSheet.web';
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

  it('forwards isLoading and closed visibility state to PropertyContent', () => {
    setWindowSize(1280, 720);

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

  it('keeps PropertyContent hidden when preview becomes visible until explicitly opened', async () => {
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
        isVisible: false,
      }));
    });

    expect(ref.current?.getCurrentIndex()).toBe(-1);
  });

  it('does not auto-open details in landscape when preview is visible', async () => {
    setWindowSize(1280, 720);
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
        isVisible: false,
      }));
    });

    expect(ref.current?.getCurrentIndex()).toBe(-1);
  });

  it('passes section scroll callbacks into PropertyContent', () => {
    setWindowSize(1280, 720);

    render(
      <PropertyBottomSheet
        property={property}
        isPreviewCardVisible
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
