import React from 'react';
import { act, fireEvent, render as rtlRender } from '@testing-library/react-native';
import { Platform, Text, View } from 'react-native';

import { useMapFilterController } from '@/src/hooks/useMapFilterController';
import { LanguageProvider } from '@/src/i18n';
import { WebDismissibleLayerProvider } from '@/src/providers/WebDismissibleLayerProvider';
import { MapFilterBar } from '../MapFilterBar';

function MapFilterBarHarness() {
  const controller = useMapFilterController();
  const [socialScope, setSocialScope] = React.useState<'all' | 'following'>('all');
  const [followingActivity, setFollowingActivity] = React.useState<
    'today' | '10d' | '30d' | 'all-time'
  >('all-time');

  return (
    <View>
      <MapFilterBar
        controller={controller}
        followingActivity={followingActivity}
        onFollowingActivityChange={setFollowingActivity}
        onToggleFollowing={() =>
          setSocialScope((current) => (current === 'following' ? 'all' : 'following'))
        }
        socialScope={socialScope}
      />
      <Text testID="applied-state">{JSON.stringify(controller.appliedFilters)}</Text>
      <Text testID="social-scope-state">{socialScope}</Text>
      <Text testID="following-activity-state">{followingActivity}</Text>
    </View>
  );
}

const originalPlatform = Platform.OS;

function render(ui: React.ReactElement) {
  return rtlRender(ui, { wrapper: LanguageProvider });
}

function renderWithDismissibleLayer(ui: React.ReactElement) {
  return render(<WebDismissibleLayerProvider>{ui}</WebDismissibleLayerProvider>);
}

function setPlatform(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: os,
  });
}

describe('MapFilterBar', () => {
  afterEach(() => {
    setPlatform(originalPlatform);
  });

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

    try {
      setPlatform('web');

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
      setPlatform(originalPlatform);
      jest.useRealTimers();
    }
  });

  it('closes the open web filter panel on popstate before route navigation', () => {
    setPlatform('web');
    const routeNavigation = jest.fn();
    window.addEventListener('popstate', routeNavigation);

    try {
      const { getByTestId, queryByTestId } = renderWithDismissibleLayer(
        <MapFilterBarHarness />
      );

      fireEvent.press(getByTestId('map-filter-pill-price'));
      expect(getByTestId('map-filter-panel-price')).toBeTruthy();

      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      expect(queryByTestId('map-filter-panel-price')).toBeNull();
      expect(routeNavigation).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('popstate', routeNavigation);
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
      'Minimum price cannot be higher than maximum price.'
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

    expect(getByTestId('applied-state').props.children).toContain('"marketState":["sold"]');

    fireEvent.press(getByTestId('map-filter-pill-market-state-for-sale'));

    expect(getByTestId('applied-state').props.children).toContain(
      '"marketState":["for-sale","sold"]'
    );
  });

  it('returns to the unfiltered default when the last active status pill is cleared', () => {
    const { getByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-market-state-sold'));
    fireEvent.press(getByTestId('map-filter-pill-market-state-sold'));

    expect(getByTestId('applied-state').props.children).toContain(
      '"marketState":["for-sale","for-rent","sold","rented","not-listed"]'
    );
  });

  it('uses one optioned Activity chip and does not render old Social or Recently Active chips', () => {
    const { getByTestId, queryByTestId, queryByText } = render(<MapFilterBarHarness />);

    expect(getByTestId('map-filter-pill-activity')).toBeTruthy();
    expect(queryByTestId('map-filter-pill-activity-social')).toBeNull();
    expect(queryByTestId('map-filter-pill-activity-recent')).toBeNull();
    expect(queryByText('Social')).toBeNull();
    expect(queryByText('Recently Active')).toBeNull();

    fireEvent.press(getByTestId('map-filter-pill-activity'));

    expect(getByTestId('applied-state').props.children).toContain('"activity":"all-time"');

    fireEvent.press(getByTestId('map-filter-pill-activity-arrow'));

    expect(getByTestId('map-filter-panel-activity')).toBeTruthy();
    expect(getByTestId('map-filter-option-activity-today')).toBeTruthy();
    expect(getByTestId('map-filter-option-activity-10d')).toBeTruthy();
    expect(getByTestId('map-filter-option-activity-30d')).toBeTruthy();
    expect(getByTestId('map-filter-option-activity-all-time')).toBeTruthy();

    fireEvent.press(getByTestId('map-filter-option-activity-10d'));

    expect(getByTestId('applied-state').props.children).toContain('"activity":"10d"');

    fireEvent.press(getByTestId('map-filter-pill-activity'));

    expect(getByTestId('applied-state').props.children).toContain('"activity":"all-time"');

    fireEvent.press(getByTestId('map-filter-pill-activity'));

    expect(getByTestId('applied-state').props.children).toContain('"activity":"all"');
  });

  it('toggles Following all-time as app-local state and opens independent options', () => {
    const { getByTestId } = render(<MapFilterBarHarness />);

    fireEvent.press(getByTestId('map-filter-pill-following'));

    expect(getByTestId('social-scope-state').props.children).toBe('following');
    expect(getByTestId('following-activity-state').props.children).toBe('all-time');
    expect(getByTestId('applied-state').props.children).not.toContain('following');
    expect(getByTestId('applied-state').props.children).not.toContain('socialScope');

    fireEvent.press(getByTestId('map-filter-pill-following-arrow'));

    expect(getByTestId('map-filter-panel-following')).toBeTruthy();
    expect(getByTestId('map-filter-option-following-today')).toBeTruthy();
    expect(getByTestId('map-filter-option-following-10d')).toBeTruthy();
    expect(getByTestId('map-filter-option-following-30d')).toBeTruthy();
    expect(getByTestId('map-filter-option-following-all-time')).toBeTruthy();

    fireEvent.press(getByTestId('map-filter-option-following-today'));

    expect(getByTestId('social-scope-state').props.children).toBe('following');
    expect(getByTestId('following-activity-state').props.children).toBe('today');
    expect(getByTestId('applied-state').props.children).toContain('"activity":"all"');

    fireEvent.press(getByTestId('map-filter-pill-following'));

    expect(getByTestId('social-scope-state').props.children).toBe('following');
    expect(getByTestId('following-activity-state').props.children).toBe('all-time');

    fireEvent.press(getByTestId('map-filter-pill-following'));

    expect(getByTestId('social-scope-state').props.children).toBe('all');
  });
});
