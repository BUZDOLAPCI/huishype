import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ScrollView } from 'react-native';

import { PropertyBottomSheet } from '../PropertyBottomSheet.web';
import type { PropertyBottomSheetRef, PropertyContentProps } from '../index';
import type { PropertyDetails } from '../../../hooks/useProperties';

const mockPropertyContent = jest.fn<void, [PropertyContentProps]>();

jest.mock('../PropertyContent', () => ({
  PropertyContent: (props: PropertyContentProps) => {
    const React = require('react');
    const { Pressable, Text, View } = require('react-native');

    mockPropertyContent(props);
    return (
      <View>
        <Pressable
          testID="mock-passive-body"
          onPress={props.onHalfExpandedBodyPress}
        >
          <Text>Passive body</Text>
        </Pressable>
        <Pressable
          testID="mock-interactive-save"
          onPress={() => props.onSave?.('web-property-1')}
        >
          <Text>Mock Save</Text>
        </Pressable>
      </View>
    );
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

type HostTestNode = { props: Record<string, unknown> };

const getHostNodesByType = (type: string): HostTestNode[] =>
  (screen.UNSAFE_getAllByType as unknown as (hostType: string) => HostTestNode[])(type);

const getScrollViews = (): HostTestNode[] =>
  (
    screen.UNSAFE_getAllByType as unknown as (
      hostType: typeof ScrollView
    ) => HostTestNode[]
  )(ScrollView);

const queryWebPanelHeader = () =>
  getHostNodesByType('div')
    .find((node) => String(node.props.className).includes('web-property-panel-header')) ?? null;

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

  it('marks PropertyContent visible when the portrait sheet opens from preview', async () => {
    setWindowSize(390, 844);

    render(
      <PropertyBottomSheet
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
  });

  it('passes section scroll callbacks into PropertyContent', () => {
    setWindowSize(1280, 720);
    const onCommentPress = jest.fn();

    render(
      <PropertyBottomSheet
        property={property}
        isPreviewCardVisible
        onCommentPress={onCommentPress}
      />
    );

    const lastProps =
      mockPropertyContent.mock.calls[mockPropertyContent.mock.calls.length - 1]?.[0];

    expect(lastProps).toEqual(expect.objectContaining({
      onScrollToComments: expect.any(Function),
      onScrollToGuess: expect.any(Function),
      onViewAllComments: onCommentPress,
    }));
  });

  it('exposes the preview-open imperative handle', () => {
    setWindowSize(390, 844);
    const ref = React.createRef<PropertyBottomSheetRef>();

    render(
      <PropertyBottomSheet
        ref={ref}
        property={property}
        isPreviewCardVisible
      />
    );

    expect(ref.current?.openFromPreview).toEqual(expect.any(Function));
  });

  it('expands a portrait partial sheet when a passive body area is pressed', async () => {
    setWindowSize(390, 844);
    const ref = React.createRef<PropertyBottomSheetRef>();
    const onSheetChange = jest.fn();

    render(
      <PropertyBottomSheet
        ref={ref}
        property={property}
        isPreviewCardVisible
        onSheetChange={onSheetChange}
      />
    );

    act(() => {
      ref.current?.snapToIndex(1);
    });

    await waitFor(() => expect(ref.current?.getCurrentIndex()).toBe(1));

    fireEvent.press(screen.getByTestId('mock-passive-body'));

    await waitFor(() => expect(ref.current?.getCurrentIndex()).toBe(2));
    expect(onSheetChange).toHaveBeenLastCalledWith(2);
  });

  it('keeps web interactive controls from using the passive body path', async () => {
    setWindowSize(390, 844);
    const ref = React.createRef<PropertyBottomSheetRef>();
    const onSave = jest.fn();

    render(
      <PropertyBottomSheet
        ref={ref}
        property={property}
        isPreviewCardVisible
        onSave={onSave}
      />
    );

    act(() => {
      ref.current?.snapToIndex(1);
    });

    await waitFor(() => expect(ref.current?.getCurrentIndex()).toBe(1));

    fireEvent.press(screen.getByTestId('mock-interactive-save'));

    expect(onSave).toHaveBeenCalledWith('web-property-1');
    expect(ref.current?.getCurrentIndex()).toBe(1);
  });

  it('keeps close and backdrop dismissal behavior in portrait partial state', async () => {
    setWindowSize(390, 844);
    const ref = React.createRef<PropertyBottomSheetRef>();

    render(
      <PropertyBottomSheet
        ref={ref}
        property={property}
        isPreviewCardVisible
      />
    );

    act(() => {
      ref.current?.snapToIndex(1);
    });

    await waitFor(() => expect(ref.current?.getCurrentIndex()).toBe(1));

    const lastProps =
      mockPropertyContent.mock.calls[mockPropertyContent.mock.calls.length - 1]?.[0];
    expect(lastProps?.onHeaderClose).toEqual(expect.any(Function));

    act(() => {
      lastProps?.onHeaderClose?.();
    });
    await waitFor(() => expect(ref.current?.getCurrentIndex()).toBe(0));

    act(() => {
      ref.current?.snapToIndex(1);
    });
    await waitFor(() => expect(ref.current?.getCurrentIndex()).toBe(1));

    const backdrop = getHostNodesByType('div')
      .find((node) => node.props['data-testid'] === 'web-panel-backdrop');
    expect(backdrop).toBeTruthy();
    fireEvent(backdrop as Parameters<typeof fireEvent>[0], 'click');
    await waitFor(() => expect(ref.current?.getCurrentIndex()).toBe(0));
  });

  it('shows only the compact address title after scrolling past the measured summary card', async () => {
    setWindowSize(390, 844);

    render(
      <PropertyBottomSheet
        property={property}
        isPreviewCardVisible
      />
    );

    expect(screen.queryByText('Property Details')).toBeNull();
    expect(screen.queryByText('Webstraat 1')).toBeNull();
    expect(queryWebPanelHeader()).toBeNull();

    const lastProps =
      mockPropertyContent.mock.calls[mockPropertyContent.mock.calls.length - 1]?.[0];

    expect(lastProps.onHeaderClose).toEqual(expect.any(Function));

    act(() => {
      lastProps.onSummaryCardBottomLayout?.(120);
    });

    const scrollView = getScrollViews()[0];

    act(() => {
      fireEvent.scroll(scrollView as Parameters<typeof fireEvent.scroll>[0], {
        nativeEvent: { contentOffset: { y: 119 } },
      });
    });

    expect(screen.queryByText('Webstraat 1')).toBeNull();
    expect(queryWebPanelHeader()).toBeNull();

    act(() => {
      fireEvent.scroll(scrollView as Parameters<typeof fireEvent.scroll>[0], {
        nativeEvent: { contentOffset: { y: 120 } },
      });
    });

    await waitFor(() => expect(screen.getByText('Webstraat 1')).toBeTruthy());
    expect(queryWebPanelHeader()?.props.className).toContain('overlay');
    expect(document.getElementById('web-panel-chrome-css')?.textContent).toContain(
      '.web-property-panel--portrait .web-property-panel-header.overlay'
    );
    expect(document.getElementById('web-panel-chrome-css')?.textContent).toContain('top: 14px;');

    act(() => {
      fireEvent.scroll(scrollView as Parameters<typeof fireEvent.scroll>[0], {
        nativeEvent: { contentOffset: { y: 24 } },
      });
    });

    await waitFor(() => expect(screen.queryByText('Webstraat 1')).toBeNull());
    expect(queryWebPanelHeader()).toBeNull();
  });
});
