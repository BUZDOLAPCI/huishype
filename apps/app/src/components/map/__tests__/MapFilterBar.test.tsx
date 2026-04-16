import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Text, View } from 'react-native';

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

    fireEvent.press(getByTestId('map-filter-pill-salePrice'));
    fireEvent.changeText(getByTestId('map-filter-input-salePrice-from'), '600000');
    fireEvent.changeText(getByTestId('map-filter-input-salePrice-to'), '800000');

    expect(getByTestId('applied-state').props.children).toContain('"salePriceFrom":null');
    expect(getByTestId('applied-state').props.children).toContain('"salePriceTo":null');

    fireEvent.press(getByTestId('map-filter-apply-salePrice'));

    expect(getByTestId('applied-state').props.children).toContain('"salePriceFrom":600000');
    expect(getByTestId('applied-state').props.children).toContain('"salePriceTo":800000');
  });

  it('resets an active category from the inline dismiss control', () => {
    const { getByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-salePrice'));
    fireEvent.changeText(getByTestId('map-filter-input-salePrice-from'), '450000');
    fireEvent.press(getByTestId('map-filter-apply-salePrice'));

    fireEvent.press(getByTestId('map-filter-pill-salePrice-dismiss'));

    expect(getByTestId('applied-state').props.children).toContain('"salePriceFrom":null');
    expect(getByTestId('applied-state').props.children).toContain('"salePriceTo":null');
  });

  it('applies market-state toggles immediately', () => {
    const { getByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-marketState'));
    fireEvent.press(getByTestId('map-filter-market-state-sold'));

    expect(getByTestId('applied-state').props.children).toContain(
      '"marketState":["for-sale","for-rent","rented","not-listed"]',
    );
  });
});
