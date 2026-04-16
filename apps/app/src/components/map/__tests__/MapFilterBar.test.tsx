import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Platform, Text, View } from 'react-native';

import { useMapFilterController } from '@/src/hooks/useMapFilterController';
import { MapFilterBar } from '../MapFilterBar';

function MapFilterBarHarness() {
  const controller = useMapFilterController();

  return (
    <View>
      <MapFilterBar controller={controller} />
      <Text testID="applied-state">{JSON.stringify(controller.appliedFilters)}</Text>
    </View>
  );
}

describe('MapFilterBar', () => {
  it('does not apply price draft edits until Apply is pressed', () => {
    const { getByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-price'));
    fireEvent.changeText(getByTestId('map-filter-input-price-sale-from'), '600000');
    fireEvent.changeText(getByTestId('map-filter-input-price-sale-to'), '800000');

    expect(getByTestId('applied-state').props.children).toContain('"salePriceFrom":null');
    expect(getByTestId('applied-state').props.children).toContain('"salePriceTo":null');

    fireEvent.press(getByTestId('map-filter-apply-price'));

    expect(getByTestId('applied-state').props.children).toContain('"salePriceFrom":600000');
    expect(getByTestId('applied-state').props.children).toContain('"salePriceTo":800000');
  });

  it('fills a price input from the suggestion list without applying until Apply is pressed', () => {
    const { getByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-price'));
    fireEvent(getByTestId('map-filter-input-price-sale-from'), 'focus');
    fireEvent.press(getByTestId('map-filter-suggestion-price-sale-from-500000'));

    expect(getByTestId('applied-state').props.children).toContain('"salePriceFrom":null');

    fireEvent.press(getByTestId('map-filter-apply-price'));

    expect(getByTestId('applied-state').props.children).toContain('"salePriceFrom":500000');
  });

  it('keeps the suggestion tappable through an input blur so web clicks still update the draft', () => {
    jest.useFakeTimers();
    const originalPlatform = Platform.OS;

    try {
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        value: 'web',
      });

      const { getByTestId } = render(<MapFilterBarHarness />);

      fireEvent.press(getByTestId('map-filter-pill-price'));
      fireEvent(getByTestId('map-filter-input-price-sale-from'), 'focus');
      fireEvent(getByTestId('map-filter-suggestion-price-sale-from-500000'), 'pointerDown', {
        preventDefault: jest.fn(),
      });
      fireEvent(getByTestId('map-filter-input-price-sale-from'), 'blur');
      fireEvent.press(getByTestId('map-filter-apply-price'));
      jest.runAllTimers();

      expect(getByTestId('applied-state').props.children).toContain('"salePriceFrom":500000');
    } finally {
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        value: originalPlatform,
      });
      jest.useRealTimers();
    }
  });

  it('filters suggestions by typed prefix and hides the custom row on exact matches', () => {
    const { getByTestId, queryByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-price'));
    fireEvent(getByTestId('map-filter-input-price-sale-from'), 'focus');
    fireEvent.changeText(getByTestId('map-filter-input-price-sale-from'), '125');

    expect(getByTestId('map-filter-suggestion-price-sale-from-125')).toBeTruthy();
    expect(getByTestId('map-filter-suggestion-price-sale-from-125000')).toBeTruthy();
    expect(getByTestId('map-filter-suggestion-price-sale-from-1250000')).toBeTruthy();
    expect(queryByTestId('map-filter-suggestion-price-sale-from-250000')).toBeNull();

    fireEvent.changeText(getByTestId('map-filter-input-price-sale-from'), '600000');

    expect(queryByTestId('map-filter-suggestion-price-sale-from-125')).toBeNull();
    expect(getByTestId('map-filter-suggestion-price-sale-from-600000')).toBeTruthy();
  });

  it('lets the max suggestion list clear the upper bound', () => {
    const { getByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-price'));
    fireEvent.changeText(getByTestId('map-filter-input-price-sale-to'), '850000');
    fireEvent.press(getByTestId('map-filter-apply-price'));

    expect(getByTestId('applied-state').props.children).toContain('"salePriceTo":850000');

    fireEvent.press(getByTestId('map-filter-pill-price'));
    fireEvent(getByTestId('map-filter-input-price-sale-to'), 'focus');
    fireEvent.changeText(getByTestId('map-filter-input-price-sale-to'), '');
    fireEvent.press(getByTestId('map-filter-suggestion-price-sale-to-empty'));
    fireEvent.press(getByTestId('map-filter-apply-price'));

    expect(getByTestId('applied-state').props.children).toContain('"salePriceTo":null');
  });

  it('resets an active category from the inline dismiss control', () => {
    const { getByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-price'));
    fireEvent.changeText(getByTestId('map-filter-input-price-sale-from'), '450000');
    fireEvent.press(getByTestId('map-filter-apply-price'));

    fireEvent.press(getByTestId('map-filter-pill-price-dismiss'));

    expect(getByTestId('applied-state').props.children).toContain('"salePriceFrom":null');
    expect(getByTestId('applied-state').props.children).toContain('"salePriceTo":null');
  });

  it('shows only rent inputs when market state is rent-only', () => {
    const { getByTestId, queryByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-market-state-for-rent'));

    fireEvent.press(getByTestId('map-filter-pill-price'));

    expect(getByTestId('map-filter-input-price-rent-from')).toBeTruthy();
    expect(getByTestId('map-filter-input-price-rent-to')).toBeTruthy();
    expect(queryByTestId('map-filter-input-price-sale-from')).toBeNull();
    expect(queryByTestId('map-filter-input-price-sale-to')).toBeNull();
  });

  it('applies status pill toggles immediately and allows multi-select', () => {
    const { getByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-market-state-sold'));

    expect(getByTestId('applied-state').props.children).toContain(
      '"marketState":["sold"]',
    );

    fireEvent.press(getByTestId('map-filter-pill-market-state-for-sale'));

    expect(getByTestId('applied-state').props.children).toContain(
      '"marketState":["for-sale","sold"]',
    );
  });

  it('returns to the unfiltered default when the last active status pill is cleared', () => {
    const { getByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-market-state-sold'));
    fireEvent.press(getByTestId('map-filter-pill-market-state-sold'));

    expect(getByTestId('applied-state').props.children).toContain(
      '"marketState":["for-sale","for-rent","sold","rented","not-listed"]',
    );
  });
});
