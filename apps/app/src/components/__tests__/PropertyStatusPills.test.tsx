import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { ListingPill, type ListingMarketState } from '../PropertyStatusPills';

describe('ListingPill', () => {
  it.each([
    ['for-sale', 'For sale'],
    ['for-rent', 'For rent'],
    ['sold', 'Sold'],
    ['rented', 'Rented'],
  ] satisfies Array<[ListingMarketState, string]>)(
    'renders a listing pill for %s',
    (marketState, label) => {
      render(<ListingPill marketState={marketState} />);

      expect(screen.getByTestId('listing-pill')).toBeTruthy();
      expect(screen.getByText(label)).toBeTruthy();
    }
  );

  it.each([
    ['sold', 'Sold', '#F6F8F6', '#9AA89E', '#6B776F'],
    ['rented', 'Rented', '#F6F7F9', '#98A3B0', '#697280'],
  ] satisfies Array<[ListingMarketState, string, string, string, string]>)(
    'uses quiet terminal colors for %s',
    (marketState, label, bg, dot, text) => {
      render(<ListingPill marketState={marketState} />);

      const pill = screen.getByTestId('listing-pill');
      const dotStyle = pill.props.children[0].props.style;
      const labelStyle = screen.getByText(label).props.style;

      expect(pill.props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ backgroundColor: bg })])
      );
      expect(dotStyle).toEqual(
        expect.arrayContaining([expect.objectContaining({ backgroundColor: dot })])
      );
      expect(labelStyle).toEqual(
        expect.arrayContaining([expect.objectContaining({ color: text })])
      );
    }
  );

  it.each([['not-listed'], [null], [undefined]] satisfies Array<
    [ListingMarketState | null | undefined]
  >)('renders no listing pill for %s', (marketState) => {
    render(<ListingPill marketState={marketState} />);

    expect(screen.queryByTestId('listing-pill')).toBeNull();
  });
});
