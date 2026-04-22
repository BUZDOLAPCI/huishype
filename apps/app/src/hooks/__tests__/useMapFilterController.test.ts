import React from 'react';
import { act, renderHook } from '@testing-library/react-native';

import { useMapFilterController } from '../useMapFilterController';

describe('useMapFilterController', () => {
  it('keeps price edits in draft state until commit', () => {
    const onAppliedFiltersChange = jest.fn();
    const { result } = renderHook(() =>
      useMapFilterController({ onAppliedFiltersChange }),
    );

    act(() => {
      result.current.toggleCategory('price');
      result.current.updatePriceDraft('sale', 'from', '500000');
      result.current.updatePriceDraft('sale', 'to', '750000');
    });

    expect(result.current.appliedFilters.salePriceFrom).toBeNull();
    expect(result.current.appliedFilters.salePriceTo).toBeNull();
    expect(result.current.draftFilters.salePriceFrom).toBe('500000');
    expect(result.current.draftFilters.salePriceTo).toBe('750000');
    expect(onAppliedFiltersChange).not.toHaveBeenCalled();

    act(() => {
      result.current.commitPriceDraft();
    });

    expect(result.current.appliedFilters.salePriceFrom).toBe(500000);
    expect(result.current.appliedFilters.salePriceTo).toBe(750000);
    expect(onAppliedFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        salePriceFrom: 500000,
        salePriceTo: 750000,
      }),
    );
  });

  it('keeps active categories first and resets a dismissed category', () => {
    const { result } = renderHook(() => useMapFilterController());

    act(() => {
      result.current.toggleStatusPill('sold');
    });

    act(() => {
      result.current.toggleActivity('today');
    });

    expect(result.current.orderedCategories[0]).toBe('marketState');
    expect(result.current.orderedCategories[1]).toBe('activity');
    expect(result.current.appliedFilters.marketState).toEqual(['sold']);
    expect(result.current.appliedFilters.activity).toBe('today');

    act(() => {
      result.current.dismissCategory('marketState');
    });

    expect(result.current.appliedFilters.marketState).toEqual([
      'for-sale',
      'for-rent',
      'sold',
      'rented',
      'not-listed',
    ]);
    expect(result.current.appliedFilters.activity).toBe('today');
    expect(result.current.openCategory).toBeNull();
    expect(result.current.orderedCategories).toEqual([
      'activity',
      'price',
      'marketState',
    ]);
  });

  it('treats clearing the last active status pill as returning to the unfiltered default', () => {
    const { result } = renderHook(() => useMapFilterController());

    act(() => {
      result.current.toggleStatusPill('for-sale');
    });

    expect(result.current.appliedFilters.marketState).toEqual(['for-sale']);

    act(() => {
      result.current.toggleStatusPill('for-sale');
    });

    expect(result.current.appliedFilters.marketState).toEqual([
      'for-sale',
      'for-rent',
      'sold',
      'rented',
      'not-listed',
    ]);
  });

  it('keeps the public activity facet exclusive and toggles back to all', () => {
    const { result } = renderHook(() => useMapFilterController());

    act(() => {
      result.current.toggleActivity('all-time');
    });

    expect(result.current.appliedFilters.activity).toBe('all-time');

    act(() => {
      result.current.toggleActivity('10d');
    });

    expect(result.current.appliedFilters.activity).toBe('10d');

    act(() => {
      result.current.toggleActivity('10d');
    });

    expect(result.current.appliedFilters.activity).toBe('all');
  });
});
