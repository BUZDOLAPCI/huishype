import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Platform, Text, View } from 'react-native';

import { useMapFilterController } from '@/src/hooks/useMapFilterController';
import { MapFilterBar } from '../MapFilterBar';

function MapFilterBarHarness() {
  const controller = useMapFilterController();
  const [socialScope, setSocialScope] = React.useState<'all' | 'following'>('all');

  return (
    <View>
      <MapFilterBar
        controller={controller}
        onToggleFollowing={() =>
          setSocialScope((current) => (current === 'following' ? 'all' : 'following'))
        }
        socialScope={socialScope}
      />
      <Text testID="applied-state">{JSON.stringify(controller.appliedFilters)}</Text>
      <Text testID="social-scope-state">{socialScope}</Text>
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
    fireEvent(getByTestId('map-filter-input-price-sale-from'), 'pressIn');
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
      fireEvent(getByTestId('map-filter-input-price-sale-from'), 'pressIn');
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

  it('opens suggestions when a price field receives focus', () => {
    const { getByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-price'));
    fireEvent(getByTestId('map-filter-input-price-sale-from'), 'focus');

    expect(getByTestId('map-filter-suggestions-price-sale-from')).toBeTruthy();
  });

  it('filters suggestions only after numeric keypresses and reopens a populated field with the full list', () => {
    const { getByTestId, queryByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-price'));
    fireEvent(getByTestId('map-filter-input-price-sale-from'), 'pressIn');
    expect(getByTestId('map-filter-suggestion-price-sale-from-50000')).toBeTruthy();

    fireEvent(getByTestId('map-filter-input-price-sale-from'), 'keyPress', {
      nativeEvent: { key: '1' },
    });
    fireEvent.changeText(getByTestId('map-filter-input-price-sale-from'), '125');

    expect(getByTestId('map-filter-suggestion-price-sale-from-125')).toBeTruthy();
    expect(getByTestId('map-filter-suggestion-price-sale-from-125000')).toBeTruthy();
    expect(getByTestId('map-filter-suggestion-price-sale-from-1250000')).toBeTruthy();
    expect(queryByTestId('map-filter-suggestion-price-sale-from-250000')).toBeNull();

    fireEvent(getByTestId('map-filter-input-price-sale-from'), 'pressIn');

    expect(getByTestId('map-filter-suggestion-price-sale-from-50000')).toBeTruthy();
    expect(getByTestId('map-filter-suggestion-price-sale-from-250000')).toBeTruthy();

    fireEvent(getByTestId('map-filter-input-price-sale-from'), 'keyPress', {
      nativeEvent: { key: '6' },
    });
    fireEvent.changeText(getByTestId('map-filter-input-price-sale-from'), '600000');

    expect(queryByTestId('map-filter-suggestion-price-sale-from-125')).toBeNull();
    expect(getByTestId('map-filter-suggestion-price-sale-from-600000')).toBeTruthy();
  });

  it('keeps pasted values unfiltered until the user types again', () => {
    const { getByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-price'));
    fireEvent(getByTestId('map-filter-input-price-sale-from'), 'pressIn');
    fireEvent.changeText(getByTestId('map-filter-input-price-sale-from'), '125');

    expect(getByTestId('map-filter-suggestion-price-sale-from-50000')).toBeTruthy();
    expect(getByTestId('map-filter-suggestion-price-sale-from-250000')).toBeTruthy();
  });

  it('lets the max suggestion list clear the upper bound', () => {
    const { getByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-price'));
    fireEvent.changeText(getByTestId('map-filter-input-price-sale-to'), '850000');
    fireEvent.press(getByTestId('map-filter-apply-price'));

    expect(getByTestId('applied-state').props.children).toContain('"salePriceTo":850000');

    fireEvent.press(getByTestId('map-filter-pill-price'));
    fireEvent(getByTestId('map-filter-input-price-sale-to'), 'pressIn');

    expect(getByTestId('map-filter-suggestion-price-sale-to-empty')).toBeTruthy();

    fireEvent.press(getByTestId('map-filter-suggestion-price-sale-to-empty'));
    fireEvent.press(getByTestId('map-filter-apply-price'));

    expect(getByTestId('applied-state').props.children).toContain('"salePriceTo":null');
  });

  it('opens and navigates the suggestion list with arrow keys', () => {
    const { getByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-price'));
    fireEvent(getByTestId('map-filter-input-price-sale-from'), 'keyPress', {
      nativeEvent: { key: 'ArrowDown' },
    });
    fireEvent(getByTestId('map-filter-input-price-sale-from'), 'keyPress', {
      nativeEvent: { key: 'ArrowDown' },
    });
    fireEvent(getByTestId('map-filter-input-price-sale-from'), 'keyPress', {
      nativeEvent: { key: 'Enter' },
    });
    fireEvent.press(getByTestId('map-filter-apply-price'));

    expect(getByTestId('applied-state').props.children).toContain('"salePriceFrom":50000');
  });

  it('shows a validation error instead of swapping an invalid range', () => {
    const { getByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-price'));
    fireEvent.changeText(getByTestId('map-filter-input-price-sale-from'), '800000');
    fireEvent.changeText(getByTestId('map-filter-input-price-sale-to'), '600000');

    expect(getByTestId('map-filter-error-price-sale').props.children).toBe(
      'Minimum price cannot be higher than maximum price.',
    );

    fireEvent.press(getByTestId('map-filter-apply-price'));

    expect(getByTestId('applied-state').props.children).toContain('"salePriceFrom":null');
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

  it('keeps the public activity facet exclusive and serializes it in applied state', () => {
    const { getByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-activity-social'));

    expect(getByTestId('applied-state').props.children).toContain('"activity":"social"');

    fireEvent.press(getByTestId('map-filter-pill-activity-recent'));

    expect(getByTestId('applied-state').props.children).toContain('"activity":"recent"');
    expect(getByTestId('applied-state').props.children).not.toContain('"activity":"social"');

    fireEvent.press(getByTestId('map-filter-pill-activity-recent'));

    expect(getByTestId('applied-state').props.children).toContain('"activity":"all"');
  });

  it('toggles following as app-local state without mutating public applied filters', () => {
    const { getByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-social-following'));

    expect(getByTestId('social-scope-state').props.children).toBe('following');
    expect(getByTestId('applied-state').props.children).not.toContain('following');
    expect(getByTestId('applied-state').props.children).not.toContain('socialScope');
  });
});
